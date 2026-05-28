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

type WorkspaceBilling = {
  id?: string;
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
    .select('id, subscription_status, trial_ends_at')
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
    .select('id, subscription_status, trial_ends_at')
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
    const admin = createAdminClient();
    const approvedAmbassador = await getApprovedAmbassadorByEmail(admin, requestUser.email);
    const isAmbassador = !!approvedAmbassador;
    const workspace = await resolvePrimaryWorkspaceBilling(requestUser.id);
    const workspaceAccess = workspaceHasAccess(workspace);
    const effectiveAccess = entitlement.is_active || workspaceAccess || isAmbassador;
    const effectivePeriodEnd =
      entitlement.current_period_end ??
      (workspaceAccess ? workspace?.trial_ends_at ?? null : null);
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
          : workspaceAccess && entitlement.plan === 'free'
          ? 'pro'
          : entitlement.plan,
      is_active: effectiveAccess,
      source: entitlement.source,
      current_period_end: effectivePeriodEnd,
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
      planBadgeLabel: isAmbassador ? 'AMBASSADOR' : null,
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
