import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getTeamReportMailerConfigError,
  sendTeamLeadReportEmail,
  type TeamReportDelta,
  type TeamReportMetricKey,
  type TeamReportMetrics,
  type TeamReportPeriod,
} from '@/lib/email/teamReports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WorkspaceMemberRow = {
  user_id: string;
  role: 'owner' | 'admin' | 'member' | null;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type ReportRow = {
  id: string;
  scope: 'team' | 'member' | string;
  subject_user_id: string | null;
  period: string;
  period_start: string;
  period_end: string;
  metrics: Partial<Record<TeamReportMetricKey, number | string | null>> | null;
  deltas: Partial<Record<TeamReportMetricKey, Partial<TeamReportDelta> | null>> | null;
  created_at: string;
};

type DueReportResult = {
  workspace_id?: unknown;
  period?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  team_reports_created?: unknown;
  error?: unknown;
};

type DueReportsPayload = {
  workspaces_scanned?: unknown;
  windows_due?: unknown;
  windows_run?: unknown;
  results?: unknown;
};

const PERIODS = new Set<TeamReportPeriod>(['weekly', 'monthly', 'yearly']);
const METRIC_KEYS: TeamReportMetricKey[] = [
  'doors_knocked',
  'flyers_delivered',
  'conversations',
  'leads_created',
  'appointments_set',
  'time_spent_seconds',
  'sessions_count',
];

const ZERO_METRICS: TeamReportMetrics = {
  doors_knocked: 0,
  flyers_delivered: 0,
  conversations: 0,
  leads_created: 0,
  appointments_set: 0,
  time_spent_seconds: 0,
  sessions_count: 0,
};

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

function getRequestOrigin(request: NextRequest): string {
  const configured =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    request.nextUrl.origin;

  return configured.replace(/\/$/, '');
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetrics(metrics?: ReportRow['metrics']): TeamReportMetrics {
  return METRIC_KEYS.reduce<TeamReportMetrics>(
    (acc, key) => ({
      ...acc,
      [key]: Math.max(0, numberValue(metrics?.[key])),
    }),
    { ...ZERO_METRICS }
  );
}

function normalizeDeltas(deltas?: ReportRow['deltas']): Record<TeamReportMetricKey, TeamReportDelta> {
  return METRIC_KEYS.reduce<Record<TeamReportMetricKey, TeamReportDelta>>((acc, key) => {
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
  }, {} as Record<TeamReportMetricKey, TeamReportDelta>);
}

function addMetrics(left: TeamReportMetrics, right: TeamReportMetrics): TeamReportMetrics {
  return METRIC_KEYS.reduce<TeamReportMetrics>(
    (acc, key) => ({
      ...acc,
      [key]: left[key] + right[key],
    }),
    { ...ZERO_METRICS }
  );
}

function aggregateDeltas(rows: ReportRow[]): Record<TeamReportMetricKey, TeamReportDelta> {
  return METRIC_KEYS.reduce<Record<TeamReportMetricKey, TeamReportDelta>>((acc, key) => {
    let current = 0;
    let previous = 0;

    for (const row of rows) {
      const metrics = normalizeMetrics(row.metrics);
      const deltas = normalizeDeltas(row.deltas);
      current += metrics[key];
      previous += metrics[key] - deltas[key].abs;
    }

    const abs = current - previous;
    acc[key] = {
      abs,
      pct: previous === 0 ? null : Number(((abs / previous) * 100).toFixed(2)),
      trend: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
    };
    return acc;
  }, {} as Record<TeamReportMetricKey, TeamReportDelta>);
}

function samePeriodStart(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

function displayName(profile?: ProfileRow | null): string {
  const name = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return name || 'Member';
}

async function rpcGenerateDueReports(admin: ReturnType<typeof createAdminClient>) {
  const withNow = await admin.rpc('generate_due_reports', {
    p_now: new Date().toISOString(),
  });

  if (!withNow.error) return withNow;

  const maybeMessage = withNow.error.message?.toLowerCase() ?? '';
  if (!maybeMessage.includes('function') && !maybeMessage.includes('p_now')) {
    return withNow;
  }

  return admin.rpc('generate_due_reports');
}

async function loadAuthEmails(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const email = data?.user?.email?.trim().toLowerCase();
      if (!error && email) emails.set(userId, email);
    })
  );
  return emails;
}

