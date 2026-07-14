import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveTeamDashboardMode } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { getTeamReportMailerConfigError, sendTeamLeadReportEmail } from '@/lib/email/teamReports';

type ReportPeriod = 'weekly' | 'monthly' | 'yearly';

type WorkspaceMemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | null;
  color: string | null;
  created_at?: string | null;
};

type WorkspaceRow = {
  name: string | null;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type ReportMetricKey =
  | 'doors_knocked'
  | 'flyers_delivered'
  | 'conversations'
  | 'leads_created'
  | 'appointments_set'
  | 'time_spent_seconds'
  | 'sessions_count';

type ReportMetrics = Record<ReportMetricKey, number>;

type ReportDelta = {
  abs: number;
  pct: number | null;
  trend: 'up' | 'down' | 'flat';
};

type ReportDeltas = Record<ReportMetricKey, ReportDelta>;

type ReportRow = {
  id: string;
  workspace_id: string;
  scope: 'team' | 'member' | string;
  owner_user_id: string | null;
  subject_user_id: string | null;
  period: ReportPeriod | string;
  period_start: string;
  period_end: string;
  metrics: Partial<Record<ReportMetricKey, number | string | null>> | null;
  deltas: Partial<Record<ReportMetricKey, Partial<ReportDelta> | null>> | null;
  created_at: string;
};

type SessionMetricRow = {
  user_id: string | null;
  start_time: string | null;
  doors_hit: number | null;
  completed_count?: number | null;
  conversations: number | null;
  leads_created: number | null;
  flyers_delivered: number | null;
  active_seconds: number | null;
};

type ContactMetricRow = {
  user_id: string | null;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  campaign_id?: string | null;
  status?: string | null;
  appointment_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AvailablePeriod = {
  period_start: string;
  period_end: string;
  created_at: string;
  report_count: number;
};

type NotificationRow = {
  user_id: string;
  data: {
    report_id?: string;
    period?: string;
    scope?: string;
    period_start?: string;
  } | null;
};

type EmailReportPayload = {
  period: ReportPeriod;
  period_start: string;
  period_end: string;
  generated_at: string | null;
  totals: ReportMetrics;
  deltas: ReportDeltas;
  rates: {
    conversations_per_door: number;
    leads_per_conversation: number;
    appointments_per_conversation: number;
  };
  members: Array<{
    display_name: string;
    role: string;
    has_report: boolean;
    metrics: ReportMetrics;
    rates: {
      conversations_per_door: number;
      leads_per_conversation: number;
      appointments_per_conversation: number;
    };
  }>;
};

const PERIODS: ReportPeriod[] = ['weekly', 'monthly', 'yearly'];
const METRIC_KEYS: ReportMetricKey[] = [
  'doors_knocked',
  'flyers_delivered',
  'conversations',
  'leads_created',
  'appointments_set',
  'time_spent_seconds',
  'sessions_count',
];

const ZERO_METRICS: ReportMetrics = {
  doors_knocked: 0,
  flyers_delivered: 0,
  conversations: 0,
  leads_created: 0,
  appointments_set: 0,
  time_spent_seconds: 0,
  sessions_count: 0,
};

function parsePeriod(value: string | null): ReportPeriod | null {
  if (!value) return 'weekly';
  return PERIODS.includes(value as ReportPeriod) ? (value as ReportPeriod) : null;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

function normalizeMetrics(metrics?: ReportRow['metrics']): ReportMetrics {
  return METRIC_KEYS.reduce<ReportMetrics>(
    (acc, key) => ({
      ...acc,
      [key]: Math.max(0, numberValue(metrics?.[key])),
    }),
    { ...ZERO_METRICS }
  );
}

function normalizeDeltas(deltas?: ReportRow['deltas']): ReportDeltas {
  return METRIC_KEYS.reduce<ReportDeltas>((acc, key) => {
    const raw = deltas?.[key];
    const abs = numberValue(raw?.abs);
    const pctRaw = raw?.pct;
    const pct = pctRaw == null ? null : numberValue(pctRaw);
    const trend = raw?.trend === 'up' || raw?.trend === 'down' || raw?.trend === 'flat'
      ? raw.trend
      : abs > 0
        ? 'up'
        : abs < 0
          ? 'down'
          : 'flat';

    return {
      ...acc,
      [key]: { abs, pct, trend },
    };
  }, {} as ReportDeltas);
}

function addMetrics(left: ReportMetrics, right: ReportMetrics): ReportMetrics {
  return METRIC_KEYS.reduce<ReportMetrics>(
    (acc, key) => ({
      ...acc,
      [key]: left[key] + right[key],
    }),
    { ...ZERO_METRICS }
  );
}

function calculateDeltas(current: ReportMetrics, previous: ReportMetrics): ReportDeltas {
  return METRIC_KEYS.reduce<ReportDeltas>((acc, key) => {
    const abs = current[key] - previous[key];
    acc[key] = {
      abs,
      pct: previous[key] === 0 ? null : Number(((abs / previous[key]) * 100).toFixed(2)),
      trend: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
    };
    return acc;
  }, {} as ReportDeltas);
}

function samePeriodStart(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

function addPeriod(start: Date, period: ReportPeriod, amount: number): Date {
  const next = new Date(start);
  if (period === 'weekly') {
    next.setUTCDate(next.getUTCDate() + (7 * amount));
  } else if (period === 'monthly') {
    next.setUTCMonth(next.getUTCMonth() + amount);
  } else {
    next.setUTCFullYear(next.getUTCFullYear() + amount);
  }
  return next;
}

function latestCompletedPeriod(period: ReportPeriod): AvailablePeriod {
  const now = new Date();
  const currentStart = new Date(now);

  if (period === 'weekly') {
    const day = currentStart.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    currentStart.setUTCDate(currentStart.getUTCDate() + diff);
    currentStart.setUTCHours(0, 0, 0, 0);
  } else if (period === 'monthly') {
    currentStart.setUTCDate(1);
    currentStart.setUTCHours(0, 0, 0, 0);
  } else {
    currentStart.setUTCMonth(0, 1);
    currentStart.setUTCHours(0, 0, 0, 0);
  }

  const periodStart = addPeriod(currentStart, period, -1);
  return {
    period_start: periodStart.toISOString(),
    period_end: currentStart.toISOString(),
    created_at: now.toISOString(),
    report_count: 0,
  };
}

function periodFromStart(period: ReportPeriod, periodStart: string): AvailablePeriod | null {
  const start = new Date(periodStart);
  if (!Number.isFinite(start.getTime())) return null;
  const end = addPeriod(start, period, 1);
  return {
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    created_at: new Date().toISOString(),
    report_count: 0,
  };
}

function contactSignature(row: ContactMetricRow): string {
  return [
    (row.full_name ?? '').trim().toLowerCase(),
    (row.phone ?? '').trim(),
    (row.email ?? '').trim().toLowerCase(),
    (row.address ?? '').trim().toLowerCase(),
    (row.campaign_id ?? '').trim(),
  ].join('|');
}

function isAppointmentStatus(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'interested' || normalized === 'hot' || normalized === 'appointment';
}

function isInRange(iso: string | null | undefined, startMs: number, endMs: number): boolean {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time >= startMs && time < endMs;
}

function applyContactMetrics(metrics: Map<string, ReportMetrics>, rows: ContactMetricRow[], startIso: string, endIso: string) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const leadSignaturesByUserId = new Map<string, Set<string>>();
  const appointmentSignaturesByUserId = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.user_id) continue;
    const signature = contactSignature(row);
    if (isInRange(row.created_at, startMs, endMs)) {
      const signatures = leadSignaturesByUserId.get(row.user_id) ?? new Set<string>();
      signatures.add(signature);
      leadSignaturesByUserId.set(row.user_id, signatures);
    }

    const changedInRange =
      isInRange(row.updated_at, startMs, endMs) || isInRange(row.created_at, startMs, endMs);
    const appointmentInRange = isInRange(row.appointment_at, startMs, endMs);
    if (appointmentInRange || (changedInRange && isAppointmentStatus(row.status))) {
      const signatures = appointmentSignaturesByUserId.get(row.user_id) ?? new Set<string>();
      signatures.add(signature);
      appointmentSignaturesByUserId.set(row.user_id, signatures);
    }
  }

  for (const [userId, signatures] of leadSignaturesByUserId.entries()) {
    const current = metrics.get(userId) ?? { ...ZERO_METRICS };
    current.leads_created = signatures.size;
    metrics.set(userId, current);
  }

  for (const [userId, signatures] of appointmentSignaturesByUserId.entries()) {
    const current = metrics.get(userId) ?? { ...ZERO_METRICS };
    current.appointments_set = signatures.size;
    metrics.set(userId, current);
  }
}

function summarizeSessionMetrics(rows: SessionMetricRow[], memberIds: string[]): Map<string, ReportMetrics> {
  const metrics = new Map(memberIds.map((memberId) => [memberId, { ...ZERO_METRICS }] as const));

  for (const row of rows) {
    if (!row.user_id || !metrics.has(row.user_id)) continue;
    const current = metrics.get(row.user_id) ?? { ...ZERO_METRICS };
    const doors = Math.max(0, Number(row.doors_hit ?? row.completed_count ?? row.flyers_delivered ?? 0) || 0);
    const flyers = Math.max(0, Number(row.flyers_delivered ?? row.completed_count ?? 0) || 0);

    metrics.set(row.user_id, {
      doors_knocked: current.doors_knocked + doors,
      flyers_delivered: current.flyers_delivered + flyers,
      conversations: current.conversations + (Math.max(0, Number(row.conversations ?? 0) || 0)),
      leads_created: current.leads_created + (Math.max(0, Number(row.leads_created ?? 0) || 0)),
      appointments_set: current.appointments_set,
      time_spent_seconds: current.time_spent_seconds + (Math.max(0, Number(row.active_seconds ?? 0) || 0)),
      sessions_count: current.sessions_count + 1,
    });
  }

  return metrics;
}

function sumMetricMap(metrics: Map<string, ReportMetrics>): ReportMetrics {
  return Array.from(metrics.values()).reduce<ReportMetrics>(
    (acc, item) => addMetrics(acc, item),
    { ...ZERO_METRICS }
  );
}

async function fetchContactRows(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userIds: string[]
) {
  const runQuery = (selectColumns: string) =>
    supabase
      .from('contacts')
      .select(selectColumns)
      .eq('workspace_id', workspaceId)
      .in('user_id', userIds);

  const result = await runQuery(
    'user_id, full_name, phone, email, address, campaign_id, status, appointment_at, created_at, updated_at'
  );

  if (!result.error || !getErrorMessage(result.error).toLowerCase().includes('appointment_at')) {
    return result;
  }

  return runQuery('user_id, full_name, phone, email, address, campaign_id, status, created_at, updated_at');
}

async function loadLiveReportMetrics(params: {
  supabase: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  memberIds: string[];
  periodStart: string;
  periodEnd: string;
  previousStart: string;
  previousEnd: string;
}) {
  const { supabase, workspaceId, memberIds, periodStart, periodEnd, previousStart, previousEnd } = params;
  const [
    currentSessionsRes,
    previousSessionsRes,
    currentCrmAppointmentsRes,
    previousCrmAppointmentsRes,
    contactsRes,
  ] = await Promise.all([
    supabase
      .from('sessions')
      .select('user_id, start_time, doors_hit, completed_count, conversations, leads_created, flyers_delivered, active_seconds')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .gte('start_time', periodStart)
      .lt('start_time', periodEnd),
    supabase
      .from('sessions')
      .select('user_id, start_time, doors_hit, completed_count, conversations, leads_created, flyers_delivered, active_seconds')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds)
      .gte('start_time', previousStart)
      .lt('start_time', previousEnd),
    supabase
      .from('crm_events')
      .select('user_id, created_at')
      .in('user_id', memberIds)
      .not('fub_appointment_id', 'is', null)
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd),
    supabase
      .from('crm_events')
      .select('user_id, created_at')
      .in('user_id', memberIds)
      .not('fub_appointment_id', 'is', null)
      .gte('created_at', previousStart)
      .lt('created_at', previousEnd),
    fetchContactRows(supabase, workspaceId, memberIds),
  ]);

  if (currentSessionsRes.error) throw new Error(currentSessionsRes.error.message);
  if (previousSessionsRes.error) throw new Error(previousSessionsRes.error.message);

  const currentByUserId = summarizeSessionMetrics((currentSessionsRes.data ?? []) as SessionMetricRow[], memberIds);
  const previousByUserId = summarizeSessionMetrics((previousSessionsRes.data ?? []) as SessionMetricRow[], memberIds);
  const contacts = contactsRes.error ? [] : ((contactsRes.data ?? []) as unknown as ContactMetricRow[]);

  if (!contactsRes.error && contacts.length > 0) {
    applyContactMetrics(currentByUserId, contacts, periodStart, periodEnd);
    applyContactMetrics(previousByUserId, contacts, previousStart, previousEnd);
  }

  if (contacts.length === 0) {
    if (!currentCrmAppointmentsRes.error) {
      for (const row of (currentCrmAppointmentsRes.data ?? []) as Array<{ user_id: string | null }>) {
        if (!row.user_id || !currentByUserId.has(row.user_id)) continue;
        const current = currentByUserId.get(row.user_id) ?? { ...ZERO_METRICS };
        current.appointments_set += 1;
        currentByUserId.set(row.user_id, current);
      }
    }
    if (!previousCrmAppointmentsRes.error) {
      for (const row of (previousCrmAppointmentsRes.data ?? []) as Array<{ user_id: string | null }>) {
        if (!row.user_id || !previousByUserId.has(row.user_id)) continue;
        const current = previousByUserId.get(row.user_id) ?? { ...ZERO_METRICS };
        current.appointments_set += 1;
        previousByUserId.set(row.user_id, current);
      }
    }
  }

  const totals = sumMetricMap(currentByUserId);
  const previousTotals = sumMetricMap(previousByUserId);

  return {
    totals,
    previousTotals,
    deltas: calculateDeltas(totals, previousTotals),
    memberMetrics: currentByUserId,
    memberDeltas: new Map(
      memberIds.map((memberId) => [
        memberId,
        calculateDeltas(
          currentByUserId.get(memberId) ?? { ...ZERO_METRICS },
          previousByUserId.get(memberId) ?? { ...ZERO_METRICS }
        ),
      ])
    ),
  };
}

