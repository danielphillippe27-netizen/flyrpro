import type { createAdminClient } from '@/lib/supabase/server';
import type Stripe from 'stripe';
import type { SalespersonReferral } from '@/types/database';

type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

type SalespersonRow = {
  id: string;
  full_name: string;
  status: 'active' | 'paused' | 'inactive';
  referral_code: string | null;
  commission_rate_bps: number | null;
  commission_duration_months: number | null;
  stripe_payouts_enabled: boolean | null;
};

type SalespersonReferralRow = SalespersonReferral;

type WorkspaceReferralRow = {
  id: string;
  referral_code_used: string | null;
};

export type SalespersonReferralCodeStats = {
  referralCode: string;
  useCount: number;
};

const DEFAULT_COMMISSION_RATE_BPS = 2500;
const DEFAULT_COMMISSION_DURATION_MONTHS = 12;

export function normalizeSalespersonReferralCodeInput(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20);
}

export function slugifySalespersonReferralCode(value: string): string {
  const normalized = normalizeSalespersonReferralCodeInput(value).slice(0, 12);
  return normalized || 'SELLER';
}

async function persistSalespersonReferralCode(
  admin: SupabaseAdminClient,
  salespersonId: string,
  referralCode: string
): Promise<string> {
  const normalized = normalizeSalespersonReferralCodeInput(referralCode);
  if (!normalized) {
    throw new Error('Referral code is required.');
  }

  const { error } = await admin
    .from('salespeople')
    .update({ referral_code: normalized })
    .eq('id', salespersonId);

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('duplicate') || error.code === '23505') {
      throw new Error(`Referral code "${normalized}" is already in use.`);
    }
    throw new Error(error.message);
  }

  return normalized;
}

