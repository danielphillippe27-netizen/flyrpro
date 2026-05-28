import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getStripeModeEnv } from '@/app/lib/billing/stripe-env';
import { createAdminClient } from '@/lib/supabase/server';

export type SupabaseAdmin = ReturnType<typeof createAdminClient>;

type AmbassadorApplicationRow = {
  id: string;
  full_name: string;
  status: 'applied' | 'approved' | 'rejected' | 'paused';
  referral_code: string | null;
  referral_code_max_uses: number | null;
  commission_rate_bps: number | null;
  commission_duration_months: number | null;
  stripe_payouts_enabled: boolean | null;
  stripe_promotion_code_id: string | null;
};

type AmbassadorReferralRow = {
  id: string;
  ambassador_application_id: string;
  referred_user_id: string;
  referred_workspace_id: string;
  referral_code: string;
  source: string | null;
  campaign: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  commission_rate_bps: number;
  commission_duration_months: number;
  first_paid_at: string | null;
  eligible_until: string | null;
  last_paid_at: string | null;
  status: 'attributed' | 'active' | 'expired' | 'canceled';
};

type WorkspaceReferralRow = {
  id: string;
  referral_code_used: string | null;
};

export type AmbassadorReferralCodeStats = {
  referralCode: string;
  maxUses: number | null;
  useCount: number;
  remainingUses: number | null;
  isAtLimit: boolean;
};

export type AmbassadorPromotionCodeSyncResult = {
  promotionCodeId: string | null;
  synced: boolean;
  skippedReason: string | null;
};

export const DEFAULT_AMBASSADOR_COMMISSION_RATE_BPS = 2500;
export const DEFAULT_AMBASSADOR_COMMISSION_DURATION_MONTHS = 12;
const MAX_CUSTOM_REFERRAL_CODE_LENGTH = 20;
const MIN_CUSTOM_REFERRAL_CODE_LENGTH = 4;

export type ValidAmbassadorReferral = AmbassadorApplicationRow & {
  referralStats: AmbassadorReferralCodeStats | null;
};

export type AmbassadorReferralValidationResult =
  | {
      ok: true;
      referralCode: string;
      ambassador: ValidAmbassadorReferral;
    }
  | {
      ok: false;
      referralCode: string | null;
      reason: 'empty' | 'invalid' | 'maxed';
      message: string;
    };

export function isMissingAmbassadorSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not find the table') ||
    (normalized.includes('could not find') && normalized.includes('column')) ||
    (normalized.includes('relation') && normalized.includes('does not exist')) ||
    (normalized.includes('column') && normalized.includes('does not exist'))
  );
}

export function normalizeAmbassadorReferralCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, MAX_CUSTOM_REFERRAL_CODE_LENGTH);
}

export function slugifyAmbassadorReferralCode(value: string): string {
  const normalized = normalizeAmbassadorReferralCodeInput(value).slice(0, 12);
  return normalized || 'FLYRAMB';
}

function assertValidCustomReferralCode(value: string): string {
  const normalized = normalizeAmbassadorReferralCodeInput(value);
  if (normalized.length < MIN_CUSTOM_REFERRAL_CODE_LENGTH) {
    throw new Error(
      `Referral code must be at least ${MIN_CUSTOM_REFERRAL_CODE_LENGTH} letters or numbers.`
    );
  }
  return normalized;
}

