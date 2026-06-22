import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { isMissingSalespeopleSchemaError } from '@/app/lib/billing/salespeople';

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly';

type SalespersonRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  referral_code: string | null;
  workspace_id: string | null;
};

type CallRow = {
  id?: string;
  answered_at: string | null;
  duration_seconds: number | null;
  status: string | null;
  disposition: string | null;
  created_at?: string | null;
};

type ContactRow = {
  id: string;
};

type DemoLinkRow = {
  id: string;
  created_at: string;
  recipient_email: string | null;
};

type ReferralRow = {
  id: string;
  created_at: string;
  first_paid_at: string | null;
  status: string | null;
  stripe_subscription_status: string | null;
};

type CommissionRow = {
  commission_amount_cents: number | null;
  revenue_amount_cents: number | null;
  currency: string | null;
  status: string | null;
};

type DemoVideoEventRow = {
  event_type: string;
  session_id: string;
  watch_seconds: number | null;
  max_watch_seconds: number | null;
  video_duration_seconds: number | null;
};

type CountQuery = PromiseLike<{
  count: number | null;
  error: { message?: string } | null;
}>;

const PERIOD_DAYS: Record<PeriodKey, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

function parsePeriod(value: string | null): PeriodKey {
  return value === 'weekly' || value === 'monthly' || value === 'yearly' ? value : 'daily';
}

function buildRange(period: PeriodKey) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - PERIOD_DAYS[period]);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function isWithinRange(value: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return timestamp >= new Date(startIso).getTime() && timestamp < new Date(endIso).getTime();
}

function isAnsweredCall(call: CallRow): boolean {
  const status = call.status?.toLowerCase() ?? '';
  const disposition = call.disposition?.toLowerCase() ?? '';
  return Boolean(
    call.answered_at ||
      (call.duration_seconds ?? 0) > 0 ||
      ['completed', 'in-progress'].includes(status) ||
      ['connected', 'appointment_set', 'callback_requested', 'follow_up', 'not_interested'].includes(disposition)
  );
}

function isPayingReferral(referral: ReferralRow, startIso: string, endIso: string): boolean {
  const subscriptionStatus = referral.stripe_subscription_status?.toLowerCase() ?? '';
  const status = referral.status?.toLowerCase() ?? '';
  return (
    isWithinRange(referral.first_paid_at, startIso, endIso) ||
    (isWithinRange(referral.created_at, startIso, endIso) &&
      (status === 'active' || subscriptionStatus === 'active' || subscriptionStatus === 'trialing'))
  );
}

async function safeExactCount(query: CountQuery): Promise<number> {
  const { count, error } = await query;
  if (error) {
    if (isMissingSalespeopleSchemaError(error.message)) return 0;
    throw new Error(error.message ?? 'Failed to load count');
  }
  return count ?? 0;
}

async function resolveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string | null
): Promise<SalespersonRow | null> {
  const select = 'id, user_id, full_name, email, referral_code, workspace_id';
  const normalizedEmail = email?.trim().toLowerCase();

  const byUserId = admin
    .from('salespeople')
    .select(select)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: userSalesperson, error: userSalespersonError } = await byUserId.maybeSingle();
  if (userSalespersonError) {
    const message = userSalespersonError.message?.toLowerCase() ?? '';
    if (!message.includes('user_id') || !message.includes('salespeople')) {
      if (isMissingSalespeopleSchemaError(userSalespersonError.message)) return null;
      throw new Error(userSalespersonError.message);
    }
  }
  if (userSalesperson) return userSalesperson as SalespersonRow;

  if (normalizedEmail) {
    const { data, error } = await admin
      .from('salespeople')
      .select(select)
      .ilike('email', normalizedEmail)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingSalespeopleSchemaError(error.message)) return null;
      throw new Error(error.message);
    }
    if (data) return data as SalespersonRow;
  }

  return null;
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function countInboundMessages(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    workspaceId: string;
    salespersonId: string;
    startIso: string;
    endIso: string;
  }
): Promise<number> {
  const attributed = await admin
    .from('dialer_inbound_messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', params.workspaceId)
    .eq('salesperson_id', params.salespersonId)
    .gte('received_at', params.startIso)
    .lt('received_at', params.endIso);

  if (!attributed.error) return attributed.count ?? 0;

  const message = attributed.error.message?.toLowerCase() ?? '';
  if (!message.includes('salesperson_id') && !message.includes('schema cache')) {
    throw new Error(attributed.error.message ?? 'Failed to load inbound messages');
  }

  return 0;
}