function buildDisplayName(profile?: ProfileRow | null): string {
  const fullName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return fullName || 'Member';
}

function serializePeriod(row: Pick<ReportRow, 'period_start' | 'period_end' | 'created_at'>, reportCount: number) {
  return {
    period_start: row.period_start,
    period_end: row.period_end,
    created_at: row.created_at,
    report_count: reportCount,
  };
}

function getRequestOrigin(request: NextRequest): string {
  const configured =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.headers.get('origin')?.trim() ||
    request.nextUrl.origin;

  return configured.replace(/\/$/, '');
}

async function loadAuthEmails(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const email = data?.user?.email?.trim().toLowerCase();
      if (!error && email) emailByUserId.set(userId, email);
    })
  );
  return emailByUserId;
}

async function buildEmailReportPayload(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  period: ReportPeriod;
  periodStart: string;
  requestedMemberIds: string[];
}): Promise<
  | { ok: true; report: EmailReportPayload; workspaceName: string; leadEmails: string[] }
  | { ok: false; status: number; error: string }
> {
  const { admin, workspaceId, period, periodStart, requestedMemberIds } = params;

  const [workspaceRes, workspaceMembersRes] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    admin
      .from('workspace_members')
      .select('user_id, role, color, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true }),
  ]);

  if (workspaceRes.error) {
    console.error('[team/reports/email] workspace error:', workspaceRes.error);
    return { ok: false, status: 500, error: workspaceRes.error.message };
  }

  if (workspaceMembersRes.error) {
    console.error('[team/reports/email] workspace_members error:', workspaceMembersRes.error);
    return { ok: false, status: 500, error: workspaceMembersRes.error.message };
  }

  const workspace = workspaceRes.data as WorkspaceRow | null;
  const workspaceMembers = (workspaceMembersRes.data ?? []) as WorkspaceMemberRow[];
  const workspaceUserIds = new Set(workspaceMembers.map((member) => member.user_id));
  const selectedMemberIds = requestedMemberIds.filter((id) => workspaceUserIds.has(id));
  const relevantMemberIds = requestedMemberIds.length > 0
    ? selectedMemberIds
    : workspaceMembers.map((member) => member.user_id);

  if (relevantMemberIds.length === 0) {
    return { ok: false, status: 400, error: 'No valid members found for this report' };
  }

  const leadUserIds = Array.from(
    new Set(
      workspaceMembers
        .filter((member) => member.role === 'owner' || member.role === 'admin')
        .map((member) => member.user_id)
    )
  );

  if (leadUserIds.length === 0) {
    return { ok: false, status: 400, error: 'No team lead found for this workspace' };
  }

  const [profilesRes, teamReportsRes, memberReportsRes, emailByUserId] = await Promise.all([
    admin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', Array.from(new Set([...relevantMemberIds, ...leadUserIds]))),
    admin
      .from('reports')
      .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
      .eq('workspace_id', workspaceId)
      .eq('period', period)
      .eq('scope', 'team')
      .gte('period_start', periodStart)
      .lte('period_start', periodStart)
      .limit(10),
    admin
      .from('reports')
      .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
      .eq('workspace_id', workspaceId)
      .eq('period', period)
      .eq('scope', 'member')
      .in('subject_user_id', relevantMemberIds)
      .gte('period_start', periodStart)
      .lte('period_start', periodStart)
      .limit(1000),
    loadAuthEmails(admin, leadUserIds),
  ]);

  if (profilesRes.error) {
    console.error('[team/reports/email] user_profiles error:', profilesRes.error);
    return { ok: false, status: 500, error: profilesRes.error.message };
  }

  if (teamReportsRes.error) {
    console.error('[team/reports/email] team reports error:', teamReportsRes.error);
    return { ok: false, status: 500, error: teamReportsRes.error.message };
  }

  if (memberReportsRes.error) {
    console.error('[team/reports/email] member reports error:', memberReportsRes.error);
    return { ok: false, status: 500, error: memberReportsRes.error.message };
  }

  const leadEmails = leadUserIds
    .map((userId) => emailByUserId.get(userId))
    .filter((email): email is string => typeof email === 'string' && email.length > 0);

  if (leadEmails.length === 0) {
    return { ok: false, status: 400, error: 'No email address found for the team lead' };
  }

  const profileByUserId = new Map(
    ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
  );
  const teamReports = (teamReportsRes.data ?? []) as ReportRow[];
  const memberReports = (memberReportsRes.data ?? []) as ReportRow[];
  const teamReportForPeriod = teamReports.find((row) =>
    samePeriodStart(row.period_start, periodStart)
  );
  const memberRowsForPeriod = memberReports.filter((row) =>
    row.subject_user_id && samePeriodStart(row.period_start, periodStart)
  );
  const memberRowsByUserId = new Map(
    memberRowsForPeriod.map((row) => [row.subject_user_id as string, row])
  );

  const isFiltered = requestedMemberIds.length > 0;
  const rowsToAggregate = isFiltered
    ? selectedMemberIds
      .map((id) => memberRowsByUserId.get(id))
      .filter((row): row is ReportRow => Boolean(row))
    : memberRowsForPeriod;

  const periodForEmail = teamReportForPeriod ?? rowsToAggregate[0] ?? periodFromStart(period, periodStart);
  if (!periodForEmail) {
    return { ok: false, status: 400, error: 'Invalid report period' };
  }

  const periodStartDate = new Date(periodForEmail.period_start);
  const periodEndDate = new Date(periodForEmail.period_end);
  const periodMs = periodEndDate.getTime() - periodStartDate.getTime();
  const liveReport = await loadLiveReportMetrics({
    supabase: admin,
    workspaceId,
    memberIds: relevantMemberIds,
    periodStart: periodForEmail.period_start,
    periodEnd: periodForEmail.period_end,
    previousStart: new Date(periodStartDate.getTime() - periodMs).toISOString(),
    previousEnd: periodStartDate.toISOString(),
  });

  const totals = liveReport.totals;
  const deltas = liveReport.deltas;

  const members = relevantMemberIds
    .map((memberId) => {
      const workspaceMember = workspaceMembers.find((member) => member.user_id === memberId);
      const report = memberRowsByUserId.get(memberId);
      const metrics = liveReport.memberMetrics.get(memberId) ?? normalizeMetrics(report?.metrics);

      return {
        display_name: buildDisplayName(profileByUserId.get(memberId)),
        role: workspaceMember?.role ?? 'member',
        has_report: true,
        metrics,
        rates: {
          conversations_per_door: metrics.doors_knocked > 0 ? metrics.conversations / metrics.doors_knocked : 0,
          leads_per_conversation: metrics.conversations > 0 ? metrics.leads_created / metrics.conversations : 0,
          appointments_per_conversation: metrics.conversations > 0 ? metrics.appointments_set / metrics.conversations : 0,
        },
      };
    })
    .sort((left, right) => {
      if (right.metrics.doors_knocked !== left.metrics.doors_knocked) {
        return right.metrics.doors_knocked - left.metrics.doors_knocked;
      }
      if (right.metrics.conversations !== left.metrics.conversations) {
        return right.metrics.conversations - left.metrics.conversations;
      }
      return left.display_name.localeCompare(right.display_name);
    });

  return {
    ok: true,
    workspaceName: workspace?.name?.trim() || 'WolfGrid team',
    leadEmails,
    report: {
      period,
      period_start: periodForEmail.period_start,
      period_end: periodForEmail.period_end,
      generated_at: teamReportForPeriod?.created_at ?? periodForEmail.created_at,
      totals,
      deltas,
      rates: {
        conversations_per_door: totals.doors_knocked > 0 ? totals.conversations / totals.doors_knocked : 0,
        leads_per_conversation: totals.conversations > 0 ? totals.leads_created / totals.conversations : 0,
        appointments_per_conversation: totals.conversations > 0 ? totals.appointments_set / totals.conversations : 0,
      },
      members,
    },
  };
}

