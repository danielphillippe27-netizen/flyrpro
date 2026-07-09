'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Clock3,
  Download,
  DoorOpen,
  FileText,
  Mail,
  MessageSquare,
  Printer,
  Send,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/lib/workspace-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ReportPeriod = 'weekly' | 'monthly' | 'yearly';

type MetricKey =
  | 'doors_knocked'
  | 'flyers_delivered'
  | 'conversations'
  | 'leads_created'
  | 'appointments_set'
  | 'time_spent_seconds'
  | 'sessions_count';

type Metrics = Record<MetricKey, number>;

type Delta = {
  abs: number;
  pct: number | null;
  trend: 'up' | 'down' | 'flat';
};

type ReportMember = {
  user_id: string;
  display_name: string;
  role: string;
  color: string;
  has_report: boolean;
  metrics: Metrics;
  deltas: Record<MetricKey, Delta>;
  rates: {
    conversations_per_door: number;
    leads_per_conversation: number;
    appointments_per_conversation: number;
  };
};

type AvailablePeriod = {
  period_start: string;
  period_end: string;
  created_at: string;
  report_count: number;
};

type ReportResponse = {
  period: ReportPeriod;
  period_start: string | null;
  period_end: string | null;
  source: 'live_sessions' | 'team_snapshot' | 'member_aggregate' | 'member_aggregate_fallback' | 'none';
  generated_at?: string | null;
  availablePeriods: AvailablePeriod[];
  totals: Metrics;
  deltas: Record<MetricKey, Delta>;
  rates: {
    conversations_per_door: number;
    leads_per_conversation: number;
    appointments_per_conversation: number;
  };
  members: ReportMember[];
  coverage: {
    expected_member_count: number;
    covered_member_count: number;
    missing_member_ids: string[];
    invalid_member_ids: string[];
  };
  error?: string;
};

type TeamReportingTabProps = {
  memberIds: string[];
  demoReport?: boolean;
};

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const SURFACE_CLASS = 'operator-surface rounded-2xl border border-border/70 bg-card shadow-none';

function makeDelta(abs: number, pct: number | null = null): Delta {
  return {
    abs,
    pct,
    trend: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
  };
}

function makeMetrics(input: Partial<Metrics>): Metrics {
  return {
    doors_knocked: input.doors_knocked ?? 0,
    flyers_delivered: input.flyers_delivered ?? input.doors_knocked ?? 0,
    conversations: input.conversations ?? 0,
    leads_created: input.leads_created ?? 0,
    appointments_set: input.appointments_set ?? 0,
    time_spent_seconds: input.time_spent_seconds ?? 0,
    sessions_count: input.sessions_count ?? 0,
  };
}

function makeDeltas(metrics: Metrics): Record<MetricKey, Delta> {
  return {
    doors_knocked: makeDelta(Math.round(metrics.doors_knocked * 0.18), 18),
    flyers_delivered: makeDelta(Math.round(metrics.flyers_delivered * 0.16), 16),
    conversations: makeDelta(Math.round(metrics.conversations * 0.22), 22),
    leads_created: makeDelta(Math.max(1, Math.round(metrics.leads_created * 0.2)), 20),
    appointments_set: makeDelta(Math.max(1, Math.round(metrics.appointments_set * 0.25)), 25),
    time_spent_seconds: makeDelta(Math.round(metrics.time_spent_seconds * 0.12), 12),
    sessions_count: makeDelta(Math.max(1, Math.round(metrics.sessions_count * 0.15)), 15),
  };
}

function makeRates(metrics: Metrics) {
  return {
    conversations_per_door: metrics.doors_knocked > 0 ? metrics.conversations / metrics.doors_knocked : 0,
    leads_per_conversation: metrics.conversations > 0 ? metrics.leads_created / metrics.conversations : 0,
    appointments_per_conversation: metrics.conversations > 0 ? metrics.appointments_set / metrics.conversations : 0,
  };
}

const DEMO_REPORT_MEMBERS = [
  { user_id: 'demo-maya', display_name: 'Maya', role: 'Demo rep', color: '#EF4444', metrics: makeMetrics({ doors_knocked: 86, conversations: 24, leads_created: 4, appointments_set: 2, time_spent_seconds: 7200, sessions_count: 3 }) },
  { user_id: 'demo-leo', display_name: 'Leo', role: 'Demo rep', color: '#2563EB', metrics: makeMetrics({ doors_knocked: 79, conversations: 21, leads_created: 3, appointments_set: 2, time_spent_seconds: 6900, sessions_count: 3 }) },
  { user_id: 'demo-ava', display_name: 'Ava', role: 'Demo rep', color: '#16A34A', metrics: makeMetrics({ doors_knocked: 75, conversations: 18, leads_created: 2, appointments_set: 1, time_spent_seconds: 6300, sessions_count: 3 }) },
  { user_id: 'demo-noah', display_name: 'Noah', role: 'Demo rep', color: '#7C3AED', metrics: makeMetrics({ doors_knocked: 72, conversations: 19, leads_created: 2, appointments_set: 1, time_spent_seconds: 6600, sessions_count: 3 }) },
].map<ReportMember>((member) => ({
  ...member,
  has_report: true,
  deltas: makeDeltas(member.metrics),
  rates: makeRates(member.metrics),
}));

