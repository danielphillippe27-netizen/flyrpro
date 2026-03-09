import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser, mergeEntitlementUpdate } from '@/app/lib/billing/entitlements';
import { getAppleTransactionStatus } from '@/app/lib/billing/apple-server';
import {
  isAllowedAppleProductId,
} from '@/app/lib/billing/apple-products';
import { updateWorkspaceSubscriptionForUser } from '@/app/lib/billing/stripe-subscription-sync';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

/**
 * POST /api/billing/apple/verify
 * Verify Apple IAP and update entitlements. Auth: Bearer (Supabase access token).
 * Body: { transactionId: string, productId?: string }
 * Returns: { ok: true, entitlement: { plan, is_active, source, current_period_end } } or { ok: false, error }
 */
export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = requestUser.id;

    const body = await request.json();
    const transactionId = body?.transactionId as string | undefined;
    if (!transactionId || typeof transactionId !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'transactionId required' },
        { status: 400 }
      );
    }
    const clientProductId = body?.productId as string | undefined;

    let result;
    try {
      result = await getAppleTransactionStatus(transactionId);
    } catch (e) {
      console.error('Apple verification failed:', e);
      return NextResponse.json(
        { ok: false, error: 'Verification failed' },
        { status: 502 }
      );
    }

    if (!result) {
      return NextResponse.json(
        { ok: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const productId = clientProductId || result.productId;
    if (productId && !isAllowedAppleProductId(productId)) {
      return NextResponse.json(
        { ok: false, error: 'Product not allowed' },
        { status: 400 }
      );
    }

    let existing;
    try {
      existing = await getEntitlementForUser(userId);
    } catch {
      existing = {
        user_id: userId,
        plan: 'free',
        is_active: false,
        source: 'none',
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_end: null,
        updated_at: new Date().toISOString(),
      };
    }

    const update = mergeEntitlementUpdate(existing, {
      plan: 'pro',
      is_active: result.isActive,
      source: 'apple',
      current_period_end: result.expiresAt,
    });

    const admin = createAdminClient();
    if (Object.keys(update).length > 0) {
      const { error: upsertError } = await admin
        .from('entitlements')
        .upsert(
          {
            user_id: userId,
            plan: update.plan ?? existing.plan,
            is_active: update.is_active ?? existing.is_active,
            source: update.source ?? existing.source,
            current_period_end: update.current_period_end ?? existing.current_period_end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );
      if (upsertError) {
        console.error('[billing/apple/verify] entitlement upsert failed:', upsertError);
        return NextResponse.json(
          { ok: false, error: 'Failed to update entitlement' },
          { status: 500 }
        );
      }
    }

    await updateWorkspaceSubscriptionForUser(admin, userId, {
      status: result.isActive ? 'active' : 'inactive',
      trialEndsAt: null,
    });

    // Defensive fallback: if owner workspace exists, force it to reflect Apple status.
    // This protects iOS/web parity if primary-workspace resolution misses in edge cases.
    const { data: ownerWorkspaces, error: ownerWsError } = await admin
      .from('workspaces')
      .select('id')
      .eq('owner_id', userId);
    if (ownerWsError) {
      console.error('[billing/apple/verify] owner workspace lookup failed:', ownerWsError);
    } else if ((ownerWorkspaces ?? []).length > 0) {
      const ids = (ownerWorkspaces ?? []).map((row) => row.id);
      const { error: wsUpdateError } = await admin
        .from('workspaces')
        .update({
          subscription_status: result.isActive ? 'active' : 'inactive',
          trial_ends_at: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', ids);
      if (wsUpdateError) {
        console.error('[billing/apple/verify] workspace status update failed:', wsUpdateError);
      }
    }

    const final = await getEntitlementForUser(userId);
    return NextResponse.json({
      ok: true,
      entitlement: {
        plan: final.plan,
        is_active: final.is_active,
        source: final.source,
        current_period_end: final.current_period_end,
      },
    });
  } catch (error) {
    console.error('Apple verify error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
