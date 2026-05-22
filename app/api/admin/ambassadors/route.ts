import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  ensureAmbassadorReferralCode,
  getAmbassadorReferralCodeStats,
  isMissingAmbassadorSchemaError,
  syncAmbassadorStripePromotionCode,
} from '@/app/lib/billing/ambassador-program';
import { z } from 'zod';

type AmbassadorApplicationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  primary_niche: string;
  primary_platform: string;
  audience_size: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_handle: string | null;
  website_url: string | null;
  audience_summary: string | null;
  why_flyr: string;
  promotion_plan: string | null;
  status: 'applied' | 'approved' | 'rejected' | 'paused';
  review_notes: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_onboarding_completed: boolean;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  referral_code: string | null;
  referral_code_max_uses: number | null;
  stripe_promotion_code_id: string | null;
  commission_rate_bps: number;
  commission_duration_months: number;
};

type AmbassadorCommissionRow = {
  id: string;
  ambassador_application_id: string;
  referred_workspace_id: string;
  referred_user_id: string;
  stripe_invoice_id: string;
  revenue_amount_cents: number;
  commission_amount_cents: number;
  commission_rate_bps: number;
  currency: string;
  earned_at: string;
  status: 'pending' | 'paid' | 'voided';
};

type AmbassadorPayoutBatchRow = {
  id: string;
  ambassador_application_id: string | null;
  currency: string;
  total_commission_cents: number;
  status: 'draft' | 'processing' | 'paid' | 'failed';
  paid_at: string | null;
  created_at: string;
  stripe_transfer_id: string | null;
  failure_reason: string | null;
};

type QueryRowsResponse<T> = {
  data: T[] | null;
  error: PostgrestError | null;
  count?: number | null;
};

const SELECT_FIELDS = `
  id,
  created_at,
  updated_at,
  full_name,
  email,
  phone,
  city,
  primary_niche,
  primary_platform,
  audience_size,
  instagram_handle,
  tiktok_handle,
  youtube_handle,
  website_url,
  audience_summary,
  why_flyr,
  promotion_plan,
  status,
  review_notes,
  approved_at,
  rejected_at,
  stripe_connect_account_id,
  stripe_onboarding_completed,
  stripe_details_submitted,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  referral_code,
  referral_code_max_uses,
  stripe_promotion_code_id,
  commission_rate_bps,
  commission_duration_months
`;

const LEGACY_SELECT_FIELDS = `
  id,
  created_at,
  updated_at,
  full_name,
  email,
  phone,
  city,
  primary_niche,
  primary_platform,
  audience_size,
  instagram_handle,
  tiktok_handle,
  youtube_handle,
  website_url,
  audience_summary,
  why_flyr,
  promotion_plan,
  status,
  review_notes,
  approved_at,
  rejected_at,
  stripe_connect_account_id,
  stripe_onboarding_completed,
  stripe_details_submitted,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  referral_code,
  commission_rate_bps,
  commission_duration_months
`;

const referralCodeMaxUsesSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.union([z.number().int().min(1).max(10000), z.null()]).optional());

const commissionRateBpsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().min(1).max(10000).optional());

const commissionDurationMonthsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().min(1).max(36).optional());

const manualAmbassadorSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  primaryNiche: z.string().trim().min(2).max(120),
  primaryPlatform: z.string().trim().min(2).max(40),
  audienceSize: z.string().trim().max(80).optional().or(z.literal('')),
  instagramHandle: z.string().trim().max(80).optional().or(z.literal('')),
  tiktokHandle: z.string().trim().max(80).optional().or(z.literal('')),
  youtubeHandle: z.string().trim().max(120).optional().or(z.literal('')),
  websiteUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  audienceSummary: z.string().trim().max(500).optional().or(z.literal('')),
  whyFlyr: z.string().trim().min(2).max(1500),
  promotionPlan: z.string().trim().max(1000).optional().or(z.literal('')),
  status: z.enum(['applied', 'approved']).default('approved'),
  reviewNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  referralCodeMaxUses: referralCodeMaxUsesSchema,
  commissionRateBps: commissionRateBpsSchema,
  commissionDurationMonths: commissionDurationMonthsSchema,
});

function normalizeOptional(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function hasMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('column') && normalized.includes('does not exist');
}