async function emailGeneratedTeamReport(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  period: TeamReportPeriod;
  periodStart: string;
  origin: string;
}) {
  const { admin, workspaceId, period, periodStart, origin } = params;

  const [workspaceRes, membersRes, reportsRes] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    admin.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId),
    admin
      .from('reports')
      .select('id, scope, subject_user_id, period, period_start, period_end, metrics, deltas, created_at')
      .eq('workspace_id', workspaceId)
      .eq('period', period)
      .gte('period_start', periodStart)
      .lte('period_start', periodStart)
      .in('scope', ['team', 'member'])
      .limit(1000),
  ]);

  if (workspaceRes.error) throw new Error(workspaceRes.error.message);
  if (membersRes.error) throw new Error(membersRes.error.message);
  if (reportsRes.error) throw new Error(reportsRes.error.message);

  const workspaceName = workspaceRes.data?.name?.trim() || 'WolfGrid team';
  const members = (membersRes.data ?? []) as WorkspaceMemberRow[];
  const leadIds = members
    .filter((member) => member.role === 'owner' || member.role === 'admin')
    .map((member) => member.user_id);
  const memberIds = members.map((member) => member.user_id);

  if (leadIds.length === 0) return { sent: false, skipped: 'no_team_leads' };

  const [emailByUserId, profilesRes] = await Promise.all([
    loadAuthEmails(admin, leadIds),
    admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', memberIds),
  ]);

  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const recipients = leadIds
    .map((userId) => emailByUserId.get(userId))
    .filter((email): email is string => Boolean(email));

  if (recipients.length === 0) return { sent: false, skipped: 'no_lead_emails' };

  const reports = ((reportsRes.data ?? []) as ReportRow[]).filter((report) =>
    samePeriodStart(report.period_start, periodStart)
  );
  const teamReport = reports.find((report) => report.scope === 'team') ?? null;
  const memberReports = reports.filter((report) => report.scope === 'member');

  if (!teamReport && memberReports.length === 0) {
    return { sent: false, skipped: 'no_report_snapshot' };
  }

  const memberReportByUserId = new Map(
    memberReports
      .filter((report) => report.subject_user_id)
      .map((report) => [report.subject_user_id as string, report])
  );
  const profileByUserId = new Map(
    ((profilesRes.data ?? []) as ProfileRow[]).map((profile) => [profile.user_id, profile])
  );
  const totals = teamReport
    ? normalizeMetrics(teamReport.metrics)
    : memberReports.reduce<TeamReportMetrics>(
      (acc, report) => addMetrics(acc, normalizeMetrics(report.metrics)),
      { ...ZERO_METRICS }
    );
  const deltas = teamReport ? normalizeDeltas(teamReport.deltas) : aggregateDeltas(memberReports);
  const firstReport = teamReport ?? memberReports[0];

  const result = await sendTeamLeadReportEmail({
    to: recipients,
    workspaceName,
    period,
    periodStart: firstReport.period_start,
    periodEnd: firstReport.period_end,
    generatedAt: teamReport?.created_at ?? firstReport.created_at,
    totals,
    deltas,
    rates: {
      conversations_per_door: totals.doors_knocked > 0 ? totals.conversations / totals.doors_knocked : 0,
      leads_per_conversation: totals.conversations > 0 ? totals.leads_created / totals.conversations : 0,
      appointments_per_conversation: totals.conversations > 0 ? totals.appointments_set / totals.conversations : 0,
    },
    members: memberIds
      .map((memberId) => {
        const report = memberReportByUserId.get(memberId);
        const metrics = normalizeMetrics(report?.metrics);
        const member = members.find((row) => row.user_id === memberId);
        return {
          display_name: displayName(profileByUserId.get(memberId)),
          role: member?.role ?? 'member',
          has_report: Boolean(report),
          metrics,
          rates: {
            conversations_per_door: metrics.doors_knocked > 0 ? metrics.conversations / metrics.doors_knocked : 0,
            leads_per_conversation: metrics.conversations > 0 ? metrics.leads_created / metrics.conversations : 0,
            appointments_per_conversation: metrics.conversations > 0 ? metrics.appointments_set / metrics.conversations : 0,
          },
        };
      })
      .sort((left, right) => right.metrics.doors_knocked - left.metrics.doors_knocked),
    dashboardUrl: `${origin}/home?tab=reporting&workspaceId=${encodeURIComponent(workspaceId)}`,
  });

  return {
    sent: true,
    messageId: result.id,
    recipientCount: recipients.length,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configError = getTeamReportMailerConfigError();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  const admin = createAdminClient();
  const generated = await rpcGenerateDueReports(admin);
  if (generated.error) {
    console.error('[cron/team-reports] generate_due_reports error:', generated.error);
    return NextResponse.json({ error: generated.error.message }, { status: 500 });
  }

  const payload = (generated.data ?? {}) as DueReportsPayload;
  const results = Array.isArray(payload.results) ? (payload.results as DueReportResult[]) : [];
  const emailResults = [];

  for (const result of results) {
    const workspaceId = typeof result.workspace_id === 'string' ? result.workspace_id : null;
    const period = typeof result.period === 'string' && PERIODS.has(result.period as TeamReportPeriod)
      ? (result.period as TeamReportPeriod)
      : null;
    const periodStart = typeof result.period_start === 'string' ? result.period_start : null;
    const createdTeamReports = numberValue(result.team_reports_created);

    if (!workspaceId || !period || !periodStart || createdTeamReports <= 0 || result.error) {
      continue;
    }

    try {
      const emailResult = await emailGeneratedTeamReport({
        admin,
        workspaceId,
        period,
        periodStart,
        origin: getRequestOrigin(request),
      });
      emailResults.push({ workspace_id: workspaceId, period, period_start: periodStart, ...emailResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send report email';
      console.error('[cron/team-reports] email error:', { workspaceId, period, periodStart, error });
      emailResults.push({ workspace_id: workspaceId, period, period_start: periodStart, sent: false, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    generated: payload,
    emails: emailResults,
  });
}
