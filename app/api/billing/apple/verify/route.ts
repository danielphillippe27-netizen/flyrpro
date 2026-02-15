import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { getEntitlementForUser, mergeEntitlementUpdate } from '@/app/lib/billing/entitlements';
import { getAppleTransactionStatus } from '@/app/lib/billing/apple-server';
import {
  isAllowedAppleProductId,
} from '@/app/lib/billing/apple-products';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function cleanUrl(): string {
  return (SUPABASE_URL || '').trim().replace(/\/$/, '') || SUPABASE_URL;
}

/**
 * POST /api/billing/apple/verify
 * Verify Apple IAP and update entitlements. Auth: Bearer (Supabase access token).
 * Body: { transactionId: string, productId?: string }
 * Returns: { ok: true, entitlement: { plan, is_active, source, current_period_end } } or { ok: false, error }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ') || !SUPABASE_ANON) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    const supabase = createClient(cleanUrl(), SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

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
      existing = await getEntitlementForUser(user.id);
    } catch {
      existing = {
        user_id: user.id,
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

    if (Object.keys(update).length === 0) {
      return NextResponse.json({
        ok: true,
        entitlement: {
          plan: existing.plan,
          is_active: existing.is_active,
          source: existing.source,
          current_period_end: existing.current_period_end,
        },
      });
    }

    const admin = createAdminClient();
    await admin
      .from('entitlements')
      .upsert(
        {
          user_id: user.id,
          plan: update.plan ?? existing.plan,
          is_active: update.is_active ?? existing.is_active,
          source: update.source ?? existing.source,
          current_period_end: update.current_period_end ?? existing.current_period_end,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    const final = await getEntitlementForUser(user.id);
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