function totalCommissionsByCurrency(commissions: CommissionRow[]) {
  const totals = new Map<
    string,
    { currency: string; earnedCents: number; paidCents: number; pendingCents: number }
  >();

  for (const commission of commissions) {
    if (commission.status === 'voided') continue;
    const currency = (commission.currency || 'USD').toUpperCase();
    const amount = Number(commission.commission_amount_cents ?? 0);
    const current = totals.get(currency) ?? {
      currency,
      earnedCents: 0,
      paidCents: 0,
      pendingCents: 0,
    };
    current.earnedCents += amount;
    if (commission.status === 'paid') current.paidCents += amount;
    if (commission.status === 'pending') current.pendingCents += amount;
    totals.set(currency, current);
  }

  return Array.from(totals.values()).sort((a, b) => b.earnedCents - a.earnedCents);
}

function totalRevenueByCurrency(commissions: CommissionRow[]) {
  const totals = new Map<string, { currency: string; revenueCents: number }>();

  for (const commission of commissions) {
    if (commission.status === 'voided') continue;
    const currency = (commission.currency || 'USD').toUpperCase();
    const current = totals.get(currency) ?? { currency, revenueCents: 0 };
    current.revenueCents += Number(commission.revenue_amount_cents ?? 0);
    totals.set(currency, current);
  }

  return Array.from(totals.values()).sort((a, b) => b.revenueCents - a.revenueCents);
}