const DEMO_REPORT_TOTALS = makeMetrics({
  doors_knocked: 312,
  conversations: 82,
  leads_created: 11,
  appointments_set: 6,
  time_spent_seconds: 27_000,
  sessions_count: 12,
});

const DEMO_TEAM_REPORT: ReportResponse = {
  period: 'weekly',
  period_start: '2026-07-01T00:00:00.000Z',
  period_end: '2026-07-08T00:00:00.000Z',
  source: 'team_snapshot',
  generated_at: '2026-07-07T19:00:00.000Z',
  availablePeriods: [
    {
      period_start: '2026-07-01T00:00:00.000Z',
      period_end: '2026-07-08T00:00:00.000Z',
      created_at: '2026-07-07T19:00:00.000Z',
      report_count: 4,
    },
  ],
  totals: DEMO_REPORT_TOTALS,
  deltas: makeDeltas(DEMO_REPORT_TOTALS),
  rates: makeRates(DEMO_REPORT_TOTALS),
  members: DEMO_REPORT_MEMBERS,
  coverage: {
    expected_member_count: 4,
    covered_member_count: 4,
    missing_member_ids: [],
    invalid_member_ids: [],
  },
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return 'No completed period';
  const startDate = new Date(start);
  const endDate = new Date(end);
  const endDisplay = new Date(endDate.getTime() - 1);
  return `${startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })} - ${endDisplay.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function formatGeneratedAt(value?: string | null): string {
  if (!value) return 'Generated date unavailable';
  return `Generated ${new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function deltaLabel(delta?: Delta): string {
  if (!delta) return '+0';
  const prefix = delta.abs >= 0 ? '+' : '';
  if (delta.pct == null) return `${prefix}${formatNumber(delta.abs)}`;
  return `${prefix}${formatNumber(delta.abs)} (${delta.pct >= 0 ? '+' : ''}${Math.round(delta.pct)}%)`;
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function sourceLabel(source: ReportResponse['source']): string {
  if (source === 'live_sessions') return 'Live sessions';
  if (source === 'team_snapshot') return 'Team snapshot';
  if (source === 'member_aggregate') return 'Selected members';
  if (source === 'member_aggregate_fallback') return 'Member snapshot fallback';
  return 'No snapshot';
}

type MetricCardProps = {
  icon: typeof DoorOpen;
  label: string;
  value: string;
  helper: string;
};

function MetricCard({ icon: Icon, label, value, helper }: MetricCardProps) {
  return (
    <Card className={SURFACE_CLASS}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          <span>{label}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}

function buildCsv(report: ReportResponse): string {
  const rows = [
    ['Report period', formatDateRange(report.period_start, report.period_end)],
    ['Source', sourceLabel(report.source)],
    ['Generated', report.generated_at ?? ''],
    [],
    ['Metric', 'Value', 'Delta'],
    ['Doors', report.totals.doors_knocked, deltaLabel(report.deltas.doors_knocked)],
    ['Flyers', report.totals.flyers_delivered, deltaLabel(report.deltas.flyers_delivered)],
    ['Conversations', report.totals.conversations, deltaLabel(report.deltas.conversations)],
    ['Leads', report.totals.leads_created, deltaLabel(report.deltas.leads_created)],
    ['Appointments', report.totals.appointments_set, deltaLabel(report.deltas.appointments_set)],
    ['Field time seconds', report.totals.time_spent_seconds, deltaLabel(report.deltas.time_spent_seconds)],
    ['Sessions', report.totals.sessions_count, deltaLabel(report.deltas.sessions_count)],
    [],
    [
      'Rep',
      'Role',
      'Has report',
      'Doors',
      'Flyers',
      'Conversations',
      'Leads',
      'Appointments',
      'Field time seconds',
      'Sessions',
      'Door-to-convo rate',
    ],
    ...report.members.map((member) => [
      member.display_name,
      member.role,
      member.has_report ? 'Yes' : 'No',
      member.metrics.doors_knocked,
      member.metrics.flyers_delivered,
      member.metrics.conversations,
      member.metrics.leads_created,
      member.metrics.appointments_set,
      member.metrics.time_spent_seconds,
      member.metrics.sessions_count,
      formatPercent(member.rates.conversations_per_door),
    ]),
  ];

  return rows.map((row) => row.map((cell) => escapeCsv(cell ?? '')).join(',')).join('\n');
}

export function TeamReportingTab({ memberIds, demoReport = false }: TeamReportingTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [period, setPeriod] = useState<ReportPeriod>('weekly');
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const fetchReport = useCallback(async () => {
    if (demoReport) {
      setPeriod('weekly');
      setSelectedPeriodStart(DEMO_TEAM_REPORT.period_start);
      setReport(DEMO_TEAM_REPORT);
      setError(null);
      setLoading(false);
      return;
    }

    if (!currentWorkspaceId) {
      setReport(null);
      setError('No workspace selected');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        period,
      });
      if (selectedPeriodStart) params.set('periodStart', selectedPeriodStart);
      if (memberIds.length > 0) params.set('memberIds', memberIds.join(','));

      const res = await fetch(`/api/team/reports?${params.toString()}`);
      const payload = (await res.json().catch(() => null)) as ReportResponse | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Failed to load report');
      }
      setReport(payload);
      if (!selectedPeriodStart && payload?.period_start) {
        setSelectedPeriodStart(payload.period_start);
      }
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, demoReport, memberIds, period, selectedPeriodStart]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const resetPeriod = (nextPeriod: ReportPeriod) => {
    setPeriod(nextPeriod);
    setSelectedPeriodStart(null);
  };

  const effectiveReport = demoReport ? DEMO_TEAM_REPORT : report;
  const printableReport = effectiveReport?.period_start ? effectiveReport : null;
  const totals = printableReport?.totals;
  const deltas = printableReport?.deltas;

  const reportTitle = useMemo(() => {
    const label = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? 'Weekly';
    return `${label} team report`;
  }, [period]);

  const downloadCsv = () => {
    if (!printableReport) return;
    const csv = buildCsv(printableReport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `team-${period}-report-${(printableReport.period_start ?? 'snapshot').slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    window.print();
  };

  const notifyReport = async () => {
    if (demoReport || !currentWorkspaceId || !report?.period_start) return;
    setNotifying(true);
    try {
      const res = await fetch(`/api/team/reports?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          periodStart: report.period_start,
          memberIds,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        created?: number;
        skipped?: number;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(payload?.error ?? 'Failed to create notifications');
      }

      const created = payload?.created ?? 0;
      const skipped = payload?.skipped ?? 0;
      toast.success(
        created > 0
          ? `Created ${created} report notification${created === 1 ? '' : 's'}.`
          : 'Report notifications were already created.',
        skipped > 0 ? { description: `${skipped} existing notification${skipped === 1 ? '' : 's'} skipped.` } : undefined
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create notifications');
    } finally {
      setNotifying(false);
    }
  };

  const emailReportLead = async () => {
    if (demoReport || !currentWorkspaceId || !report?.period_start) return;
    setEmailing(true);
    try {
      const res = await fetch(`/api/team/reports?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'email_team_leads',
          period,
          periodStart: report.period_start,
          memberIds,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        recipient_count?: number;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(payload?.error ?? 'Failed to email report');
      }

      const recipientCount = payload?.recipient_count ?? 0;
      toast.success(
        recipientCount > 0
          ? `Report emailed to ${recipientCount} team lead${recipientCount === 1 ? '' : 's'}.`
          : 'Report email sent.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to email report');
    } finally {
      setEmailing(false);
    }
  };

  if (loading && !effectiveReport) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const availablePeriods = effectiveReport?.availablePeriods?.length ? effectiveReport.availablePeriods : [];
  const hasReport = Boolean(printableReport && totals && deltas);
  const missingCount = printableReport?.coverage.missing_member_ids.length ?? 0;

  return (
    <div className="space-y-6">
      <Card className={`${SURFACE_CLASS} team-report-no-print`}>
        <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={period} onValueChange={(value) => resetPeriod(value as ReportPeriod)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedPeriodStart ?? effectiveReport?.period_start ?? ''}
              onValueChange={(value) => setSelectedPeriodStart(value)}
              disabled={availablePeriods.length === 0}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="No completed periods" />
              </SelectTrigger>
              <SelectContent>
                {availablePeriods.map((item) => (
                  <SelectItem key={item.period_start} value={item.period_start}>
                    {formatDateRange(item.period_start, item.period_end)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {printableReport ? <Badge variant="outline">{sourceLabel(printableReport.source)}</Badge> : null}
            {demoReport ? <Badge variant="outline">Demo report</Badge> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={emailReportLead} disabled={!hasReport || emailing || demoReport}>
              <Mail className="h-4 w-4" />
              {emailing ? 'Emailing' : 'Email lead'}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={notifyReport} disabled={!hasReport || notifying || demoReport}>
              <Bell className="h-4 w-4" />
              {notifying ? 'Notifying' : 'Notify'}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={downloadCsv} disabled={!hasReport}>
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={printReport} disabled={!hasReport}>
              <Printer className="h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className={`${SURFACE_CLASS} border-destructive/50`}>
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!printableReport || !totals || !deltas ? (
        <Card className={SURFACE_CLASS}>
          <CardContent className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 text-2xl font-semibold text-foreground">No completed reports yet</h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Completed weekly, monthly, and yearly snapshots will appear here after the reporting job creates them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="team-report-print-root space-y-6">
          <Card className={SURFACE_CLASS}>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-4 w-4 text-primary" />
                    <span>{sourceLabel(printableReport.source)}</span>
                  </div>
                  <CardTitle className="mt-2 text-3xl font-semibold tracking-tight">{reportTitle}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateRange(printableReport.period_start, printableReport.period_end)}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
                  <div>{formatGeneratedAt(printableReport.generated_at)}</div>
                  <div>{printableReport.coverage.covered_member_count} of {printableReport.coverage.expected_member_count} reps covered</div>
                </div>
              </div>
            </CardHeader>
            {missingCount > 0 || printableReport.source === 'member_aggregate_fallback' ? (
              <CardContent className="border-b border-border/60 py-3">
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  <span>
                    {missingCount > 0
                      ? `${missingCount} selected member${missingCount === 1 ? '' : 's'} do not have a snapshot for this period.`
                      : 'Team snapshot is missing, so this report is built from member snapshots.'}
                  </span>
                </div>
              </CardContent>
            ) : null}
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={DoorOpen}
              label="Doors"
              value={formatNumber(totals.doors_knocked)}
              helper={deltaLabel(deltas.doors_knocked)}
            />
            <MetricCard
              icon={Send}
              label="Flyers"
              value={formatNumber(totals.flyers_delivered)}
              helper={deltaLabel(deltas.flyers_delivered)}
            />
            <MetricCard
              icon={MessageSquare}
              label="Convos"
              value={formatNumber(totals.conversations)}
              helper={`${formatPercent(printableReport.rates.conversations_per_door)} door-to-convo`}
            />
            <MetricCard
              icon={Users}
              label="Leads"
              value={formatNumber(totals.leads_created)}
              helper={`${formatPercent(printableReport.rates.leads_per_conversation)} convo-to-lead`}
            />
            <MetricCard
              icon={CalendarDays}
              label="Appointments"
              value={formatNumber(totals.appointments_set)}
              helper={deltaLabel(deltas.appointments_set)}
            />
            <MetricCard
              icon={Clock3}
              label="Field time"
              value={formatDuration(totals.time_spent_seconds)}
              helper={deltaLabel(deltas.time_spent_seconds)}
            />
            <MetricCard
              icon={FileText}
              label="Sessions"
              value={formatNumber(totals.sessions_count)}
              helper={deltaLabel(deltas.sessions_count)}
            />
            <MetricCard
              icon={MessageSquare}
              label="Close rate"
              value={formatPercent(printableReport.rates.appointments_per_conversation)}
              helper="appointments per conversation"
            />
          </div>

          <Card className={`${SURFACE_CLASS} overflow-hidden`}>
            <CardHeader className="border-b border-border/60">
              <CardTitle className="text-2xl font-semibold tracking-tight">Rep breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-6">Rep</TableHead>
                    <TableHead className="text-right">Doors</TableHead>
                    <TableHead className="text-right">Flyers</TableHead>
                    <TableHead className="text-right">Convos</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Appointments</TableHead>
                    <TableHead className="text-right">Field time</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {printableReport.members.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell className="px-6">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: member.color }}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{member.display_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {member.has_report ? member.role : 'Missing snapshot'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatNumber(member.metrics.doors_knocked)}</TableCell>
                      <TableCell className="text-right">{formatNumber(member.metrics.flyers_delivered)}</TableCell>
                      <TableCell className="text-right">{formatNumber(member.metrics.conversations)}</TableCell>
                      <TableCell className="text-right">{formatNumber(member.metrics.leads_created)}</TableCell>
                      <TableCell className="text-right">{formatNumber(member.metrics.appointments_set)}</TableCell>
                      <TableCell className="text-right">{formatDuration(member.metrics.time_spent_seconds)}</TableCell>
                      <TableCell className="text-right">{formatPercent(member.rates.conversations_per_door)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
