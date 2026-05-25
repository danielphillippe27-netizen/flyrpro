import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  ensureSalespersonReferralCode,
  isMissingSalespeopleSchemaError,
} from '@/app/lib/billing/salespeople';

type SalespersonRow = {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string | null;
  territory: string | null;
  referral_code: string | null;
  commission_rate_bps: number;
  commission_duration_months?: number | null;
  status: 'active' | 'paused' | 'inactive';
  notes: string | null;
  stripe_connect_account_id: string | null;
  stripe_onboarding_completed: boolean;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  founder_user_id?: string | null;
  workspace_id?: string | null;
  invite_token?: string | null;
  invited_at?: string | null;
  onboarding_completed_at?: string | null;
  approved_at: string | null;
  paused_at: string | null;
  inactive_at: string | null;
};

type SalespersonCommissionRow = {
  id: string;
  salesperson_id: string;
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

type SalespersonPayoutBatchRow = {
  id: string;
  salesperson_id: string | null;
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
  role,
  territory,
  referral_code,
  commission_rate_bps,
  commission_duration_months,
  status,
  notes,
  stripe_connect_account_id,
  stripe_onboarding_completed,
  stripe_details_submitted,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  founder_user_id,
  workspace_id,
  invite_token,
  invited_at,
  onboarding_completed_at,
  approved_at,
  paused_at,
  inactive_at
`;

const LEGACY_SELECT_FIELDS = `
  id,
  created_at,
  updated_at,
  full_name,
  email,
  phone,
  role,
  territory,
  referral_code,
  commission_rate_bps,
  status,
  notes,
  stripe_connect_account_id,
  stripe_onboarding_completed,
  stripe_details_submitted,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  founder_user_id,
  workspace_id,
  invite_token,
  invited_at,
  onboarding_completed_at,
  approved_at,
  paused_at,
  inactive_at
`;

const commissionRateBpsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().min(1).max(10000).optional());

const salespersonSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  role: z.string().trim().max(120).optional().or(z.literal('')),
  territory: z.string().trim().max(120).optional().or(z.literal('')),
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  commissionRateBps: commissionRateBpsSchema,
  status: z.enum(['active', 'paused', 'inactive']).default('active'),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

function totalsByCurrency(
  commissions: SalespersonCommissionRow[]
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

function normalizeOptional(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function buildSalespersonInviteUrl(origin: string, inviteToken: string | null | undefined): string | null {
  if (!inviteToken) return null;
  const url = new URL('/onboarding', origin);
  url.searchParams.set('salespersonInvite', inviteToken);
  return url.toString();
}

function serializeSalesperson(row: SalespersonRow, origin: string) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    territory: row.territory,
    referralCode: row.referral_code,
    commissionRateBps: row.commission_rate_bps,
    commissionDurationMonths: row.commission_duration_months ?? 12,
    status: row.status,
    notes: row.notes,
    stripeConnectAccountId: row.stripe_connect_account_id,
    stripeOnboardingCompleted: row.stripe_onboarding_completed,
    stripeDetailsSubmitted: row.stripe_details_submitted,
    stripeChargesEnabled: row.stripe_charges_enabled,
    stripePayoutsEnabled: row.stripe_payouts_enabled,
    founderUserId: row.founder_user_id ?? null,
    workspaceId: row.workspace_id ?? null,
    inviteToken: row.invite_token ?? null,
    inviteUrl: buildSalespersonInviteUrl(origin, row.invite_token),
    invitedAt: row.invited_at ?? null,
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
    approvedAt: row.approved_at,
    pausedAt: row.paused_at,
    inactiveAt: row.inactive_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'), 50, 200);

    const [
      initialSalespeopleRes,
      totalCountRes,
      activeCountRes,
      payoutsReadyCountRes,
      stripeLinkedCountRes,
      pendingCommissionsRes,
      recentCommissionsRes,
    ] =
      await Promise.all([
        auth.admin
          .from('salespeople')
          .select(SELECT_FIELDS)
          .order('created_at', { ascending: false })
          .limit(limit),
        auth.admin
          .from('salespeople')
          .select('id', { count: 'exact', head: true }),
        auth.admin
          .from('salespeople')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
        auth.admin
          .from('salespeople')
          .select('id', { count: 'exact', head: true })
          .eq('stripe_payouts_enabled', true),
        auth.admin
          .from('salespeople')
          .select('id', { count: 'exact', head: true })
          .not('stripe_connect_account_id', 'is', null),
        auth.admin
          .from('salesperson_commissions')
          .select(
            'id, salesperson_id, referred_workspace_id, referred_user_id, stripe_invoice_id, revenue_amount_cents, commission_amount_cents, commission_rate_bps, currency, earned_at, status'
          )
          .eq('status', 'pending')
          .order('earned_at', { ascending: false })
          .limit(1000),
        auth.admin
          .from('salesperson_commissions')
          .select(
            'id, salesperson_id, referred_workspace_id, referred_user_id, stripe_invoice_id, revenue_amount_cents, commission_amount_cents, commission_rate_bps, currency, earned_at, status'
          )
          .order('earned_at', { ascending: false })
          .limit(25),
      ]);

    const salespeopleRes: QueryRowsResponse<SalespersonRow> =
      initialSalespeopleRes.error &&
      initialSalespeopleRes.error.message.toLowerCase().includes('commission_duration_months')
        ? await auth.admin
            .from('salespeople')
            .select(LEGACY_SELECT_FIELDS)
            .order('created_at', { ascending: false })
            .limit(limit)
        : initialSalespeopleRes;

    const payoutBatchesRes: QueryRowsResponse<SalespersonPayoutBatchRow> = await auth.admin
      .from('salesperson_payout_batches')
      .select(
        'id, salesperson_id, currency, total_commission_cents, status, paid_at, created_at, stripe_transfer_id, failure_reason'
      )
      .order('created_at', { ascending: false })
      .limit(15);

    const coreErrors = [
      salespeopleRes.error,
      totalCountRes.error,
      activeCountRes.error,
      payoutsReadyCountRes.error,
      stripeLinkedCountRes.error,
    ].filter(Boolean);
    const ledgerErrors = [
      pendingCommissionsRes.error,
      recentCommissionsRes.error,
      payoutBatchesRes.error,
    ].filter(Boolean);
    const ledgerSetupRequired = ledgerErrors.some((error) =>
      isMissingSalespeopleSchemaError(error?.message)
    );
    const possibleErrors = [...coreErrors, ...ledgerErrors.filter((error) =>
      !isMissingSalespeopleSchemaError(error?.message)
    )];

    if (coreErrors.some((error) => isMissingSalespeopleSchemaError(error?.message))) {
      return NextResponse.json({
        setupRequired: true,
        kpis: {
          total: 0,
          active: 0,
          stripeLinked: 0,
          payoutsReady: 0,
        },
        salespeople: [],
        payoutQueue: {
          readyTotals: [],
          pendingSetupTotals: [],
          readyCommissionCount: 0,
          pendingSetupCommissionCount: 0,
          readyBySalesperson: [],
          recentCommissions: [],
          payoutHistory: [],
        },
      });
    }

    const firstError = possibleErrors[0];
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }

    const salespeopleRows = (salespeopleRes as QueryRowsResponse<SalespersonRow>).data ?? [];
    const origin = request.nextUrl.origin;
    const salespeople = salespeopleRows.map((row) => serializeSalesperson(row, origin));
    const pendingCommissions = ledgerSetupRequired
      ? []
      : ((pendingCommissionsRes.data ?? []) as SalespersonCommissionRow[]);
    const recentCommissions = ledgerSetupRequired
      ? []
      : ((recentCommissionsRes.data ?? []) as SalespersonCommissionRow[]);
    const payoutBatches = ledgerSetupRequired
      ? []
      : ((payoutBatchesRes.data ?? []) as SalespersonPayoutBatchRow[]);
    const salespersonMap = new Map(salespeopleRows.map((row) => [row.id, row] as const));

    const readyCommissions = pendingCommissions.filter((commission) => {
      const salesperson = salespersonMap.get(commission.salesperson_id);
      return salesperson?.stripe_payouts_enabled;
    });

    const pendingSetupCommissions = pendingCommissions.filter((commission) => {
      const salesperson = salespersonMap.get(commission.salesperson_id);
      return !salesperson?.stripe_payouts_enabled;
    });

    const readyBySalesperson = Array.from(
      readyCommissions.reduce((map, commission) => {
        const salesperson = salespersonMap.get(commission.salesperson_id);
        if (!salesperson) return map;

        const currency = (commission.currency || 'USD').toUpperCase();
        const key = `${commission.salesperson_id}:${currency}`;
        const current =
          map.get(key) ??
          {
            salespersonId: commission.salesperson_id,
            fullName: salesperson.full_name,
            email: salesperson.email,
            referralCode: salesperson.referral_code,
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
        salespersonId: string;
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
      const salesperson = salespersonMap.get(commission.salesperson_id);
      return {
        id: commission.id,
        salespersonId: commission.salesperson_id,
        salespersonName: salesperson?.full_name ?? 'Unknown salesperson',
        salespersonEmail: salesperson?.email ?? null,
        referralCode: salesperson?.referral_code ?? null,
        referredWorkspaceId: commission.referred_workspace_id,
        referredUserId: commission.referred_user_id,
        stripeInvoiceId: commission.stripe_invoice_id,
        revenueAmountCents: commission.revenue_amount_cents,
        commissionAmountCents: commission.commission_amount_cents,
        commissionRateBps: commission.commission_rate_bps,
        currency: (commission.currency || 'USD').toUpperCase(),
        earnedAt: commission.earned_at,
        status: commission.status,
        payoutsEnabled: salesperson?.stripe_payouts_enabled ?? false,
      };
    });

    const payoutHistory = payoutBatches.map((batch) => {
      const salesperson = batch.salesperson_id ? salespersonMap.get(batch.salesperson_id) : null;
      return {
        id: batch.id,
        salespersonId: batch.salesperson_id,
        salespersonName: salesperson?.full_name ?? 'Unknown salesperson',
        salespersonEmail: salesperson?.email ?? null,
        referralCode: salesperson?.referral_code ?? null,
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
      setupRequired: ledgerSetupRequired,
      kpis: {
        total: totalCountRes.count ?? salespeople.length,
        active: activeCountRes.count ?? 0,
        stripeLinked: stripeLinkedCountRes.count ?? 0,
        payoutsReady: payoutsReadyCountRes.count ?? 0,
      },
      salespeople,
      payoutQueue: {
        readyTotals: totalsByCurrency(readyCommissions),
        pendingSetupTotals: totalsByCurrency(pendingSetupCommissions),
        readyCommissionCount: readyCommissions.length,
        pendingSetupCommissionCount: pendingSetupCommissions.length,
        readyBySalesperson,
        recentCommissions: serializedRecentCommissions,
        payoutHistory,
      },
    });
  } catch (error) {
    console.error('[api/admin/salespeople] GET error:', error);
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
    const parsed = salespersonSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid salesperson payload.' },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const now = new Date().toISOString();
    const { data, error } = await auth.admin
      .from('salespeople')
      .insert({
        full_name: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: normalizeOptional(payload.phone),
        role: normalizeOptional(payload.role),
        territory: normalizeOptional(payload.territory),
        founder_user_id: auth.user.id,
        invite_token: randomUUID(),
        invited_at: now,
        commission_rate_bps: payload.commissionRateBps ?? 2500,
        status: payload.status,
        notes: normalizeOptional(payload.notes),
        approved_at: payload.status === 'active' ? now : null,
        paused_at: payload.status === 'paused' ? now : null,
        inactive_at: payload.status === 'inactive' ? now : null,
      })
      .select(SELECT_FIELDS)
      .single();

    if (error) {
      if (isMissingSalespeopleSchemaError(error.message)) {
        return NextResponse.json(
          {
            error:
              'Salespeople storage is not ready yet. Run the latest salespeople migration first.',
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const referralCode = await ensureSalespersonReferralCode(auth.admin, {
      salespersonId: data.id,
      fullName: data.full_name,
      existingReferralCode: data.referral_code,
      preferredReferralCode: payload.referralCode,
    });

    return NextResponse.json({
      ok: true,
      salesperson: {
        ...serializeSalesperson({
          ...(data as SalespersonRow),
          referral_code: referralCode,
        }, request.nextUrl.origin),
        referralCode,
      },
    });
  } catch (error) {
    console.error('[api/admin/salespeople] POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