function totalsByCurrency(
  commissions: AmbassadorCommissionRow[]
): Array<{ currency: string; amountCents: number; commissionCount: number }> {
  const totals = new Map<string, { currency: string; amountCents: number; commissionCount: number }>();

  for (const commission of commissions) {
    const currency = (commission.currency || 'USD').toUpperCase();
    const current = totals.get(currency) ?? {
      currency,
      amountCents: 0,
      commissionCount: 0,
    };
    current.amountCents += commission.commission_amount_cents ?? 0;
    current.commissionCount += 1;
    totals.set(currency, current);
  }

  return Array.from(totals.values()).sort((a, b) => b.amountCents - a.amountCents);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'), 25, 100);

    const [
      initialApplicationsRes,
      appliedCountRes,
      approvedCountRes,
      payoutsReadyCountRes,
      pendingCommissionsRes,
      recentCommissionsRes,
    ] = await Promise.all([
        auth.admin
          .from('ambassador_applications')
          .select(SELECT_FIELDS)
          .order('created_at', { ascending: false })
          .limit(limit),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'applied'),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'approved'),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('stripe_payouts_enabled', true),
        auth.admin
          .from('ambassador_commissions')
          .select(
            'id, ambassador_application_id, referred_workspace_id, referred_user_id, stripe_invoice_id, revenue_amount_cents, commission_amount_cents, commission_rate_bps, currency, earned_at, status'
          )
          .eq('status', 'pending')
          .order('earned_at', { ascending: false })
          .limit(1000),
        auth.admin
          .from('ambassador_commissions')
          .select(
            'id, ambassador_application_id, referred_workspace_id, referred_user_id, stripe_invoice_id, revenue_amount_cents, commission_amount_cents, commission_rate_bps, currency, earned_at, status'
          )
          .order('earned_at', { ascending: false })
          .limit(25),
      ]);

    let applicationsRes: QueryRowsResponse<Partial<AmbassadorApplicationRow>> = initialApplicationsRes;
    let payoutBatchesRes: QueryRowsResponse<AmbassadorPayoutBatchRow> = await auth.admin
      .from('ambassador_payout_batches')
      .select(
        'id, ambassador_application_id, currency, total_commission_cents, status, paid_at, created_at, stripe_transfer_id, failure_reason'
      )
      .order('created_at', { ascending: false })
      .limit(15);

    if (applicationsRes.error && hasMissingColumnError(applicationsRes.error.message)) {
      applicationsRes = await auth.admin
        .from('ambassador_applications')
        .select(LEGACY_SELECT_FIELDS)
        .order('created_at', { ascending: false })
        .limit(limit);
    }

    if (payoutBatchesRes.error && hasMissingColumnError(payoutBatchesRes.error.message)) {
      payoutBatchesRes = { data: [], error: null, count: null };
    }

    const possibleErrors = [
      applicationsRes.error,
      appliedCountRes.error,
      approvedCountRes.error,
      payoutsReadyCountRes.error,
      pendingCommissionsRes.error,
      recentCommissionsRes.error,
      payoutBatchesRes.error,
    ].filter(Boolean);

    const missingRelation = possibleErrors.some((error) =>
      isMissingAmbassadorSchemaError(error?.message)
    );

    if (missingRelation) {
      return NextResponse.json({
        setupRequired: true,
        kpis: {
          applied: 0,
          approved: 0,
          payoutsReady: 0,
        },
        applications: [],
        payoutQueue: {
          readyTotals: [],
          pendingSetupTotals: [],
          readyCommissionCount: 0,
          pendingSetupCommissionCount: 0,
          readyByAmbassador: [],
          recentCommissions: [],
          payoutHistory: [],
        },
      });
    }

    const firstError = possibleErrors[0];
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }

    const applicationRows = ((applicationsRes.data ?? []) as Partial<AmbassadorApplicationRow>[])
      .map((row) => ({
        ...row,
        referral_code_max_uses:
          typeof row.referral_code_max_uses === 'number' ? row.referral_code_max_uses : null,
        stripe_promotion_code_id:
          typeof row.stripe_promotion_code_id === 'string' ? row.stripe_promotion_code_id : null,
      })) as AmbassadorApplicationRow[];
    const pendingCommissions = (pendingCommissionsRes.data ?? []) as AmbassadorCommissionRow[];
    const recentCommissions = (recentCommissionsRes.data ?? []) as AmbassadorCommissionRow[];
    const payoutBatches = (payoutBatchesRes.data ?? []) as AmbassadorPayoutBatchRow[];
    const referencedAmbassadorIds = Array.from(
      new Set(
        [...pendingCommissions, ...recentCommissions]
          .map((row) => row.ambassador_application_id)
          .filter(Boolean)
      )
    );
    for (const batch of payoutBatches) {
      if (
        batch.ambassador_application_id &&
        !referencedAmbassadorIds.includes(batch.ambassador_application_id)
      ) {
        referencedAmbassadorIds.push(batch.ambassador_application_id);
      }
    }

    const missingApplicationIds = referencedAmbassadorIds.filter(
      (id) => !applicationRows.some((row) => row.id === id)
    );

    let lookupRows: AmbassadorApplicationRow[] = [];
    if (missingApplicationIds.length > 0) {
      let lookupResponse: QueryRowsResponse<Partial<AmbassadorApplicationRow>> = await auth.admin
        .from('ambassador_applications')
        .select(SELECT_FIELDS)
        .in('id', missingApplicationIds);

      if (lookupResponse.error && hasMissingColumnError(lookupResponse.error.message)) {
        lookupResponse = await auth.admin
          .from('ambassador_applications')
          .select(LEGACY_SELECT_FIELDS)
          .in('id', missingApplicationIds);
      }

      const { data, error } = lookupResponse;

      if (error) {
        if (isMissingAmbassadorSchemaError(error.message)) {
          return NextResponse.json({
            setupRequired: true,
            kpis: {
              applied: 0,
              approved: 0,
              payoutsReady: 0,
            },
            applications: [],
            payoutQueue: {
              readyTotals: [],
              pendingSetupTotals: [],
              readyCommissionCount: 0,
              pendingSetupCommissionCount: 0,
              readyByAmbassador: [],
              recentCommissions: [],
              payoutHistory: [],
            },
          });
        }

        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      lookupRows = ((data ?? []) as Partial<AmbassadorApplicationRow>[]).map((row) => ({
        ...row,
        referral_code_max_uses:
          typeof row.referral_code_max_uses === 'number' ? row.referral_code_max_uses : null,
        stripe_promotion_code_id:
          typeof row.stripe_promotion_code_id === 'string' ? row.stripe_promotion_code_id : null,
      })) as AmbassadorApplicationRow[];
    }

    const applicationMap = new Map(
      [...applicationRows, ...lookupRows].map((row) => [row.id, row] as const)
    );

    const applications = await Promise.all(
      applicationRows.map(async (row) => {
        const referralStats = await getAmbassadorReferralCodeStats(
          auth.admin,
          row.referral_code,
          row.referral_code_max_uses
        );

        return {
          id: row.id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          fullName: row.full_name,
          email: row.email,
          phone: row.phone,
          city: row.city,
          primaryNiche: row.primary_niche,
          primaryPlatform: row.primary_platform,
          audienceSize: row.audience_size,
          instagramHandle: row.instagram_handle,
          tiktokHandle: row.tiktok_handle,
          youtubeHandle: row.youtube_handle,
          websiteUrl: row.website_url,
          audienceSummary: row.audience_summary,
          whyFlyr: row.why_flyr,
          promotionPlan: row.promotion_plan,
          status: row.status,
          reviewNotes: row.review_notes,
          approvedAt: row.approved_at,
          rejectedAt: row.rejected_at,
          stripeConnectAccountId: row.stripe_connect_account_id,
          stripeOnboardingCompleted: row.stripe_onboarding_completed,
          stripeDetailsSubmitted: row.stripe_details_submitted,
          stripeChargesEnabled: row.stripe_charges_enabled,
          stripePayoutsEnabled: row.stripe_payouts_enabled,
          referralCode: row.referral_code,
          referralCodeMaxUses: row.referral_code_max_uses,
          referralCodeUseCount: referralStats?.useCount ?? 0,
          referralCodeRemainingUses: referralStats?.remainingUses ?? null,
          stripePromotionCodeId: row.stripe_promotion_code_id,
          commissionRateBps: row.commission_rate_bps,
          commissionDurationMonths: row.commission_duration_months,
        };
      })
    );

    const readyCommissions = pendingCommissions.filter((commission) => {
      const ambassador = applicationMap.get(commission.ambassador_application_id);
      return ambassador?.stripe_payouts_enabled;
    });

    const pendingSetupCommissions = pendingCommissions.filter((commission) => {
      const ambassador = applicationMap.get(commission.ambassador_application_id);
      return !ambassador?.stripe_payouts_enabled;
    });

    const readyByAmbassador = Array.from(
      readyCommissions.reduce((map, commission) => {
        const ambassador = applicationMap.get(commission.ambassador_application_id);
        if (!ambassador) return map;

        const currency = (commission.currency || 'USD').toUpperCase();
        const key = `${commission.ambassador_application_id}:${currency}`;
        const current =
          map.get(key) ??
          {
            ambassadorApplicationId: commission.ambassador_application_id,
            fullName: ambassador.full_name,
            email: ambassador.email,
            referralCode: ambassador.referral_code,
            currency,
            openCommissionCount: 0,
            totalCommissionCents: 0,
            totalRevenueCents: 0,
            oldestEarnedAt: commission.earned_at,
          };

        current.openCommissionCount += 1;
        current.totalCommissionCents += commission.commission_amount_cents ?? 0;
        current.totalRevenueCents += commission.revenue_amount_cents ?? 0;
        if (new Date(commission.earned_at).getTime() < new Date(current.oldestEarnedAt).getTime()) {
          current.oldestEarnedAt = commission.earned_at;
        }

        map.set(key, current);
        return map;
      }, new Map<string, {
        ambassadorApplicationId: string;
        fullName: string;
        email: string;
        referralCode: string | null;
        currency: string;
        openCommissionCount: number;
        totalCommissionCents: number;
        totalRevenueCents: number;
        oldestEarnedAt: string;
      }>())
        .values()
    ).sort((a, b) => b.totalCommissionCents - a.totalCommissionCents);

    const serializedRecentCommissions = recentCommissions.map((commission) => {
      const ambassador = applicationMap.get(commission.ambassador_application_id);
      return {
        id: commission.id,
        ambassadorApplicationId: commission.ambassador_application_id,
        ambassadorName: ambassador?.full_name ?? 'Unknown ambassador',
        ambassadorEmail: ambassador?.email ?? null,
        referralCode: ambassador?.referral_code ?? null,
        referredWorkspaceId: commission.referred_workspace_id,
        referredUserId: commission.referred_user_id,
        stripeInvoiceId: commission.stripe_invoice_id,
        revenueAmountCents: commission.revenue_amount_cents,
        commissionAmountCents: commission.commission_amount_cents,
        commissionRateBps: commission.commission_rate_bps,
        currency: (commission.currency || 'USD').toUpperCase(),
        earnedAt: commission.earned_at,
        status: commission.status,
        payoutsEnabled: ambassador?.stripe_payouts_enabled ?? false,
      };
    });

    const payoutHistory = payoutBatches.map((batch) => {
      const ambassador = batch.ambassador_application_id
        ? applicationMap.get(batch.ambassador_application_id)
        : null;

      return {
        id: batch.id,
        ambassadorApplicationId: batch.ambassador_application_id,
        ambassadorName: ambassador?.full_name ?? 'Unknown ambassador',
        ambassadorEmail: ambassador?.email ?? null,
        referralCode: ambassador?.referral_code ?? null,
        currency: (batch.currency || 'USD').toUpperCase(),
        totalCommissionCents: batch.total_commission_cents ?? 0,
        status: batch.status,
        createdAt: batch.created_at,
        paidAt: batch.paid_at,
        stripeTransferId: batch.stripe_transfer_id,
        failureReason: batch.failure_reason,
      };
    });

    return NextResponse.json({
      setupRequired: false,
      kpis: {
        applied: appliedCountRes.count ?? 0,
        approved: approvedCountRes.count ?? 0,
        payoutsReady: payoutsReadyCountRes.count ?? 0,
      },
      applications,
      payoutQueue: {
        readyTotals: totalsByCurrency(readyCommissions),
        pendingSetupTotals: totalsByCurrency(pendingSetupCommissions),
        readyCommissionCount: readyCommissions.length,
        pendingSetupCommissionCount: pendingSetupCommissions.length,
        readyByAmbassador,
        recentCommissions: serializedRecentCommissions,
        payoutHistory,
      },
    });
  } catch (error) {
    console.error('[api/admin/ambassadors] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => null);
    const parsed = manualAmbassadorSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid ambassador payload.' },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const now = new Date().toISOString();
    const { data, error } = await auth.admin
      .from('ambassador_applications')
      .insert({
        full_name: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: normalizeOptional(payload.phone),
        city: normalizeOptional(payload.city),
        primary_niche: payload.primaryNiche.trim(),
        primary_platform: payload.primaryPlatform.trim(),
        audience_size: normalizeOptional(payload.audienceSize),
        instagram_handle: normalizeOptional(payload.instagramHandle),
        tiktok_handle: normalizeOptional(payload.tiktokHandle),
        youtube_handle: normalizeOptional(payload.youtubeHandle),
        website_url: normalizeOptional(payload.websiteUrl),
        audience_summary: normalizeOptional(payload.audienceSummary),
        why_flyr: payload.whyFlyr.trim(),
        promotion_plan: normalizeOptional(payload.promotionPlan),
        status: payload.status,
        review_notes: normalizeOptional(payload.reviewNotes),
        approved_at: payload.status === 'approved' ? now : null,
        referral_code_max_uses:
          payload.referralCodeMaxUses === undefined ? null : payload.referralCodeMaxUses,
        commission_rate_bps: payload.commissionRateBps ?? 2500,
        commission_duration_months: payload.commissionDurationMonths ?? 12,
      })
      .select(
        'id, full_name, status, referral_code, referral_code_max_uses, stripe_promotion_code_id, commission_rate_bps, commission_duration_months'
      )
      .single();

    if (error) {
      if (isMissingAmbassadorSchemaError(error.message)) {
        return NextResponse.json(
          {
            error:
              'Ambassador storage is not ready yet. Run the latest ambassador migration first.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const shouldEnsureReferralCode = payload.status === 'approved' || !!payload.referralCode;
    const referralCode = shouldEnsureReferralCode
      ? await ensureAmbassadorReferralCode(auth.admin, {
          applicationId: data.id,
          fullName: data.full_name,
          existingReferralCode: data.referral_code,
          preferredReferralCode: payload.referralCode,
        })
      : data.referral_code;

    let stripePromotionCodeId = data.stripe_promotion_code_id;
    let stripePromotionCodeWarning: string | null = null;
    if (referralCode && payload.status === 'approved') {
      const syncResult = await syncAmbassadorStripePromotionCode({
        applicationId: data.id,
        referralCode,
        referralCodeMaxUses:
          payload.referralCodeMaxUses !== undefined
            ? payload.referralCodeMaxUses
            : data.referral_code_max_uses,
        existingPromotionCodeId: stripePromotionCodeId,
      });

      stripePromotionCodeId = syncResult.promotionCodeId;
      stripePromotionCodeWarning = syncResult.skippedReason;

      if (syncResult.promotionCodeId !== data.stripe_promotion_code_id) {
        const { error: promoUpdateError } = await auth.admin
          .from('ambassador_applications')
          .update({
            stripe_promotion_code_id: syncResult.promotionCodeId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', data.id);

        if (promoUpdateError) {
          if (isMissingAmbassadorSchemaError(promoUpdateError.message)) {
            return NextResponse.json(
              {
                error:
                  'Ambassador referral settings are not ready yet. Run the latest ambassador migration first.',
              },
              { status: 500 }
            );
          }

          return NextResponse.json({ error: promoUpdateError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      application: {
        id: data.id,
        status: data.status,
        referralCode,
        referralCodeMaxUses:
          payload.referralCodeMaxUses !== undefined
            ? payload.referralCodeMaxUses
            : data.referral_code_max_uses,
        stripePromotionCodeId,
        commissionRateBps: data.commission_rate_bps,
        commissionDurationMonths: data.commission_duration_months,
      },
      stripePromotionCodeWarning,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors] POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