function summarizeDemoVideoEvents(events: DemoVideoEventRow[]) {
  const count = (eventType: string) =>
    events.filter((event) => event.event_type === eventType).length;
  const maxWatchBySession = new Map<string, number>();
  let maxWatchSeconds = 0;

  for (const event of events) {
    const sessionId = event.session_id || event.event_type;
    const eventMax = Math.max(
      Number(event.max_watch_seconds ?? 0),
      Number(event.watch_seconds ?? 0)
    );
    maxWatchSeconds = Math.max(maxWatchSeconds, eventMax);
    maxWatchBySession.set(
      sessionId,
      Math.max(maxWatchBySession.get(sessionId) ?? 0, eventMax)
    );
  }

  const sessions = maxWatchBySession.size;
  const totalSessionWatchSeconds = Array.from(maxWatchBySession.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    sessions,
    pageViews: count('page_view'),
    videoStarts: count('video_started'),
    playWithSound: count('play_with_sound'),
    progress25: count('progress_25'),
    progress50: count('progress_50'),
    progress75: count('progress_75'),
    completions: count('video_complete'),
    ctaShown: count('cta_shown'),
    startTrialClicks: count('start_trial_click'),
    founderCallClicks: count('founder_call_click'),
    exits: count('page_exit'),
    averageWatchSeconds: sessions ? Math.round(totalSessionWatchSeconds / sessions) : 0,
    maxWatchSeconds: Math.round(maxWatchSeconds),
  };
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const period = parsePeriod(request.nextUrl.searchParams.get('period'));
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const { startIso, endIso } = buildRange(period);
  const admin = createAdminClient();

  try {
    const salesperson = await resolveSalesperson(admin, requestUser.id, requestUser.email);
    if (!salesperson) {
      return NextResponse.json({ error: 'Salesperson workspace not found' }, { status: 403 });
    }

    const effectiveWorkspaceId = workspaceId || salesperson.workspace_id;
    if (!effectiveWorkspaceId) {
      return NextResponse.json({ error: 'Salesperson workspace is not linked yet' }, { status: 409 });
    }

    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', effectiveWorkspaceId)
      .eq('user_id', requestUser.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) throw new Error(membershipError.message);
    if (!membership) {
      return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });
    }

    const referralCode = salesperson.referral_code?.trim().toUpperCase() ?? '';
    const outreachUserIds = compactStrings([salesperson.user_id, requestUser.id]);

    const [
      callsCount,
      callsRowsResponse,
      outboundMessages,
      inboundMessages,
      contactRowsResponse,
      demoLinksResponse,
      linkOpens,
      signups,
      referralsResponse,
      commissionsResponse,
      demoVideoEventsResponse,
    ] = await Promise.all([
      safeExactCount(
        admin
          .from('dialer_calls')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', effectiveWorkspaceId)
          .in('user_id', outreachUserIds)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
      ),
      admin
        .from('dialer_calls')
        .select('answered_at, duration_seconds, status, disposition')
        .eq('workspace_id', effectiveWorkspaceId)
        .in('user_id', outreachUserIds)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .range(0, 9999),
      safeExactCount(
        admin
          .from('dialer_sms_followups')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', effectiveWorkspaceId)
          .in('user_id', outreachUserIds)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
      ),
      countInboundMessages(admin, {
        workspaceId: effectiveWorkspaceId,
        salespersonId: salesperson.id,
        startIso,
        endIso,
      }),
      admin
        .from('contacts')
        .select('id')
        .eq('workspace_id', effectiveWorkspaceId)
        .in('user_id', outreachUserIds)
        .range(0, 9999),
      admin
        .from('salesperson_demo_links')
        .select('id, created_at, recipient_email')
        .eq('salesperson_id', salesperson.id)
        .eq('workspace_id', effectiveWorkspaceId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .range(0, 9999),
      safeExactCount(
        admin
          .from('salesperson_click_events')
          .select('id', { count: 'exact', head: true })
          .eq('salesperson_id', salesperson.id)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
      ),
      referralCode
        ? safeExactCount(
            admin
              .from('workspaces')
              .select('id', { count: 'exact', head: true })
              .ilike('referral_code_used', referralCode)
              .gte('created_at', startIso)
              .lt('created_at', endIso)
          )
        : Promise.resolve(0),
      admin
        .from('salesperson_referrals')
        .select('id, created_at, first_paid_at, status, stripe_subscription_status')
        .eq('salesperson_id', salesperson.id)
        .range(0, 9999),
      admin
        .from('salesperson_commissions')
        .select('commission_amount_cents, revenue_amount_cents, currency, status')
        .eq('salesperson_id', salesperson.id)
        .gte('earned_at', startIso)
        .lt('earned_at', endIso)
        .range(0, 9999),
      admin
        .from('salesperson_demo_video_events')
        .select('event_type, session_id, watch_seconds, max_watch_seconds, video_duration_seconds')
        .eq('salesperson_id', salesperson.id)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .range(0, 9999),
    ]);

    if (callsRowsResponse.error) throw new Error(callsRowsResponse.error.message);
    if (contactRowsResponse.error) throw new Error(contactRowsResponse.error.message);
    if (demoLinksResponse.error) {
      const message = demoLinksResponse.error.message?.toLowerCase() ?? '';
      if (
        !message.includes('salesperson_demo_links') &&
        !message.includes('does not exist') &&
        !message.includes('schema cache')
      ) {
        throw new Error(demoLinksResponse.error.message);
      }
    }
    if (referralsResponse.error) {
      if (!isMissingSalespeopleSchemaError(referralsResponse.error.message)) {
        throw new Error(referralsResponse.error.message);
      }
    }
    if (commissionsResponse.error) {
      if (!isMissingSalespeopleSchemaError(commissionsResponse.error.message)) {
        throw new Error(commissionsResponse.error.message);
      }
    }
    if (demoVideoEventsResponse.error) {
      const message = demoVideoEventsResponse.error.message?.toLowerCase() ?? '';
      if (
        !message.includes('salesperson_demo_video_events') &&
        !message.includes('does not exist') &&
        !message.includes('schema cache')
      ) {
        throw new Error(demoVideoEventsResponse.error.message);
      }
    }

    const contactIds = ((contactRowsResponse.data ?? []) as ContactRow[]).map((row) => row.id);
    const emails = contactIds.length
      ? await safeExactCount(
          admin
            .from('contact_activities')
            .select('id', { count: 'exact', head: true })
            .eq('type', 'email')
            .in('contact_id', contactIds)
            .gte('timestamp', startIso)
            .lt('timestamp', endIso)
        )
      : 0;

    const calls = ((callsRowsResponse.data ?? []) as CallRow[]);
    const answeredCalls = calls.filter(isAnsweredCall).length;
    const demoEmailLinks = ((demoLinksResponse.data ?? []) as DemoLinkRow[])
      .filter((link) => Boolean(link.recipient_email?.trim())).length;
    const referrals = ((referralsResponse.data ?? []) as ReferralRow[]);
    const commissions = ((commissionsResponse.data ?? []) as CommissionRow[]);
    const demoVideoEvents = ((demoVideoEventsResponse.data ?? []) as DemoVideoEventRow[]);
    const trackedLink = referralCode
      ? `${request.nextUrl.origin}/s/${encodeURIComponent(referralCode)}?source=salesperson`
      : null;

    return NextResponse.json({
      period,
      range: { start: startIso, end: endIso },
      salesperson: {
        id: salesperson.id,
        fullName: salesperson.full_name,
        email: salesperson.email,
        referralCode,
        workspaceId: effectiveWorkspaceId,
        trackedLink,
      },
      outreach: {
        calls: Math.max(callsCount, calls.length),
        answers: answeredCalls,
        messages: outboundMessages + inboundMessages,
        outboundMessages,
        inboundMessages,
        emails: Math.max(emails, demoEmailLinks),
        demosSent: demoEmailLinks,
      },
      links: {
        opens: linkOpens,
        signups,
      },
      revenue: {
        payingUsers: referrals.filter((referral) => isPayingReferral(referral, startIso, endIso)).length,
        commissionTotals: totalCommissionsByCurrency(commissions),
        revenueTotals: totalRevenueByCurrency(commissions),
      },
      demoVideo: summarizeDemoVideoEvents(demoVideoEvents),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load salesperson performance';
    console.error('[salesperson performance] failed', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