async function resolveReportContext(request: NextRequest) {
  const authClient = await getSupabaseServerClient();
  const { data: { user }, error: userError } = await authClient.auth.getUser();
  if (userError || !user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  const resolution = await resolveTeamDashboardMode(
    supabase as unknown as MinimalSupabaseClient,
    user.id,
    workspaceId
  );

  if (resolution.error || !resolution.workspaceId || resolution.mode !== 'team_owner') {
    return {
      response: NextResponse.json(
        { error: resolution.error ?? 'Forbidden' },
        { status: resolution.status ?? 403 }
      ),
    };
  }

  return {
    user,
    supabase,
    workspaceId: resolution.workspaceId,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveReportContext(request);
    if (context.response) return context.response;
    const { supabase, workspaceId } = context;
    const { searchParams } = new URL(request.url);

    const period = parsePeriod(searchParams.get('period'));
    if (!period) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const requestedMemberIds = (searchParams.get('memberIds') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const requestedPeriodStart = searchParams.get('periodStart');

    const { data: workspaceMemberRows, error: workspaceMembersError } = await supabase
      .from('workspace_members')
      .select('user_id, role, color, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (workspaceMembersError) {
      console.error('[team/reports] workspace_members error:', workspaceMembersError);
      return NextResponse.json({ error: workspaceMembersError.message }, { status: 500 });
    }

    const workspaceMembers = (workspaceMemberRows ?? []) as WorkspaceMemberRow[];
    const workspaceUserIds = new Set(workspaceMembers.map((member) => member.user_id));
    const selectedMemberIds = requestedMemberIds.filter((id) => workspaceUserIds.has(id));
    const invalidMemberIds = requestedMemberIds.filter((id) => !workspaceUserIds.has(id));
    const isFiltered = requestedMemberIds.length > 0;
    const relevantMemberIds = isFiltered ? selectedMemberIds : workspaceMembers.map((member) => member.user_id);

    const [profilesRes, teamReportsRes, memberReportsRes] = await Promise.all([
      relevantMemberIds.length > 0
        ? supabase
          .from('user_profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', relevantMemberIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('reports')
        .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
        .eq('workspace_id', workspaceId)
        .eq('period', period)
        .eq('scope', 'team')
        .order('period_start', { ascending: false })
        .limit(150),
      relevantMemberIds.length > 0
        ? supabase
          .from('reports')
          .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
          .eq('workspace_id', workspaceId)
          .eq('period', period)
          .eq('scope', 'member')
          .in('subject_user_id', relevantMemberIds)
          .order('period_start', { ascending: false })
          .limit(1000)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesRes.error) {
      console.error('[team/reports] user_profiles error:', profilesRes.error);
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    if (teamReportsRes.error) {
      console.error('[team/reports] team reports error:', teamReportsRes.error);
      return NextResponse.json({ error: teamReportsRes.error.message }, { status: 500 });
    }

    if (memberReportsRes.error) {
      console.error('[team/reports] member reports error:', memberReportsRes.error);
      return NextResponse.json({ error: memberReportsRes.error.message }, { status: 500 });
    }

    const profileByUserId = new Map(
      ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
    );
    const teamReports = (teamReportsRes.data ?? []) as ReportRow[];
    const memberReports = (memberReportsRes.data ?? []) as ReportRow[];

    const periodRows = isFiltered ? memberReports : (teamReports.length > 0 ? teamReports : memberReports);
    const periodMap = new Map<string, { row: ReportRow; count: number }>();
    for (const row of periodRows) {
      const existing = periodMap.get(row.period_start);
      if (!existing) {
        periodMap.set(row.period_start, { row, count: 1 });
      } else {
        existing.count += 1;
      }
    }

    let availablePeriods = Array.from(periodMap.values())
      .map(({ row, count }) => serializePeriod(row, count))
      .sort((left, right) => right.period_start.localeCompare(left.period_start));

    if (availablePeriods.length === 0) {
      availablePeriods = [latestCompletedPeriod(period)];
    }

    const selectedPeriod = requestedPeriodStart
      ? availablePeriods.find((item) => samePeriodStart(item.period_start, requestedPeriodStart)) ??
        periodFromStart(period, requestedPeriodStart)
      : availablePeriods[0] ?? null;

    if (!selectedPeriod) {
      return NextResponse.json({
        period,
        period_start: null,
        period_end: null,
        source: 'none',
        availablePeriods: [],
        totals: { ...ZERO_METRICS },
        deltas: normalizeDeltas(null),
        rates: {
          conversations_per_door: 0,
          leads_per_conversation: 0,
          appointments_per_conversation: 0,
        },
        members: [],
        coverage: {
          expected_member_count: relevantMemberIds.length,
          covered_member_count: 0,
          missing_member_ids: relevantMemberIds,
          invalid_member_ids: invalidMemberIds,
        },
      });
    }

    const memberRowsForPeriod = memberReports.filter((row) =>
      row.subject_user_id && samePeriodStart(row.period_start, selectedPeriod.period_start)
    );
    const memberRowsByUserId = new Map(
      memberRowsForPeriod.map((row) => [row.subject_user_id as string, row])
    );

    const teamReportForPeriod = teamReports.find((row) =>
      samePeriodStart(row.period_start, selectedPeriod.period_start)
    );

    const periodStartDate = new Date(selectedPeriod.period_start);
    const periodEndDate = new Date(selectedPeriod.period_end);
    const periodMs = periodEndDate.getTime() - periodStartDate.getTime();
    const previousStart = new Date(periodStartDate.getTime() - periodMs).toISOString();
    const previousEnd = periodStartDate.toISOString();

    const liveReport = relevantMemberIds.length > 0
      ? await loadLiveReportMetrics({
        supabase,
        workspaceId,
        memberIds: relevantMemberIds,
        periodStart: selectedPeriod.period_start,
        periodEnd: selectedPeriod.period_end,
        previousStart,
        previousEnd,
      })
      : {
        totals: { ...ZERO_METRICS },
        previousTotals: { ...ZERO_METRICS },
        deltas: calculateDeltas(ZERO_METRICS, ZERO_METRICS),
        memberMetrics: new Map<string, ReportMetrics>(),
        memberDeltas: new Map<string, ReportDeltas>(),
      };

    const totals = liveReport.totals;
    const deltas = liveReport.deltas;

    const memberRows = relevantMemberIds
      .map((memberId) => {
        const workspaceMember = workspaceMembers.find((member) => member.user_id === memberId);
        const report = memberRowsByUserId.get(memberId);
        const metrics = liveReport.memberMetrics.get(memberId) ?? normalizeMetrics(report?.metrics);
        const rowDeltas = liveReport.memberDeltas.get(memberId) ?? normalizeDeltas(report?.deltas);

        return {
          user_id: memberId,
          display_name: buildDisplayName(profileByUserId.get(memberId)),
          role: workspaceMember?.role ?? 'member',
          color: workspaceMember?.color ?? '#3B82F6',
          has_report: true,
          metrics,
          deltas: rowDeltas,
          rates: {
            conversations_per_door: metrics.doors_knocked > 0 ? metrics.conversations / metrics.doors_knocked : 0,
            leads_per_conversation: metrics.conversations > 0 ? metrics.leads_created / metrics.conversations : 0,
            appointments_per_conversation: metrics.conversations > 0 ? metrics.appointments_set / metrics.conversations : 0,
          },
        };
      })
      .sort((left, right) => {
        if (right.metrics.doors_knocked !== left.metrics.doors_knocked) {
          return right.metrics.doors_knocked - left.metrics.doors_knocked;
        }
        if (right.metrics.conversations !== left.metrics.conversations) {
          return right.metrics.conversations - left.metrics.conversations;
        }
        return left.display_name.localeCompare(right.display_name);
      });

    const missingMemberIds: string[] = [];

    return NextResponse.json({
      period,
      period_start: selectedPeriod.period_start,
      period_end: selectedPeriod.period_end,
      source: 'live_sessions',
      generated_at: teamReportForPeriod?.created_at ?? selectedPeriod.created_at,
      availablePeriods,
      totals,
      deltas,
      rates: {
        conversations_per_door: totals.doors_knocked > 0 ? totals.conversations / totals.doors_knocked : 0,
        leads_per_conversation: totals.conversations > 0 ? totals.leads_created / totals.conversations : 0,
        appointments_per_conversation: totals.conversations > 0 ? totals.appointments_set / totals.conversations : 0,
      },
      members: memberRows,
      coverage: {
        expected_member_count: relevantMemberIds.length,
        covered_member_count: memberRows.length - missingMemberIds.length,
        missing_member_ids: missingMemberIds,
        invalid_member_ids: invalidMemberIds,
      },
    });
  } catch (err) {
    console.error('[team/reports] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveReportContext(request);
    if (context.response) return context.response;
    const { supabase, workspaceId } = context;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      period?: string;
      periodStart?: string;
      memberIds?: string[];
    };

    const period = parsePeriod(body.period ?? null);
    if (!period) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    if (!body.periodStart) {
      return NextResponse.json({ error: 'periodStart is required' }, { status: 400 });
    }

    const requestedMemberIds = Array.isArray(body.memberIds)
      ? body.memberIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (body.action === 'email_team_leads') {
      const configError = getTeamReportMailerConfigError();
      if (configError) {
        return NextResponse.json({ error: configError }, { status: 500 });
      }

      const emailReport = await buildEmailReportPayload({
        admin: supabase,
        workspaceId,
        period,
        periodStart: body.periodStart,
        requestedMemberIds,
      });

      if (!emailReport.ok) {
        return NextResponse.json({ error: emailReport.error }, { status: emailReport.status });
      }

      const dashboardUrl = `${getRequestOrigin(request)}/home?tab=reporting&workspaceId=${encodeURIComponent(workspaceId)}`;
      let sendResult: { id: string | null };
      try {
        sendResult = await sendTeamLeadReportEmail({
          to: emailReport.leadEmails,
          workspaceName: emailReport.workspaceName,
          period: emailReport.report.period,
          periodStart: emailReport.report.period_start,
          periodEnd: emailReport.report.period_end,
          generatedAt: emailReport.report.generated_at,
          totals: emailReport.report.totals,
          deltas: emailReport.report.deltas,
          rates: emailReport.report.rates,
          members: emailReport.report.members,
          dashboardUrl,
        });
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : 'Failed to send report email';
        console.error('[team/reports/email] send error:', sendError);
        return NextResponse.json({ error: message }, { status: 500 });
      }

      return NextResponse.json({
        sent: true,
        recipient_count: emailReport.leadEmails.length,
        message_id: sendResult.id,
        period_start: emailReport.report.period_start,
        period_end: emailReport.report.period_end,
      });
    }

    const { data: workspaceMemberRows, error: workspaceMembersError } = await supabase
      .from('workspace_members')
      .select('user_id, role, color, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (workspaceMembersError) {
      console.error('[team/reports/notifications] workspace_members error:', workspaceMembersError);
      return NextResponse.json({ error: workspaceMembersError.message }, { status: 500 });
    }

    const workspaceMembers = (workspaceMemberRows ?? []) as WorkspaceMemberRow[];
    const selectedMemberRows = requestedMemberIds.length > 0
      ? requestedMemberIds
        .map((id) => workspaceMembers.find((member) => member.user_id === id))
        .filter((member): member is WorkspaceMemberRow => Boolean(member))
      : workspaceMembers;
    const notifyUserIds = selectedMemberRows.map((member) => member.user_id);

    if (notifyUserIds.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: 0,
        target_count: 0,
        message: 'No valid members to notify',
      });
    }

    const [teamReportsRes, memberReportsRes] = await Promise.all([
      supabase
        .from('reports')
        .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
        .eq('workspace_id', workspaceId)
        .eq('period', period)
        .eq('scope', 'team')
        .gte('period_start', body.periodStart)
        .lte('period_start', body.periodStart)
        .limit(10),
      supabase
        .from('reports')
        .select('id, workspace_id, scope, owner_user_id, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
        .eq('workspace_id', workspaceId)
        .eq('period', period)
        .eq('scope', 'member')
        .in('subject_user_id', notifyUserIds)
        .gte('period_start', body.periodStart)
        .lte('period_start', body.periodStart)
        .limit(1000),
    ]);

    if (teamReportsRes.error) {
      console.error('[team/reports/notifications] team reports error:', teamReportsRes.error);
      return NextResponse.json({ error: teamReportsRes.error.message }, { status: 500 });
    }

    if (memberReportsRes.error) {
      console.error('[team/reports/notifications] member reports error:', memberReportsRes.error);
      return NextResponse.json({ error: memberReportsRes.error.message }, { status: 500 });
    }

    const teamReport = ((teamReportsRes.data ?? []) as ReportRow[]).find((row) =>
      samePeriodStart(row.period_start, body.periodStart)
    );
    const memberReportsByUserId = new Map(
      ((memberReportsRes.data ?? []) as ReportRow[])
        .filter((row) => row.subject_user_id && samePeriodStart(row.period_start, body.periodStart))
        .map((row) => [row.subject_user_id as string, row])
    );

    const periodEnd = teamReport?.period_end ?? Array.from(memberReportsByUserId.values())[0]?.period_end ?? null;
    if (!teamReport && memberReportsByUserId.size === 0) {
      return NextResponse.json({ error: 'No report snapshot found for this period' }, { status: 404 });
    }

    const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : NaN;
    const eligibleMemberRows = selectedMemberRows.filter((member) => {
      if (!Number.isFinite(periodEndMs)) return true;
      const joinedAtMs = member.created_at ? new Date(member.created_at).getTime() : NaN;
      return !Number.isFinite(joinedAtMs) || joinedAtMs <= periodEndMs;
    });
    const eligibleUserIds = eligibleMemberRows.map((member) => member.user_id);

    if (eligibleUserIds.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: notifyUserIds.length,
        target_count: notifyUserIds.length,
        period_start: body.periodStart,
        period_end: periodEnd,
      });
    }

    const { data: existingNotifications, error: existingNotificationsError } = await supabase
      .from('notifications')
      .select('user_id, data')
      .eq('workspace_id', workspaceId)
      .eq('type', 'report_ready')
      .in('user_id', eligibleUserIds)
      .limit(1000);

    if (existingNotificationsError) {
      console.error('[team/reports/notifications] existing notifications error:', existingNotificationsError);
      return NextResponse.json({ error: existingNotificationsError.message }, { status: 500 });
    }

    const existingKeys = new Set(
      ((existingNotifications ?? []) as NotificationRow[])
        .map((notification) => {
          const data = notification.data ?? {};
          const reportId = typeof data.report_id === 'string' ? data.report_id : '';
          const dataPeriod = typeof data.period === 'string' ? data.period : '';
          const dataScope = typeof data.scope === 'string' ? data.scope : '';
          const dataPeriodStart = typeof data.period_start === 'string' ? data.period_start : '';
          return [
            notification.user_id,
            reportId,
            dataPeriod,
            dataScope,
            dataPeriodStart,
          ].join(':');
        })
    );

    const notificationRows = eligibleMemberRows.flatMap((member) => {
      const userId = member.user_id;
      const memberReport = memberReportsByUserId.get(userId);
      const canReceiveTeamReport = member.role === 'owner' || member.role === 'admin';
      const report = memberReport ?? (canReceiveTeamReport ? teamReport : null);
      if (!report) return [];

      const scope = memberReport ? 'member' : 'team';
      const key = [userId, report.id, period, scope, report.period_start].join(':');
      const legacyKey = [userId, report.id, period, scope, ''].join(':');
      if (existingKeys.has(key) || existingKeys.has(legacyKey)) return [];

      return [{
        workspace_id: workspaceId,
        user_id: userId,
        type: 'report_ready',
        title: `${period[0].toUpperCase()}${period.slice(1)} report ready`,
        body: scope === 'member'
          ? `Your ${period} performance report is ready.`
          : `Your team's ${period} report is ready.`,
        data: {
          report_id: report.id,
          period,
          scope,
          period_start: report.period_start,
          period_end: report.period_end,
          link: '/home?tab=reporting',
        },
      }];
    });

    if (notificationRows.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: notifyUserIds.length,
        target_count: notifyUserIds.length,
        period_start: body.periodStart,
        period_end: periodEnd,
      });
    }

    const { error: notificationError } = await supabase
      .from('notifications')
      .insert(notificationRows);

    if (notificationError) {
      console.error('[team/reports/notifications] insert error:', notificationError);
      return NextResponse.json({ error: notificationError.message }, { status: 500 });
    }

    return NextResponse.json({
      created: notificationRows.length,
      skipped: notifyUserIds.length - notificationRows.length,
      target_count: notifyUserIds.length,
      period_start: body.periodStart,
      period_end: periodEnd,
    });
  } catch (err) {
    console.error('[team/reports/notifications] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
