import { NextRequest, NextResponse } from 'next/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import type { EntitlementSnapshot } from '@/types/database';
import {
  getDefaultUpgradePriceId,
  getPowerDialerAddonOffer,
  getRequestBillingCurrency,
} from '@/app/lib/billing/stripe-products';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspacePowerDialerAddon } from '@/app/lib/billing/workspace-addons';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { getApprovedAmbassadorByEmail } from '@/app/lib/billing/ambassador-access';
import {
  getTrialDaysRemaining,
  isWorkspaceTrialActive,
} from '@/lib/demo/demo44TeamTrial';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';

type WorkspaceBilling = {
  id?: string;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
};

function workspaceHasAccess(workspace: WorkspaceBilling | null): boolean {
  if (!workspace) return false;

  const status = (workspace.subscription_status ?? '').toLowerCase();
  return status === 'active' || isWorkspaceTrialActive(status, workspace.trial_ends_at);
}

async function resolvePrimaryWorkspaceBilling(userId: string): Promise<WorkspaceBilling | null> {
  const admin = createAdminClient();
  const resolution = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    userId
  );
  if (!resolution.workspaceId) {
    return null;
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, subscription_status, trial_ends_at')
    .eq('id', resolution.workspaceId)
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
    const admin = createAdminClient();
    const approvedAmbassador = await getApprovedAmbassadorByEmail(admin, requestUser.email);
    const isAmbassador = !!approvedAmbassador;
    const workspace = await resolvePrimaryWorkspaceBilling(requestUser.id);
    const activeWorkspaceTrial = isWorkspaceTrialActive(
      workspace?.subscription_status,
      workspace?.trial_ends_at
    );
    const trialDaysRemaining = activeWorkspaceTrial
      ? getTrialDaysRemaining(workspace?.trial_ends_at)
      : null;
    const workspaceAccess = workspaceHasAccess(workspace);
    const effectiveAccess = entitlement.is_active || workspaceAccess || isAmbassador;
    const effectivePeriodEnd =
      entitlement.current_period_end ??
      (activeWorkspaceTrial ? workspace?.trial_ends_at ?? null : null);
    const dialerOffer = getPowerDialerAddonOffer(getRequestBillingCurrency(request));
    const workspaceId = workspace?.id ?? null;
    let dialerAddon = null;
    let dialerNumber: string | null = null;
    let dialerNumberStatus: string | null = null;

    if (workspaceId) {
      const [{ data: dialerSettings }, addon] = await Promise.all([
        admin
          .from('workspace_dialer_settings')
          .select('default_from_number, number_status')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        getWorkspacePowerDialerAddon(admin, workspaceId),
      ]);
      dialerAddon = addon;
      dialerNumber = normalizePhoneNumber(dialerSettings?.default_from_number).e164;
      dialerNumberStatus = dialerSettings?.number_status ?? null;
    }

    const snapshot: EntitlementSnapshot & {
      upgrade_price_id?: string;
      canUsePro: boolean;
      reason: string | null;
    } = {
      plan:
        isAmbassador
          ? 'ambassador'
          : activeWorkspaceTrial && entitlement.plan === 'free'
          ? 'team'
          : workspaceAccess && entitlement.plan === 'free'
          ? 'pro'
          : entitlement.plan,
      is_active: effectiveAccess,
      source: entitlement.source,
      current_period_end: effectivePeriodEnd,
      subscription_status: workspace?.subscription_status ?? null,
      trial_ends_at: workspace?.trial_ends_at ?? null,
      trial_days_remaining: trialDaysRemaining,
      dialer_offer: {
        price_id: dialerOffer.priceId || null,
        amount: dialerOffer.amount,
        currency: dialerOffer.currency,
        period: dialerOffer.period,
      },
      dialer_addon: dialerAddon
        ? {
            status: dialerAddon.status,
            is_active: dialerAddon.status === 'active',
            price_id: dialerAddon.stripe_price_id ?? null,
            amount_cents: dialerAddon.amount_cents ?? null,
            currency: dialerAddon.currency ?? null,
          }
        : {
            status: 'inactive',
            is_active: false,
            price_id: null,
            amount_cents: null,
            currency: null,
          },
      dialer_number: dialerNumber,
      dialer_number_status: (dialerNumberStatus as EntitlementSnapshot['dialer_number_status']) ?? null,
      dialer_uses_shared_default: !dialerNumber,
      isAmbassador,
      planBadgeLabel: isAmbassador
        ? 'AMBASSADOR'
        : activeWorkspaceTrial
          ? `TRIAL · ${trialDaysRemaining ?? 0}D LEFT`
          : null,
      canUsePro: effectiveAccess,
      reason: effectiveAccess ? null : 'inactive',
    };
    const defaultPriceId = isAmbassador ? '' : getDefaultUpgradePriceId();
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