async function persistAmbassadorReferralCode(
  admin: SupabaseAdmin,
  applicationId: string,
  referralCode: string
): Promise<string> {
  const { error: updateError } = await admin
    .from('ambassador_applications')
    .update({
      referral_code: referralCode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return referralCode;
}

async function ensureReferralCodeIsAvailable(
  admin: SupabaseAdmin,
  applicationId: string,
  candidate: string
): Promise<void> {
  const { data, error } = await admin
    .from('ambassador_applications')
    .select('id')
    .ilike('referral_code', candidate)
    .neq('id', applicationId)
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  if (data && data.length > 0) {
    throw new Error(`Referral code "${candidate}" is already in use.`);
  }
}

export async function ensureAmbassadorReferralCode(
  admin: SupabaseAdmin,
  params: {
    applicationId: string;
    fullName: string;
    existingReferralCode?: string | null;
    preferredReferralCode?: string | null;
  }
): Promise<string> {
  const preferred = params.preferredReferralCode?.trim();
  if (preferred) {
    const normalizedPreferred = assertValidCustomReferralCode(preferred);
    const normalizedExisting = params.existingReferralCode?.trim().toUpperCase();

    if (normalizedPreferred === normalizedExisting) {
      return normalizedPreferred;
    }

    await ensureReferralCodeIsAvailable(admin, params.applicationId, normalizedPreferred);
    return persistAmbassadorReferralCode(admin, params.applicationId, normalizedPreferred);
  }

  const existing = params.existingReferralCode?.trim();
  if (existing) {
    return existing.toUpperCase();
  }

  const baseCode = slugifyAmbassadorReferralCode(params.fullName);

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseCode : `${baseCode}${index + 1}`;
    try {
      await ensureReferralCodeIsAvailable(admin, params.applicationId, candidate);
      return await persistAmbassadorReferralCode(admin, params.applicationId, candidate);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('already in use') &&
        index < 99
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to generate a unique ambassador referral code.');
}

export async function countAmbassadorReferralCodeUses(
  admin: SupabaseAdmin,
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

export async function getAmbassadorReferralCodeStats(
  admin: SupabaseAdmin,
  referralCode: string | null | undefined,
  maxUses: number | null | undefined
): Promise<AmbassadorReferralCodeStats | null> {
  const normalizedReferralCode =
    typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
  if (!normalizedReferralCode) {
    return null;
  }

  const useCount = await countAmbassadorReferralCodeUses(admin, normalizedReferralCode);
  const normalizedMaxUses =
    typeof maxUses === 'number' && Number.isFinite(maxUses) && maxUses > 0
      ? Math.trunc(maxUses)
      : null;

  return {
    referralCode: normalizedReferralCode,
    maxUses: normalizedMaxUses,
    useCount,
    remainingUses:
      normalizedMaxUses == null ? null : Math.max(0, normalizedMaxUses - useCount),
    isAtLimit: normalizedMaxUses != null && useCount >= normalizedMaxUses,
  };
}

export async function resolveApprovedAmbassadorReferralCode(
  admin: SupabaseAdmin,
  referralCode: string | null | undefined
): Promise<(AmbassadorApplicationRow & { referralStats: AmbassadorReferralCodeStats | null }) | null> {
  const trimmed = referralCode?.trim();
  if (!trimmed) return null;

  let data: AmbassadorApplicationRow | null = null;
  const primaryResponse = await admin
    .from('ambassador_applications')
    .select(
      'id, full_name, status, referral_code, referral_code_max_uses, commission_rate_bps, commission_duration_months, stripe_payouts_enabled, stripe_promotion_code_id'
    )
    .ilike('referral_code', trimmed)
    .eq('status', 'approved')
    .limit(1)
    .maybeSingle();

  if (primaryResponse.error) {
    if (!isMissingAmbassadorSchemaError(primaryResponse.error.message)) {
      throw new Error(primaryResponse.error.message);
    }

    const legacyResponse = await admin
      .from('ambassador_applications')
      .select(
        'id, full_name, status, referral_code, commission_rate_bps, commission_duration_months, stripe_payouts_enabled'
      )
      .ilike('referral_code', trimmed)
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle();

    if (legacyResponse.error) {
      throw new Error(legacyResponse.error.message);
    }

    data = legacyResponse.data
      ? ({
          ...legacyResponse.data,
          referral_code_max_uses: null,
          stripe_promotion_code_id: null,
        } as AmbassadorApplicationRow)
      : null;
  } else {
    data = (primaryResponse.data as AmbassadorApplicationRow | null) ?? null;
  }

  const ambassador = data;
  if (!ambassador) {
    return null;
  }

  const referralStats = await getAmbassadorReferralCodeStats(
    admin,
    ambassador.referral_code,
    ambassador.referral_code_max_uses
  );

  return {
    ...ambassador,
    referralStats,
  };
}

export async function validateAmbassadorReferralCodeForOnboarding(
  admin: SupabaseAdmin,
  referralCode: string | null | undefined
): Promise<AmbassadorReferralValidationResult> {
  const normalizedReferralCode =
    typeof referralCode === 'string'
      ? normalizeAmbassadorReferralCodeInput(referralCode)
      : '';

  if (!normalizedReferralCode) {
    return {
      ok: false,
      referralCode: null,
      reason: 'empty',
      message: 'Referral code is optional.',
    };
  }

  const ambassador = await resolveApprovedAmbassadorReferralCode(
    admin,
    normalizedReferralCode
  );

  if (!ambassador) {
    return {
      ok: false,
      referralCode: normalizedReferralCode,
      reason: 'invalid',
      message: 'Enter a valid ambassador referral code, or leave this blank.',
    };
  }

  if (ambassador.referralStats?.isAtLimit) {
    return {
      ok: false,
      referralCode: normalizedReferralCode,
      reason: 'maxed',
      message:
        'That ambassador referral code has reached its limit. Please ask for a new code.',
    };
  }

  return {
    ok: true,
    referralCode: ambassador.referral_code?.trim().toUpperCase() || normalizedReferralCode,
    ambassador,
  };
}

export async function upsertAmbassadorReferralAttribution(
  admin: SupabaseAdmin,
  params: {
    ambassador: ValidAmbassadorReferral;
    referredUserId: string;
    referredWorkspaceId: string;
    referralCode: string;
    source?: string | null;
    campaign?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeSubscriptionStatus?: string | null;
  }
): Promise<AmbassadorReferralRow | null> {
  const nowIso = new Date().toISOString();
  const referralPayload = {
    ambassador_application_id: params.ambassador.id,
    referred_user_id: params.referredUserId,
    referred_workspace_id: params.referredWorkspaceId,
    referral_code:
      params.ambassador.referral_code?.trim().toUpperCase() ||
      normalizeAmbassadorReferralCodeInput(params.referralCode),
    source: params.source ?? null,
    campaign: params.campaign ?? null,
    stripe_customer_id: params.stripeCustomerId ?? null,
    stripe_subscription_id: params.stripeSubscriptionId ?? null,
    stripe_subscription_status: params.stripeSubscriptionStatus ?? null,
    commission_rate_bps:
      params.ambassador.commission_rate_bps ?? DEFAULT_AMBASSADOR_COMMISSION_RATE_BPS,
    commission_duration_months:
      params.ambassador.commission_duration_months ??
      DEFAULT_AMBASSADOR_COMMISSION_DURATION_MONTHS,
    status: 'attributed',
    updated_at: nowIso,
  };

  const selectColumns =
    'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, source, campaign, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status';

  const primary = await admin
    .from('ambassador_referrals')
    .upsert(referralPayload, { onConflict: 'referred_workspace_id' })
    .select(selectColumns)
    .maybeSingle();

  if (!primary.error) {
    return (primary.data as AmbassadorReferralRow | null) ?? null;
  }

  if (!isMissingAmbassadorSchemaError(primary.error.message)) {
    throw new Error(primary.error.message);
  }

  const legacyReferralPayload: Omit<typeof referralPayload, 'source' | 'campaign'> = {
    ambassador_application_id: referralPayload.ambassador_application_id,
    referred_user_id: referralPayload.referred_user_id,
    referred_workspace_id: referralPayload.referred_workspace_id,
    referral_code: referralPayload.referral_code,
    stripe_customer_id: referralPayload.stripe_customer_id,
    stripe_subscription_id: referralPayload.stripe_subscription_id,
    stripe_subscription_status: referralPayload.stripe_subscription_status,
    commission_rate_bps: referralPayload.commission_rate_bps,
    commission_duration_months: referralPayload.commission_duration_months,
    status: referralPayload.status,
    updated_at: referralPayload.updated_at,
  };

  const legacy = await admin
    .from('ambassador_referrals')
    .upsert(legacyReferralPayload, { onConflict: 'referred_workspace_id' })
    .select(
      'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
    )
    .maybeSingle();

  if (legacy.error) {
    throw new Error(legacy.error.message);
  }

  const legacyData = legacy.data as Omit<AmbassadorReferralRow, 'source' | 'campaign'> | null;
  return legacyData ? { ...legacyData, source: null, campaign: null } : null;
}

function getAmbassadorPromotionCouponId(): string | null {
  const value = getStripeModeEnv('STRIPE_AMBASSADOR_PROMOTION_COUPON_ID');
  return value ? value : null;
}

function extractPromotionCodeCouponId(
  promotionCode: Stripe.PromotionCode | null | undefined
): string | null {
  if (!promotionCode) return null;
  const couponValue =
    promotionCode.promotion?.type === 'coupon'
      ? promotionCode.promotion.coupon
      : undefined;
  if (typeof couponValue === 'string') return couponValue;
  return couponValue?.id ?? null;
}

async function findActivePromotionCodeByCode(
  code: string
): Promise<Stripe.PromotionCode | null> {
  const results = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 10,
  });

  return results.data.find(
    (entry) => entry.code.trim().toUpperCase() === code.trim().toUpperCase()
  ) ?? null;
}

export async function syncAmbassadorStripePromotionCode(params: {
  applicationId: string;
  referralCode: string;
  referralCodeMaxUses?: number | null;
  existingPromotionCodeId?: string | null;
}): Promise<AmbassadorPromotionCodeSyncResult> {
  const couponId = getAmbassadorPromotionCouponId();
  if (!couponId) {
    return {
      promotionCodeId: params.existingPromotionCodeId ?? null,
      synced: false,
      skippedReason:
        'Stripe ambassador promotion coupon is not configured. Set STRIPE_AMBASSADOR_PROMOTION_COUPON_ID_TEST or STRIPE_AMBASSADOR_PROMOTION_COUPON_ID_LIVE for auto-created Stripe promo codes.',
    };
  }

  const normalizedCode = assertValidCustomReferralCode(params.referralCode);
  const maxRedemptions =
    typeof params.referralCodeMaxUses === 'number' &&
    Number.isFinite(params.referralCodeMaxUses) &&
    params.referralCodeMaxUses > 0
      ? Math.trunc(params.referralCodeMaxUses)
      : undefined;

  let existingPromotionCode: Stripe.PromotionCode | null = null;
  if (params.existingPromotionCodeId) {
    try {
      existingPromotionCode = await stripe.promotionCodes.retrieve(
        params.existingPromotionCodeId
      );
    } catch {
      existingPromotionCode = null;
    }
  }

  const matchingActiveCode = await findActivePromotionCodeByCode(normalizedCode);
  if (
    matchingActiveCode &&
    matchingActiveCode.id !== existingPromotionCode?.id &&
    matchingActiveCode.metadata?.ambassador_application_id !== params.applicationId
  ) {
    throw new Error(
      `Stripe promotion code "${normalizedCode}" already exists. Choose a different code.`
    );
  }

  const promotionCodeToCompare = existingPromotionCode ?? matchingActiveCode;
  const currentMaxRedemptions = promotionCodeToCompare?.max_redemptions ?? null;
  const desiredMaxRedemptions = maxRedemptions ?? null;
  const currentCouponId = extractPromotionCodeCouponId(promotionCodeToCompare);
  const isReusable =
    promotionCodeToCompare?.active &&
    promotionCodeToCompare.code.trim().toUpperCase() === normalizedCode &&
    currentMaxRedemptions === desiredMaxRedemptions &&
    currentCouponId === couponId;

  if (isReusable && promotionCodeToCompare) {
    return {
      promotionCodeId: promotionCodeToCompare.id,
      synced: true,
      skippedReason: null,
    };
  }

  if (promotionCodeToCompare?.active) {
    await stripe.promotionCodes.update(promotionCodeToCompare.id, {
      active: false,
    });
  }

  const created = await stripe.promotionCodes.create({
    promotion: {
      type: 'coupon',
      coupon: couponId,
    },
    code: normalizedCode,
    ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
    metadata: {
      ambassador_application_id: params.applicationId,
      source: 'flyr_ambassador_program',
    },
  });

  return {
    promotionCodeId: created.id,
    synced: true,
    skippedReason: null,
  };
}

async function resolvePrimaryWorkspaceForUser(
  admin: SupabaseAdmin,
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

  if (!membership?.workspace_id) {
    return null;
  }

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
): AmbassadorReferralRow['status'] {
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

  if (firstPaidAt) {
    return 'active';
  }

  return 'attributed';
}

async function findApprovedAmbassadorByReferralCode(
  admin: SupabaseAdmin,
  referralCode: string
): Promise<AmbassadorApplicationRow | null> {
  const resolved = await resolveApprovedAmbassadorReferralCode(admin, referralCode);
  return resolved;
}

export async function syncAmbassadorReferralForSubscription(
  admin: SupabaseAdmin,
  userId: string,
  subscription: Stripe.Subscription
): Promise<AmbassadorReferralRow | null> {
  const workspace = await resolvePrimaryWorkspaceForUser(admin, userId);
  if (!workspace?.id) {
    return null;
  }

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const { data: existing, error: existingError } = await admin
    .from('ambassador_referrals')
    .select(
      'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
    )
    .eq('referred_workspace_id', workspace.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingReferral = (existing as AmbassadorReferralRow | null) ?? null;

  if (existingReferral) {
    const nextStatus = deriveReferralStatus(
      subscription.status,
      existingReferral.first_paid_at,
      existingReferral.eligible_until
    );

    const { data: updated, error: updateError } = await admin
      .from('ambassador_referrals')
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
        'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
      )
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return (updated as AmbassadorReferralRow | null) ?? existingReferral;
  }

  const referralCode = workspace.referral_code_used?.trim();
  if (!referralCode) {
    return null;
  }

  const ambassador = await findApprovedAmbassadorByReferralCode(admin, referralCode);
  if (!ambassador?.id) {
    return null;
  }

  const referralPayload = {
    ambassador_application_id: ambassador.id,
    referred_user_id: userId,
    referred_workspace_id: workspace.id,
    referral_code: ambassador.referral_code?.trim() || referralCode,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_subscription_status: subscription.status,
    commission_rate_bps:
      ambassador.commission_rate_bps ?? DEFAULT_AMBASSADOR_COMMISSION_RATE_BPS,
    commission_duration_months:
      ambassador.commission_duration_months ?? DEFAULT_AMBASSADOR_COMMISSION_DURATION_MONTHS,
    status: deriveReferralStatus(subscription.status, null, null),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertError } = await admin
    .from('ambassador_referrals')
    .upsert(referralPayload, { onConflict: 'referred_workspace_id' })
    .select(
      'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, commission_rate_bps, commission_duration_months, first_paid_at, eligible_until, last_paid_at, status'
    )
    .maybeSingle();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return (inserted as AmbassadorReferralRow | null) ?? null;
}

function invoicePaidAt(invoice: Stripe.Invoice): string {
  const paidAtUnix = invoice.status_transitions?.paid_at ?? invoice.created;
  return new Date(paidAtUnix * 1000).toISOString();
}

export async function recordAmbassadorCommissionForInvoice(
  admin: SupabaseAdmin,
  userId: string,
  subscription: Stripe.Subscription,
  invoice: Stripe.Invoice
): Promise<void> {
  const referral = await syncAmbassadorReferralForSubscription(admin, userId, subscription);
  if (!referral?.id) {
    return;
  }

  const revenueAmountCents = Math.max(0, invoice.subtotal ?? invoice.amount_paid ?? 0);
  if (revenueAmountCents <= 0) {
    return;
  }

  const earnedAt = invoicePaidAt(invoice);
  const firstPaidAt = referral.first_paid_at ?? earnedAt;
  const eligibleUntil =
    referral.eligible_until ?? addMonths(firstPaidAt, referral.commission_duration_months);

  if (new Date(earnedAt).getTime() > new Date(eligibleUntil).getTime()) {
    await admin
      .from('ambassador_referrals')
      .update({
        first_paid_at: firstPaidAt,
        eligible_until: eligibleUntil,
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('id', referral.id);
    return;
  }

  const commissionAmountCents = Math.round(
    (revenueAmountCents * referral.commission_rate_bps) / 10000
  );

  await admin
    .from('ambassador_referrals')
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

  const { error } = await admin.from('ambassador_commissions').upsert(
    {
      ambassador_referral_id: referral.id,
      ambassador_application_id: referral.ambassador_application_id,
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
}
