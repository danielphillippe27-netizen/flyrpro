import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireFounderApi, type FounderApiAuth } from '@/app/api/admin/_utils/founder';
import { ensureSalespersonReferralCode } from '@/app/lib/billing/salespeople';
import {
  getInviteAppOrigin,
  sendSalespersonInviteEmail,
} from '@/lib/email/resend';
import type { SalespersonCommission, SalespersonPayoutBatch } from '@/types/database';

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
  user_id?: string | null;
  workspace_id?: string | null;
  invite_token?: string | null;
  invited_at?: string | null;
  onboarding_completed_at?: string | null;
  approved_at: string | null;
  paused_at: string | null;
  inactive_at: string | null;
};

type SalespersonCommissionRow = Pick<
  SalespersonCommission,
  | 'id'
  | 'salesperson_id'
  | 'referred_workspace_id'
  | 'referred_user_id'
  | 'stripe_invoice_id'
  | 'revenue_amount_cents'
  | 'commission_amount_cents'
  | 'commission_rate_bps'
  | 'currency'
  | 'earned_at'
  | 'status'
>;

type SalespersonPayoutBatchRow = Pick<
  SalespersonPayoutBatch,
  | 'id'
  | 'salesperson_id'
  | 'currency'
  | 'total_commission_cents'
  | 'status'
  | 'paid_at'
  | 'created_at'
  | 'stripe_transfer_id'
  | 'failure_reason'
>;

type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | null;
};

type SessionPresenceRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  active_seconds: number | null;
};

type SalespersonDialerSettingsRow = {
  salesperson_id: string;
  assigned_phone_number: string | null;
  default_sms_from_number: string | null;
  inbound_forward_to: string | null;
  twilio_incoming_phone_number_sid: string | null;
  number_status: 'unassigned' | 'active' | 'released';
  number_assigned_at: string | null;
};

type QueryRowsResponse<T> = {
  data: T[] | null;
  error: PostgrestError | null;
  count?: number | null;
};

