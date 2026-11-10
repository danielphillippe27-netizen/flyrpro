'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ComponentType } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Clock,
  DoorOpen,
  Gauge,
  MapPin,
  MessageSquare,
  TimerReset,
  Trophy,
  Users,
} from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type Summary = {
  period: { start: string; end: string };
  goals: {
    weekly_door_goal: number | null;
    weekly_sessions_goal: number | null;
    source: 'workspace' | 'member_aggregate';
  };
  totals: {
    doors: number;
    convos: number;
    leads: number;
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
  role?: string;
  color: string;
  last_active_at: string | null;
  inactive_days: number | null;
  doors_knocked: number;
  conversations: number;
  appointments?: number;
  sessions_count: number;
  active_days: number;
  total_duration_seconds?: number;
  weekly_door_goal?: number | null;
  weekly_sessions_goal?: number | null;
  weekly_minutes_goal?: number | null;
  current_rank?: number | null;
  rank_delta?: number | null;
  best_day_doors?: number;
  best_day_date?: string | null;
  is_live?: boolean;
  current_session_started_at?: string | null;
  current_session_duration_seconds?: number;
};

type TeamDashboardTabProps = {
  range: TeamControlsRange;
  memberIds: string[];
  onMemberClick?: (member: { user_id: string; display_name: string; color: string }) => void;
  onViewLiveMap?: () => void;
  onViewActivity?: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SURFACE_CLASS = 'operator-surface rounded-2xl border border-border/70 bg-card shadow-none';

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatDateLabel(date: string | null) {
  if (!date) return 'No best day yet';
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return 'No activity yet';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(ms / (60 * 1000)))}m ago`;
  }
  if (ms < DAY_MS) {
    return `${Math.max(1, Math.floor(ms / (60 * 60 * 1000)))}h ago`;
  }
  const days = Math.floor(ms / DAY_MS);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatRankDelta(delta: number | null | undefined) {
  if (delta == null || delta === 0) {
    return { label: 'No change', tone: 'text-muted-foreground' };
  }
  if (delta > 0) {
    return { label: `+${delta}`, tone: 'text-emerald-600 dark:text-emerald-400' };
  }
  return { label: `${delta}`, tone: 'text-amber-600 dark:text-amber-400' };
}

function getRangeDays(start: string, end: string) {
  const diff = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  return Math.max(1, Math.ceil(diff / DAY_MS));
}

type KpiCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  helper: string;
};

function KpiCard({ icon: Icon, label, value, helper }: KpiCardProps) {
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

export function TeamDashboardTab({ range, memberIds, onMemberClick, onViewLiveMap, onViewActivity }: TeamDashboardTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (memberIds.length > 0) {
        query.set('memberIds', memberIds.join(','));
      }
      const memberQuery = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        start: range.start,
        end: range.end,
      });
      const [summaryRes, membersRes] = await Promise.all([
        fetch('/api/team/summary?' + query.toString()),
        fetch('/api/team/members?' + memberQuery.toString()),
      ]);
      if (!summaryRes.ok) {
        const payload = (await summaryRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load summary');
      }
      if (!membersRes.ok) {
        const payload = (await membersRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Failed to load members');
      }
      setSummary((await summaryRes.json()) as Summary);
      const membersData = (await membersRes.json()) as { members?: MemberRow[] };
      setMembers((membersData.members ?? []) as MemberRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setSummary(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, memberIds, range.end, range.start]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredMembers =
    memberIds.length === 0 ? members : members.filter((member) => memberIds.includes(member.user_id));
  const leaderboard = [...filteredMembers].sort((left, right) => {
    if (right.doors_knocked !== left.doors_knocked) {
      return right.doors_knocked - left.doors_knocked;
    }
    if (right.conversations !== left.conversations) {
      return right.conversations - left.conversations;
    }
    return (right.last_active_at ?? '').localeCompare(left.last_active_at ?? '');
  });

  const liveMembers = leaderboard
    .filter((member) => member.is_live)
    .sort((left, right) => (right.current_session_duration_seconds ?? 0) - (left.current_session_duration_seconds ?? 0));
  const recentMembers = leaderboard
    .filter((member) => !member.is_live && member.last_active_at)
    .sort((left, right) => (right.last_active_at ?? '').localeCompare(left.last_active_at ?? ''));

  const totals = summary?.totals ?? {
    doors: 0,
    convos: 0,
    leads: 0,
    followups: 0,
    appointments: 0,
    sessions_count: 0,
    total_duration_seconds: 0,
  };
  const deltas = summary?.deltas ?? {
    doors: 0,
    convos: 0,
    leads: 0,
    followups: 0,
    appointments: 0,
    sessions_count: 0,
    total_duration_seconds: 0,
  };
  const doorsByDay = summary?.trend?.doorsByDay ?? [];

  const convosPerDoor = totals.doors > 0 ? totals.convos / totals.doors : 0;
  const leadsPerConvo = totals.convos > 0 ? totals.leads / totals.convos : 0;
  const rangeDays = getRangeDays(range.start, range.end);
  const aggregateMemberDoorGoal = filteredMembers.reduce(
    (sum, member) => sum + Math.max(0, member.weekly_door_goal ?? 0),
    0
  );
  const configuredTeamDoorGoal =
    summary?.goals?.weekly_door_goal != null
      ? Math.max(0, summary.goals.weekly_door_goal)
      : null;
  const effectiveDoorGoal = configuredTeamDoorGoal ?? aggregateMemberDoorGoal;
  const scaledDoorGoal = effectiveDoorGoal > 0 ? Math.round((effectiveDoorGoal * rangeDays) / 7) : 0;
  const dailyDoorTarget = effectiveDoorGoal > 0 ? effectiveDoorGoal / 7 : 0;
  const chartMax = Math.max(1, dailyDoorTarget, ...doorsByDay.map((day) => day.doors));
  const targetMarkerPercent = Math.min(100, (dailyDoorTarget / chartMax) * 100);
  const doorsPerSession = totals.sessions_count > 0 ? totals.doors / totals.sessions_count : null;
  const previous = summary?.previousTotals;
  const previousDoorsPerSession = previous && previous.sessions_count > 0
    ? previous.doors / previous.sessions_count
    : null;
  const productivityChange = doorsPerSession != null && previousDoorsPerSession != null
    ? Number((doorsPerSession - previousDoorsPerSession).toFixed(1))
    : null;
  const recordedFieldTime = totals.total_duration_seconds ?? 0;
  const goalProgress = scaledDoorGoal > 0 ? Math.round((totals.doors / scaledDoorGoal) * 100) : null;
  const memberDoorTotal = filteredMembers.reduce((sum, member) => sum + member.doors_knocked, 0);
  const memberConvoTotal = filteredMembers.reduce((sum, member) => sum + member.conversations, 0);
  const alignmentMismatch = totals.doors !== memberDoorTotal || totals.convos !== memberConvoTotal;

  if (loading && !summary && members.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
          <Skeleton className="h-[430px] rounded-2xl" />
          <div className="space-y-6">
            <Skeleton className="h-52 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className={`${SURFACE_CLASS} border-destructive/50`}>
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {alignmentMismatch && (
        <Card className={`${SURFACE_CLASS} border-amber-500/40 bg-amber-500/5`}>
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">
            Attribution mismatch: team totals and rep rows are not aligned yet.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={DoorOpen}
          label="Doors"
          value={totals.doors}
          helper={`${deltas.doors >= 0 ? '+' : ''}${deltas.doors} vs previous period`}
        />
        <KpiCard
          icon={MessageSquare}
          label="Convos"
          value={totals.convos}
          helper={`${formatPercent(convosPerDoor)} door-to-convo`}
        />
        <KpiCard
          icon={Users}
          label="Leads"
          value={totals.leads}
          helper={`${formatPercent(leadsPerConvo)} convo-to-lead`}
        />
        <KpiCard
          icon={CalendarCheck}
          label="Appointments"
          value={totals.appointments}
          helper={`${deltas.appointments >= 0 ? '+' : ''}${deltas.appointments} vs previous period`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
        <Card className={`${SURFACE_CLASS} overflow-hidden`}>
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Trophy className="h-4 w-4 text-primary" />
              <span>Leaderboard</span>
            </div>
            <CardTitle className="text-3xl font-semibold tracking-tight">Who’s setting the pace</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {leaderboard.length === 0 ? (
              <div className="px-6 py-10 text-sm text-muted-foreground">No rep activity in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-6 py-4 text-left font-medium">Rep</th>
                      <th className="px-4 py-4 text-right font-medium">Doors</th>
                      <th className="px-4 py-4 text-right font-medium">Convo rate</th>
                      <th className="px-4 py-4 text-right font-medium">Best day</th>
                      <th className="px-4 py-4 text-right font-medium">Movement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((member, index) => {
                      const rankDelta = formatRankDelta(member.rank_delta);
                      const memberConvoRate = member.doors_knocked > 0 ? member.conversations / member.doors_knocked : 0;
                      return (
                        <tr
                          key={member.user_id}
                          className={`border-b border-border/40 ${onMemberClick ? 'cursor-pointer hover:bg-muted/20' : ''}`}
                          onClick={() => onMemberClick?.({ user_id: member.user_id, display_name: member.display_name, color: member.color })}
                          role={onMemberClick ? 'button' : undefined}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-muted/10 font-semibold text-foreground">
                                #{index + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: member.color }}
                                    aria-hidden
                                  />
                                  <span className="truncate font-medium text-foreground">{member.display_name}</span>
                                  {member.is_live ? <Badge variant="secondary">Live</Badge> : null}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {member.is_live
                                    ? `${formatDuration(member.current_session_duration_seconds ?? 0)} current session`
                                    : `Last active ${formatRelativeTime(member.last_active_at)}`}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right font-semibold text-foreground">{member.doors_knocked}</td>
                          <td className="px-4 py-4 text-right text-foreground">{formatPercent(memberConvoRate)}</td>
                          <td className="px-4 py-4 text-right">
                            <div className="font-medium text-foreground">{member.best_day_doors ?? 0}</div>
                            <div className="text-xs text-muted-foreground">{formatDateLabel(member.best_day_date ?? null)}</div>
                          </td>
                          <td className={`px-4 py-4 text-right font-medium ${rankDelta.tone}`}>{rankDelta.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className={SURFACE_CLASS}>
            <CardHeader className="gap-2 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="size-4 text-primary" aria-hidden="true" />
                  <span>Field activity</span>
                </div>
                {onViewLiveMap && liveMembers.length > 0 && (
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onViewLiveMap}>
                    <MapPin className="size-3.5" aria-hidden="true" />
                    Live map
                  </Button>
                )}
              </div>
              <CardTitle className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {liveMembers.length > 0 && <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />}
                {liveMembers.length > 0
                  ? `${liveMembers.length} ${liveMembers.length === 1 ? 'rep' : 'reps'} in the field`
                  : 'Nobody in the field right now'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {liveMembers.length > 0 && (
                <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-muted/10">
                  {liveMembers.slice(0, 4).map((member) => (
                    <li key={member.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 break-words font-medium">{member.display_name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatDuration(member.current_session_duration_seconds ?? 0)} in field
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {recentMembers.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Last active in this period</p>
                  <ul className="divide-y divide-border/60">
                    {recentMembers.slice(0, liveMembers.length > 0 ? 2 : 3).map((member) => (
                      <li key={member.user_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0 break-words font-medium">{member.display_name}</span>
                        <time dateTime={member.last_active_at ?? undefined} className="shrink-0 text-muted-foreground">
                          {formatRelativeTime(member.last_active_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : liveMembers.length === 0 && (
                <p className="text-sm text-muted-foreground">No sessions logged in the selected period.</p>
              )}

              {onViewActivity && (
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onViewActivity}>
                  View activity <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className={SURFACE_CLASS}>
            <CardHeader className="gap-2 pb-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Gauge className="size-4 text-primary" aria-hidden="true" />
                <span>Selected period</span>
              </div>
              <CardTitle className="text-2xl font-semibold tracking-tight">Field productivity</CardTitle>
            </CardHeader>
            <CardContent>
              {doorsPerSession != null ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-3xl font-semibold tabular-nums tracking-tight">
                        {doorsPerSession.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </span>
                      <span className="text-sm text-muted-foreground">doors per logged session</span>
                    </div>
                    {productivityChange != null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {productivityChange === 0
                          ? 'Unchanged from the previous period'
                          : `${productivityChange > 0 ? '+' : ''}${productivityChange.toLocaleString()} doors per session vs. the previous period`}
                      </p>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 divide-x divide-border/60 rounded-xl border border-border/60">
                    <div className="px-4 py-3">
                      <dt className="text-xs text-muted-foreground">Sessions logged</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">{totals.sessions_count.toLocaleString()}</dd>
                    </div>
                    <div className="px-4 py-3">
                      <dt className="text-xs text-muted-foreground">Recorded field time</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {recordedFieldTime >= 60 ? formatDuration(recordedFieldTime) : recordedFieldTime > 0 ? '<1m' : '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Log a session to see productivity for this period.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {doorsByDay.length > 0 && (
        <Card className={SURFACE_CLASS}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TimerReset className="h-4 w-4 text-primary" />
                  <span>Daily output vs pace</span>
                </div>
                <CardTitle className="mt-1 text-2xl font-semibold tracking-tight">Keep the team on target</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {scaledDoorGoal > 0
                    ? `${totals.doors} of ${scaledDoorGoal} doors toward target.`
                    : 'Set team goals in Settings to unlock target pace.'}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3 text-right">
                <div className="text-xs text-muted-foreground">Pace</div>
                <div className="text-lg font-semibold text-foreground">{Math.round(dailyDoorTarget)} doors/day</div>
                <div className="text-xs text-muted-foreground">
                  {goalProgress != null ? `${goalProgress}% of target` : 'No target yet'}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {doorsByDay.map((row) => (
                <div key={row.date ?? 'unknown'} className="grid grid-cols-[72px_1fr_40px] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {row.date
                      ? new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : '—'}
                  </span>
                  <div className="relative h-6 overflow-hidden rounded-full bg-muted/30">
                    {dailyDoorTarget > 0 ? (
                      <div
                        className="absolute inset-y-0 z-10 w-px bg-primary/90"
                        style={{ left: `calc(${targetMarkerPercent}% - 1px)` }}
                        aria-hidden
                      />
                    ) : null}
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary/75"
                      style={{ width: `${Math.min(100, (row.doors / chartMax) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right font-medium text-foreground">{row.doors}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Thin red marker shows target pace.</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
