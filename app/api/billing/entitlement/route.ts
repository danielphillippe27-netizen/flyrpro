import { NextRequest, NextResponse } from 'next/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import type { EntitlementSnapshot } from '@/types/database';
import { getDefaultUpgradePriceId } from '@/app/lib/billing/stripe-products';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

type WorkspaceBilling = {
  subscription_status?: string | null;
  trial_ends_at?: string | null;
};

function workspaceHasAccess(workspace: WorkspaceBilling | null): boolean {
  if (!workspace) return false;

  const status = (workspace.subscription_status ?? '').toLowerCase();
  if (status === 'active') return true;
  if (status !== 'trialing') return false;
  if (!workspace.trial_ends_at) return true;

  const trialEnd = new Date(workspace.trial_ends_at);
  return !Number.isNaN(trialEnd.getTime()) && trialEnd > new Date();
}

async function resolvePrimaryWorkspaceBilling(userId: string): Promise<WorkspaceBilling | null> {
  const admin = createAdminClient();

  const { data: ownedWorkspace } = await admin
    .from('workspaces')
    .select('subscription_status, trial_ends_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ownedWorkspace) {
    return ownedWorkspace;
  }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.workspace_id) {
    return null;
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('subscription_status, trial_ends_at')
    .eq('id', membership.workspace_id)
    .maybeSingle();

  return workspace ?? null;
}

/**
 * GET /api/billing/entitlement
 * Single "truth fetch" for iOS and web. Auth: cookies (web) or Authorization: Bearer (iOS).
 * Returns { plan, is_active, source, current_period_end }.
 */
export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getEntitlementForUser(requestUser.id);
    const workspace = await resolvePrimaryWorkspaceBilling(requestUser.id);
    const workspaceAccess = workspaceHasAccess(workspace);
    const effectivePeriodEnd =
      entitlement.current_period_end ??
      (workspaceAccess ? workspace?.trial_ends_at ?? null : null);

    const snapshot: EntitlementSnapshot & { upgrade_price_id?: string } = {
      plan:
        workspaceAccess && entitlement.plan === 'free'
          ? 'pro'
          : entitlement.plan,
      is_active: entitlement.is_active || workspaceAccess,
      source: entitlement.source,
      current_period_end: effectivePeriodEnd,
    };
    const defaultPriceId = getDefaultUpgradePriceId();
    if (defaultPriceId) {
      snapshot.upgrade_price_id = defaultPriceId;
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('Error fetching entitlement:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entitlement' },
      { status: 500 }
    );
  }
}