export async function ensureSalespersonReferralCode(
  admin: SupabaseAdminClient,
  params: {
    salespersonId: string;
    fullName: string;
    existingReferralCode?: string | null;
    preferredReferralCode?: string | null;
  }
): Promise<string> {
  const preferred = normalizeSalespersonReferralCodeInput(params.preferredReferralCode ?? '');
  if (preferred) {
    return persistSalespersonReferralCode(admin, params.salespersonId, preferred);
  }

  const existing = normalizeSalespersonReferralCodeInput(params.existingReferralCode ?? '');
  if (existing) return existing;

  const baseCode = slugifySalespersonReferralCode(params.fullName);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = attempt === 0 ? baseCode : `${baseCode}${attempt + 1}`;
    try {
      return await persistSalespersonReferralCode(admin, params.salespersonId, candidate);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('already in use')
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to generate a unique salesperson referral code.');
}

export async function countSalespersonReferralCodeUses(
  admin: SupabaseAdminClient,
  referralCode: string | null | undefined
): Promise<number> {
  const normalizedReferralCode =
    typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
  if (!normalizedReferralCode) return 0;

  const { count, error } = await admin
    .from('workspaces')
    .select('id', { count: 'exact', head: true })
    .ilike('referral_code_used', normalizedReferralCode);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function getSalespersonReferralCodeStats(
  admin: SupabaseAdminClient,
  referralCode: string | null | undefined
): Promise<SalespersonReferralCodeStats | null> {
  const normalizedReferralCode =
    typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
  if (!normalizedReferralCode) return null;

  return {
    referralCode: normalizedReferralCode,
    useCount: await countSalespersonReferralCodeUses(admin, normalizedReferralCode),
  };
}

export async function resolveActiveSalespersonReferralCode(
  admin: SupabaseAdminClient,
  referralCode: string | null | undefined
): Promise<(SalespersonRow & { referralStats: SalespersonReferralCodeStats | null }) | null> {
  const trimmed = referralCode?.trim();
  if (!trimmed) return null;

  let response = await admin
    .from('salespeople')
    .select(
      'id, full_name, status, referral_code, commission_rate_bps, commission_duration_months, stripe_payouts_enabled'
    )
    .ilike('referral_code', trimmed)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (
    response.error &&
    response.error.message.toLowerCase().includes('commission_duration_months')
  ) {
    response = await admin
      .from('salespeople')
      .select('id, full_name, status, referral_code, commission_rate_bps, stripe_payouts_enabled')
      .ilike('referral_code', trimmed)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
  }

  if (response.error) {
    throw new Error(response.error.message);
  }

  const salesperson = (response.data as SalespersonRow | null) ?? null;
  if (!salesperson) return null;

  return {
    ...salesperson,
    referralStats: await getSalespersonReferralCodeStats(admin, salesperson.referral_code),
  };
}

async function resolvePrimaryWorkspaceForUser(
  admin: SupabaseAdminClient,
  userId: string
): Promise<WorkspaceReferralRow | null> {
  const { data: owned } = await admin
    .from('workspaces')
    .select('id, referral_code_used')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (owned?.id) {
    return owned as WorkspaceReferralRow;
  }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership?.workspace_id) return null;

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, referral_code_used')
    .eq('id', membership.workspace_id)
    .maybeSingle();

  return (workspace as WorkspaceReferralRow | null) ?? null;
}

function addMonths(isoString: string, months: number): string {
  const value = new Date(isoString);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString();
}

function deriveReferralStatus(
  subscriptionStatus: Stripe.Subscription.Status,
  firstPaidAt: string | null,
  eligibleUntil: string | null
): SalespersonReferralRow['status'] {
  if (eligibleUntil && new Date(eligibleUntil).getTime() <= Date.now()) {
    return 'expired';
  }

  if (
    subscriptionStatus === 'canceled' ||
    subscriptionStatus === 'unpaid' ||
    subscriptionStatus === 'incomplete_expired'
  ) {
    return 'canceled';
  }

  return firstPaidAt ? 'active' : 'attributed';
}

export async function syncSalespersonReferralForSubscription(
  admin: SupabaseAdminClient,
  userId: string,
  subscription: Stripe.Subscription
): Promise<SalespersonReferralRow | null> {
  const workspace = await resolvePrimaryWorkspaceForUser(admin, userId);
  if (!workspace?.id) return null;

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const { data: existing, error: existingError } = await admin
    .from('salesperson_referrals')
    .select(
      'id, salesperson_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
    )
    .eq('referred_workspace_id', workspace.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingReferral = (existing as SalespersonReferralRow | null) ?? null;
  if (existingReferral) {
    const nextStatus = deriveReferralStatus(
      subscription.status,
      existingReferral.first_paid_at,
      existingReferral.eligible_until
    );

    const { data: updated, error: updateError } = await admin
      .from('salesperson_referrals')
      .update({
        referred_user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        stripe_subscription_status: subscription.status,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingReferral.id)
      .select(
        'id, salesperson_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return (updated as SalespersonReferralRow | null) ?? existingReferral;
  }

  const referralCode = workspace.referral_code_used?.trim();
  if (!referralCode) return null;

  const salesperson = await resolveActiveSalespersonReferralCode(admin, referralCode);
  if (!salesperson?.id) return null;

  const referralPayload = {
    salesperson_id: salesperson.id,
    referred_user_id: userId,
    referred_workspace_id: workspace.id,
    referral_code: salesperson.referral_code?.trim() || referralCode,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_subscription_status: subscription.status,
    commission_rate_bps: salesperson.commission_rate_bps ?? DEFAULT_COMMISSION_RATE_BPS,
    commission_duration_months:
      salesperson.commission_duration_months ?? DEFAULT_COMMISSION_DURATION_MONTHS,
    status: deriveReferralStatus(subscription.status, null, null),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertError } = await admin
    .from('salesperson_referrals')
    .upsert(referralPayload, { onConflict: 'referred_workspace_id' })
    .select(
      'id, salesperson_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
    )
    .maybeSingle();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return (inserted as SalespersonReferralRow | null) ?? null;
}

function invoicePaidAt(invoice: Stripe.Invoice): string {
  const paidAtUnix = invoice.status_transitions?.paid_at ?? invoice.created;
  return new Date(paidAtUnix * 1000).toISOString();
}

export async function recordSalespersonCommissionForInvoice(
  admin: SupabaseAdminClient,
  userId: string,
  subscription: Stripe.Subscription,
  invoice: Stripe.Invoice
): Promise<boolean> {
  const referral = await syncSalespersonReferralForSubscription(admin, userId, subscription);
  if (!referral?.id) return false;

  const revenueAmountCents = Math.max(0, invoice.subtotal ?? invoice.amount_paid ?? 0);
  if (revenueAmountCents <= 0) return true;

  const earnedAt = invoicePaidAt(invoice);
  const firstPaidAt = referral.first_paid_at ?? earnedAt;
  const eligibleUntil =
    referral.eligible_until ?? addMonths(firstPaidAt, referral.commission_duration_months);

  if (new Date(earnedAt).getTime() > new Date(eligibleUntil).getTime()) {
    await admin
      .from('salesperson_referrals')
      .update({
        first_paid_at: firstPaidAt,
        eligible_until: eligibleUntil,
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('id', referral.id);
    return true;
  }

  const commissionAmountCents = Math.round(
    (revenueAmountCents * referral.commission_rate_bps) / 10000
  );

  await admin
    .from('salesperson_referrals')
    .update({
      first_paid_at: firstPaidAt,
      eligible_until: eligibleUntil,
      last_paid_at: earnedAt,
      stripe_subscription_status: subscription.status,
      status: deriveReferralStatus(subscription.status, firstPaidAt, eligibleUntil),
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const { error } = await admin.from('salesperson_commissions').upsert(
    {
      salesperson_referral_id: referral.id,
      salesperson_id: referral.salesperson_id,
      referred_user_id: referral.referred_user_id,
      referred_workspace_id: referral.referred_workspace_id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_invoice_id: invoice.id,
      revenue_amount_cents: revenueAmountCents,
      commission_rate_bps: referral.commission_rate_bps,
      commission_amount_cents: commissionAmountCents,
      currency: (invoice.currency ?? 'usd').toUpperCase(),
      earned_at: earnedAt,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_invoice_id' }
  );

  if (error) {
    throw new Error(error.message);
  }

  return true;
}