type SalespersonPresence = {
  userId: string | null;
  isLive: boolean;
  lastActiveAt: string | null;
  currentSessionStartedAt: string | null;
  currentSessionDurationSeconds: number;
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
  user_id,
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
  user_id,
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
  workspaceId: z.string().uuid().optional(),
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

function liveDurationSeconds(session: Pick<SessionPresenceRow, 'start_time' | 'active_seconds'>): number {
  const activeSeconds = Number(session.active_seconds ?? 0);
  if (activeSeconds > 0) return activeSeconds;

  const startedMs = session.start_time ? new Date(session.start_time).getTime() : NaN;
  if (Number.isNaN(startedMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
}

async function loadSalespersonPresence(
  admin: Extract<FounderApiAuth, { ok: true }>['admin'],
  salespeopleRows: SalespersonRow[]
): Promise<Map<string, SalespersonPresence>> {
  const presenceBySalespersonId = new Map<string, SalespersonPresence>();
  const workspaceIds = Array.from(
    new Set(
      salespeopleRows
        .map((row) => row.workspace_id)
        .filter((workspaceId): workspaceId is string => typeof workspaceId === 'string' && workspaceId.length > 0)
    )
  );

  if (workspaceIds.length === 0) return presenceBySalespersonId;

  const { data: membershipRows, error: membershipError } = await admin
    .from('workspace_members')
    .select('workspace_id, user_id, role')
    .in('workspace_id', workspaceIds);

  if (membershipError) {
    console.warn('[api/admin/salespeople] presence membership lookup failed:', membershipError.message);
    return presenceBySalespersonId;
  }

  const membersByWorkspaceId = new Map<string, WorkspaceMemberRow[]>();
  for (const member of (membershipRows ?? []) as WorkspaceMemberRow[]) {
    const rows = membersByWorkspaceId.get(member.workspace_id) ?? [];
    rows.push(member);
    membersByWorkspaceId.set(member.workspace_id, rows);
  }

  const salespersonUserBySalespersonId = new Map<string, string>();
  for (const salesperson of salespeopleRows) {
    if (salesperson.user_id) {
      salespersonUserBySalespersonId.set(salesperson.id, salesperson.user_id);
      continue;
    }
    if (!salesperson.workspace_id) continue;
    const workspaceMembers = membersByWorkspaceId.get(salesperson.workspace_id) ?? [];
    const member =
      workspaceMembers.find((row) => row.user_id !== salesperson.founder_user_id && row.role !== 'owner') ??
      workspaceMembers.find((row) => row.user_id !== salesperson.founder_user_id);
    if (!member?.user_id) continue;
    salespersonUserBySalespersonId.set(salesperson.id, member.user_id);
  }

  const userIds = Array.from(new Set(salespersonUserBySalespersonId.values()));
  if (userIds.length === 0) return presenceBySalespersonId;

  const liveWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [liveSessionsRes, recentSessionsRes] = await Promise.all([
    admin
      .from('sessions')
      .select('id, workspace_id, user_id, start_time, end_time, active_seconds')
      .in('workspace_id', workspaceIds)
      .in('user_id', userIds)
      .is('end_time', null)
      .gte('start_time', liveWindowStart)
      .order('start_time', { ascending: false }),
    admin
      .from('sessions')
      .select('id, workspace_id, user_id, start_time, end_time, active_seconds')
      .in('workspace_id', workspaceIds)
      .in('user_id', userIds)
      .order('start_time', { ascending: false })
      .limit(1000),
  ]);

  if (liveSessionsRes.error) {
    console.warn('[api/admin/salespeople] live session lookup failed:', liveSessionsRes.error.message);
  }
  if (recentSessionsRes.error) {
    console.warn('[api/admin/salespeople] recent session lookup failed:', recentSessionsRes.error.message);
  }

  const liveByWorkspaceUser = new Map<string, SessionPresenceRow>();
  for (const session of ((liveSessionsRes.data ?? []) as SessionPresenceRow[])) {
    if (!session.workspace_id || !session.user_id) continue;
    const key = `${session.workspace_id}:${session.user_id}`;
    if (!liveByWorkspaceUser.has(key)) {
      liveByWorkspaceUser.set(key, session);
    }
  }

  const recentByWorkspaceUser = new Map<string, SessionPresenceRow>();
  for (const session of ((recentSessionsRes.data ?? []) as SessionPresenceRow[])) {
    if (!session.workspace_id || !session.user_id) continue;
    const key = `${session.workspace_id}:${session.user_id}`;
    if (!recentByWorkspaceUser.has(key)) {
      recentByWorkspaceUser.set(key, session);
    }
  }

  for (const salesperson of salespeopleRows) {
    const userId = salespersonUserBySalespersonId.get(salesperson.id) ?? null;
    const key = salesperson.workspace_id && userId ? `${salesperson.workspace_id}:${userId}` : null;
    const live = key ? liveByWorkspaceUser.get(key) : null;
    const recent = key ? recentByWorkspaceUser.get(key) : null;

    presenceBySalespersonId.set(salesperson.id, {
      userId,
      isLive: Boolean(live),
      lastActiveAt: live?.start_time ?? recent?.end_time ?? recent?.start_time ?? null,
      currentSessionStartedAt: live?.start_time ?? null,
      currentSessionDurationSeconds: live ? liveDurationSeconds(live) : 0,
    });
  }

  return presenceBySalespersonId;
}

function serializeSalesperson(
  row: SalespersonRow,
  origin: string,
  presence?: SalespersonPresence,
  dialerSettings?: SalespersonDialerSettingsRow | null
) {
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
    userId: row.user_id ?? presence?.userId ?? null,
    workspaceId: row.workspace_id ?? null,
    inviteToken: row.invite_token ?? null,
    inviteUrl: buildSalespersonInviteUrl(origin, row.invite_token),
    invitedAt: row.invited_at ?? null,
    onboardingCompletedAt: row.onboarding_completed_at ?? null,
    approvedAt: row.approved_at,
    pausedAt: row.paused_at,
    inactiveAt: row.inactive_at,
    isLive: presence?.isLive ?? false,
    lastActiveAt: presence?.lastActiveAt ?? null,
    currentSessionStartedAt: presence?.currentSessionStartedAt ?? null,
    currentSessionDurationSeconds: presence?.currentSessionDurationSeconds ?? 0,
    dialerNumber: {
      phoneNumber: dialerSettings?.assigned_phone_number ?? null,
      smsFromNumber: dialerSettings?.default_sms_from_number ?? null,
      inboundForwardTo: dialerSettings?.inbound_forward_to ?? null,
      twilioIncomingPhoneNumberSid: dialerSettings?.twilio_incoming_phone_number_sid ?? null,
      numberStatus: dialerSettings?.number_status ?? 'unassigned',
      numberAssignedAt: dialerSettings?.number_assigned_at ?? null,
    },
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
    const possibleErrors = [...coreErrors, ...ledgerErrors];

    const firstError = possibleErrors[0];
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }

    const salespeopleRows = (salespeopleRes as QueryRowsResponse<SalespersonRow>).data ?? [];
    const origin = request.nextUrl.origin;
    const publicOrigin = getInviteAppOrigin(origin);
    const salespersonIds = salespeopleRows.map((row) => row.id);
    const [presenceBySalespersonId, dialerSettingsRes] = await Promise.all([
      loadSalespersonPresence(auth.admin, salespeopleRows),
      salespersonIds.length
        ? auth.admin
            .from('salesperson_dialer_settings')
            .select(
              'salesperson_id, assigned_phone_number, default_sms_from_number, inbound_forward_to, twilio_incoming_phone_number_sid, number_status, number_assigned_at'
            )
            .in('salesperson_id', salespersonIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (dialerSettingsRes.error) {
      console.warn('[api/admin/salespeople] dialer settings lookup failed:', dialerSettingsRes.error.message);
    }
    const dialerSettingsBySalespersonId = new Map(
      ((dialerSettingsRes.data ?? []) as SalespersonDialerSettingsRow[]).map((row) => [
        row.salesperson_id,
        row,
      ])
    );
    const salespeople = salespeopleRows.map((row) =>
      serializeSalesperson(
        row,
        publicOrigin,
        presenceBySalespersonId.get(row.id),
        dialerSettingsBySalespersonId.get(row.id)
      )
    );
    const pendingCommissions = (pendingCommissionsRes.data ?? []) as SalespersonCommissionRow[];
    const recentCommissions = (recentCommissionsRes.data ?? []) as SalespersonCommissionRow[];
    const payoutBatches = (payoutBatchesRes.data ?? []) as SalespersonPayoutBatchRow[];
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
      setupRequired: false,
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
    const normalizedEmail = payload.email.trim().toLowerCase();
    const { data: existingSalesperson, error: existingSalespersonError } = await auth.admin
      .from('salespeople')
      .select(SELECT_FIELDS)
      .ilike('email', normalizedEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSalespersonError) {
      return NextResponse.json({ error: existingSalespersonError.message }, { status: 500 });
    }

    const basePayload: Record<string, unknown> = {
      full_name: payload.fullName.trim(),
      email: normalizedEmail,
      phone: normalizeOptional(payload.phone),
      role: normalizeOptional(payload.role),
      territory: normalizeOptional(payload.territory),
      founder_user_id: auth.user.id,
      invite_token: existingSalesperson?.invite_token ?? randomUUID(),
      invited_at: now,
      commission_rate_bps: payload.commissionRateBps ?? 2500,
      status: payload.status,
      notes: normalizeOptional(payload.notes),
      approved_at: payload.status === 'active' ? now : null,
      paused_at: payload.status === 'paused' ? now : null,
      inactive_at: payload.status === 'inactive' ? now : null,
    };
    if (payload.workspaceId) {
      basePayload.workspace_id = payload.workspaceId;
    }

    const { data, error } = existingSalesperson?.id
      ? await auth.admin
          .from('salespeople')
          .update(basePayload)
          .eq('id', existingSalesperson.id)
          .select(SELECT_FIELDS)
          .single()
      : await auth.admin
          .from('salespeople')
          .insert(basePayload)
          .select(SELECT_FIELDS)
          .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const referralCode = await ensureSalespersonReferralCode(auth.admin, {
      salespersonId: data.id,
      fullName: data.full_name,
      existingReferralCode: data.referral_code,
      preferredReferralCode: payload.referralCode,
    });

    if (payload.workspaceId) {
      await auth.admin
        .from('salesperson_dialer_settings')
        .upsert(
          {
            salesperson_id: data.id,
            workspace_id: payload.workspaceId,
            updated_at: now,
          },
          { onConflict: 'salesperson_id' }
        );
    }

    const publicOrigin = getInviteAppOrigin(request.nextUrl.origin);
    const inviteUrl = buildSalespersonInviteUrl(publicOrigin, data.invite_token);
    let salespersonInviteEmailSent = false;
    let salespersonInviteEmailError: string | null = null;

    if (inviteUrl) {
      try {
        await sendSalespersonInviteEmail({
          to: data.email,
          fullName: data.full_name,
          onboardingUrl: inviteUrl,
          referralCode,
          commissionRateBps: data.commission_rate_bps ?? 2500,
        });
        salespersonInviteEmailSent = true;
      } catch (emailError) {
        salespersonInviteEmailError =
          emailError instanceof Error
            ? emailError.message
            : 'Salesperson invite email failed to send.';
      }
    }

    return NextResponse.json({
      ok: true,
      salesperson: {
        ...serializeSalesperson({
          ...(data as SalespersonRow),
          referral_code: referralCode,
        }, publicOrigin),
        referralCode,
      },
      salespersonInviteEmailSent,
      salespersonInviteEmailError,
    });
  } catch (error) {
    console.error('[api/admin/salespeople] POST error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
