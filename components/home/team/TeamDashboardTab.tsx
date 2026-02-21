'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  DoorOpen,
  MessageSquare,
  CalendarCheck,
  Send,
  UserPlus,
  Clock,
  Trophy,
  FileText,
  Printer,
  X,
} from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type Summary = {
  period: { start: string; end: string };
  totals: {
    doors: number;
    convos: number;
    flyers?: number;
    followups: number;
    appointments: number;
    sessions_count: number;
    total_duration_seconds?: number;
  };
  previousTotals: Record<string, number>;
  deltas: Record<string, number>;
  trend: { doorsByDay: Array<{ date: string | null; doors: number }> };
};

type MemberRow = {
  user_id: string;
  display_name: string;
  role?: string | null;
  color: string;
  last_active_at: string | null;
  inactive_days: number | null;
  doors_knocked: number;
  conversations: number;
  flyers_delivered: number;
  followups: number;
  appointments: number;
  sessions_count: number;
  active_days: number;
};

type MemberClickTarget = {
  user_id: string;
  display_name: string;
  color: string;
};

type TeamMemberPerformanceTableProps = {
  members: MemberRow[];
  onMemberClick?: (member: MemberClickTarget) => void;
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatDurationDelta(deltaSeconds: number): string {
  if (deltaSeconds === 0) return 'Same as last period';
  const abs = Math.abs(deltaSeconds);
  const formatted = formatDuration(abs);
  return deltaSeconds > 0 ? `+${formatted} vs last period` : `-${formatted} vs last period`;
}

function TeamMemberPerformanceTable({ members, onMemberClick }: TeamMemberPerformanceTableProps) {
  const rankedMembers = [...members].sort((a, b) => {
    if (b.doors_knocked !== a.doors_knocked) return b.doors_knocked - a.doors_knocked;
    if (b.followups !== a.followups) return b.followups - a.followups;
    return b.conversations - a.conversations;
  });

  if (rankedMembers.length === 0) {
    return <p className="text-sm text-muted-foreground print:text-slate-600">No member activity in this period.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border print:overflow-visible print:border-slate-300">
      <table className="w-full min-w-[980px] text-sm print:min-w-0">
        <thead className="bg-muted/40 print:bg-transparent">
          <tr className="border-b border-border print:border-slate-300">
            <th className="px-3 py-2 text-left font-medium">Member</th>
            <th className="px-3 py-2 text-right font-medium">Doors</th>
            <th className="px-3 py-2 text-right font-medium">Flyers</th>
            <th className="px-3 py-2 text-right font-medium">Convos</th>
            <th className="px-3 py-2 text-right font-medium">Leads</th>
            <th className="px-3 py-2 text-right font-medium">Appts</th>
            <th className="px-3 py-2 text-right font-medium">Sessions</th>
            <th className="px-3 py-2 text-right font-medium">Active days</th>
            <th className="px-3 py-2 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {rankedMembers.map((member, index) => {
            const isClickable = Boolean(onMemberClick);
            const roleLabel = typeof member.role === 'string' && member.role.length > 0 ? member.role : null;
            return (
              <tr
                key={member.user_id}
                className={cn(
                  'border-b border-border/60 print:border-slate-200',
                  isClickable && 'cursor-pointer hover:bg-muted/40'
                )}
                onClick={
                  isClickable
                    ? () =>
                        onMemberClick?.({
                          user_id: member.user_id,
                          display_name: member.display_name,
                          color: member.color,
                        })
                    : undefined
                }
                role={isClickable ? 'button' : undefined}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full print:border print:border-slate-400"
                      style={{ backgroundColor: member.color }}
                      aria-hidden
                    />
                    <span className="font-medium">{`#${index + 1} ${member.display_name}`}</span>
                    {roleLabel && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground print:border-slate-300 print:text-slate-600">
                        {roleLabel}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{member.doors_knocked}</td>
                <td className="px-3 py-2 text-right">{member.flyers_delivered ?? 0}</td>
                <td className="px-3 py-2 text-right">{member.conversations}</td>
                <td className="px-3 py-2 text-right">{member.followups ?? 0}</td>
                <td className="px-3 py-2 text-right">{member.appointments ?? 0}</td>
                <td className="px-3 py-2 text-right">{member.sessions_count}</td>
                <td className="px-3 py-2 text-right">{member.active_days}</td>
                <td className="px-3 py-2 text-right text-muted-foreground print:text-slate-600">
                  {member.last_active_at ? new Date(member.last_active_at).toLocaleDateString() : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type TeamDashboardTabProps = {
  range: TeamControlsRange;
  memberIds: string[];
  onMemberClick?: (member: MemberClickTarget) => void;
};

export function TeamDashboardTab({ range, memberIds, onMemberClick }: TeamDashboardTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!currentWorkspaceId) {
      setSummary(null);
      setMembers([]);
      setError('No workspace selected');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        start: range.start,
        end: range.end,
      });
      const qs = query.toString();
      const [summaryRes, membersRes] = await Promise.all([
        fetch('/api/team/summary?' + qs),
        fetch('/api/team/members?' + qs),
      ]);
      if (!summaryRes.ok) {
        const payload = (await summaryRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load summary');
      }
      if (!membersRes.ok) {
        const payload = (await membersRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load members');
      }
      const summaryData = await summaryRes.json();
      const membersData = await membersRes.json();
      setSummary(summaryData);
      const list = (membersData.members ?? []) as MemberRow[];
      setMembers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setSummary(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, range.start, range.end]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isReportOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsReportOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReportOpen]);

  const handlePrintReport = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }, []);

  const filteredMembers =
    memberIds.length === 0 ? members : members.filter((m) => memberIds.includes(m.user_id));
  const activeCount = filteredMembers.filter((m) => m.sessions_count > 0).length;
  const inactiveCount = filteredMembers.length - activeCount;
  const leaderboard = [...filteredMembers].sort((a, b) => {
    if (b.doors_knocked !== a.doors_knocked) return b.doors_knocked - a.doors_knocked;
    if ((b.followups ?? 0) !== (a.followups ?? 0)) return (b.followups ?? 0) - (a.followups ?? 0);
    return b.conversations - a.conversations;
  });

  const totals = summary?.totals ?? {
    doors: 0,
    convos: 0,
    flyers: 0,
    followups: 0,
    appointments: 0,
    sessions_count: 0,
    total_duration_seconds: 0,
  };
  const deltas = summary?.deltas ?? {
    doors: 0,
    convos: 0,
    flyers: 0,
    followups: 0,
    appointments: 0,
    sessions_count: 0,
    total_duration_seconds: 0,
  };
  const doorsByDay = summary?.trend?.doorsByDay ?? [];
  const convosPerDoorPct = totals.doors > 0 ? Math.round((totals.convos / totals.doors) * 100) : 0;
  const flyersDelivered = totals.flyers ?? 0;
  const deltaFlyers = deltas.flyers ?? 0;
  const leads = totals.followups ?? 0;
  const deltaLeads = deltas.followups ?? 0;
  const totalDurationSec = totals.total_duration_seconds ?? 0;
  const deltaDurationSec = deltas.total_duration_seconds ?? 0;
  const reportPeriodLabel =
    range.preset === 'weekly'
      ? 'Weekly'
      : range.preset === 'monthly'
      ? 'Monthly'
      : range.preset === 'yearly'
      ? 'Yearly'
      : 'Custom';
  const reportDateRange = summary?.period
    ? `${new Date(summary.period.start).toLocaleDateString()} - ${new Date(summary.period.end).toLocaleDateString()}`
    : `${new Date(range.start).toLocaleDateString()} - ${new Date(range.end).toLocaleDateString()}`;
  const generatedAtLabel = new Date().toLocaleString();

  if (loading && !summary && members.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <div className={cn('space-y-6', isReportOpen && 'print:hidden')}>
        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <Send className="h-4 w-4" />
                Flyers
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-semibold">{flyersDelivered}</p>
              <p className={`text-xs ${deltaFlyers >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {deltaFlyers >= 0 ? '+' : ''}
                {deltaFlyers} vs previous period
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <DoorOpen className="h-4 w-4" />
                Doors knocked
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-semibold">{totals.doors}</p>
              <p className={`text-xs ${deltas.doors >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {deltas.doors >= 0 ? '+' : ''}
                {deltas.doors} vs previous period
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <MessageSquare className="h-4 w-4" />
                Conversations
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-semibold">{totals.convos}</p>
              <p className="text-xs text-muted-foreground">{convosPerDoorPct}% of doors</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <UserPlus className="h-4 w-4" />
                Leads
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-semibold">{leads}</p>
              <p className={`text-xs ${deltaLeads >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {deltaLeads >= 0 ? '+' : ''}
                {deltaLeads} vs previous period
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <CalendarCheck className="h-4 w-4" />
                Appointments
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-2xl font-semibold">{totals.appointments}</p>
              <p className={`text-xs ${deltas.appointments >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {deltas.appointments >= 0 ? '+' : ''}
                {deltas.appointments} vs previous period
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="mb-2 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Team time this week
              </p>
              <p className="text-2xl font-semibold">{formatDuration(totalDurationSec)}</p>
              <p className={`text-xs ${deltaDurationSec >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {formatDurationDelta(deltaDurationSec)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                <Trophy className="h-4 w-4" />
                Leaderboard
              </p>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">Member</th>
                        <th className="py-2 text-right font-medium">Doors</th>
                        <th className="py-2 text-right font-medium">Convos</th>
                        <th className="py-2 text-right font-medium">Sessions</th>
                        <th className="py-2 text-right font-medium">Active days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.slice(0, 10).map((r, i) => (
                        <tr
                          key={r.user_id}
                          className={`border-b border-border/50 ${onMemberClick ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                          onClick={() =>
                            onMemberClick?.({
                              user_id: r.user_id,
                              display_name: r.display_name,
                              color: r.color,
                            })
                          }
                          role={onMemberClick ? 'button' : undefined}
                        >
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: r.color }}
                                aria-hidden
                              />
                              <span className="font-medium">{`#${i + 1} ${r.display_name}`}</span>
                            </div>
                          </td>
                          <td className="py-2 text-right">{r.doors_knocked}</td>
                          <td className="py-2 text-right">{r.conversations}</td>
                          <td className="py-2 text-right">{r.sessions_count}</td>
                          <td className="py-2 text-right">{r.active_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {doorsByDay.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-center text-base">Doors per day</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {doorsByDay.map((row) => (
                  <div key={row.date ?? 'unknown'} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">
                      {row.date
                        ? new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : '-'}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full min-w-[2px] rounded bg-primary/70"
                        style={{
                          width: `${Math.min(
                            100,
                            (row.doors / Math.max(1, ...doorsByDay.map((d) => d.doors))) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="w-10 text-right font-medium">{row.doors}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-center pt-2">
          <Button onClick={() => setIsReportOpen(true)} className="gap-2">
            <FileText className="h-4 w-4" />
            Team performance report
          </Button>
        </div>
      </div>

      {isReportOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm print:static print:bg-transparent print:backdrop-blur-none"
          onClick={() => setIsReportOpen(false)}
          aria-hidden
        >
          <div className="flex min-h-full items-center justify-center p-4 print:block print:min-h-0 print:p-0">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Team performance report"
              className="relative w-full max-w-5xl rounded-xl border border-border bg-background shadow-2xl print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-black print:shadow-none"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-border px-6 py-4 print:border-slate-300 print:px-4 print:py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">Team Performance Report</h2>
                    <p className="text-sm text-muted-foreground print:text-slate-600">
                      {reportPeriodLabel} • {reportDateRange}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground print:text-slate-600">
                      Generated {generatedAtLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 print:hidden">
                    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handlePrintReport}>
                      <Printer className="h-4 w-4" />
                      Print
                    </Button>
                    <button
                      type="button"
                      onClick={() => setIsReportOpen(false)}
                      className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted"
                      aria-label="Close report"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-6 p-6 print:space-y-4 print:p-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Doors knocked</p>
                    <p className="text-xl font-semibold">{totals.doors}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {deltas.doors >= 0 ? '+' : ''}
                      {deltas.doors} vs previous
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Flyers delivered</p>
                    <p className="text-xl font-semibold">{flyersDelivered}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {deltaFlyers >= 0 ? '+' : ''}
                      {deltaFlyers} vs previous
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Conversations</p>
                    <p className="text-xl font-semibold">{totals.convos}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">{convosPerDoorPct}% of doors</p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Sessions</p>
                    <p className="text-xl font-semibold">{totals.sessions_count}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {deltas.sessions_count >= 0 ? '+' : ''}
                      {deltas.sessions_count} vs previous
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Leads</p>
                    <p className="text-xl font-semibold">{leads}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {deltaLeads >= 0 ? '+' : ''}
                      {deltaLeads} vs previous
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Appointments</p>
                    <p className="text-xl font-semibold">{totals.appointments}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {deltas.appointments >= 0 ? '+' : ''}
                      {deltas.appointments} vs previous
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Time spent</p>
                    <p className="text-xl font-semibold">{formatDuration(totalDurationSec)}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">
                      {formatDurationDelta(deltaDurationSec)}
                    </p>
                  </div>
                  <div className="rounded-md border border-border p-3 print:border-slate-300">
                    <p className="text-xs text-muted-foreground print:text-slate-600">Active members</p>
                    <p className="text-xl font-semibold">{activeCount}</p>
                    <p className="text-xs text-muted-foreground print:text-slate-600">{inactiveCount} inactive</p>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground print:text-slate-700">Top members</p>
                  {leaderboard.length === 0 ? (
                    <p className="text-sm text-muted-foreground print:text-slate-600">No sessions in this period.</p>
                  ) : (
                    <div className="space-y-1">
                      {leaderboard.slice(0, 5).map((entry, index) => (
                        <div
                          key={entry.user_id}
                          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm print:border-slate-300"
                        >
                          <span className="font-medium">{`#${index + 1} ${entry.display_name}`}</span>
                          <span className="text-muted-foreground print:text-slate-600">
                            {entry.doors_knocked} doors • {entry.conversations} convos • {entry.sessions_count}{' '}
                            sessions
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground print:text-slate-700">
                    Team member performance
                  </p>
                  <TeamMemberPerformanceTable members={filteredMembers} onMemberClick={onMemberClick} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
