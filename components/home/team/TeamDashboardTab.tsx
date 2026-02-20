'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DoorOpen, MessageSquare, CalendarCheck, Users, Trophy, Map, Target, Clock, UserCircle } from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type Summary = {
  period: { start: string; end: string };
  totals: { doors: number; convos: number; flyers?: number; followups: number; appointments: number; sessions_count: number; total_duration_seconds?: number };
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
  sessions_count: number;
  active_days: number;
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
  return deltaSeconds > 0 ? `+${formatted} vs last period` : `−${formatted} vs last period`;
}

type TeamDashboardTabProps = {
  range: TeamControlsRange;
  memberIds: string[];
  onMemberClick?: (member: { user_id: string; display_name: string; color: string }) => void;
  onOpenMap?: () => void;
};

export function TeamDashboardTab({ range, memberIds, onMemberClick, onOpenMap }: TeamDashboardTabProps) {
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

  const filteredMembers =
    memberIds.length === 0 ? members : members.filter((m) => memberIds.includes(m.user_id));
  const activeCount = filteredMembers.filter((m) => m.sessions_count > 0).length;
  const inactiveCount = filteredMembers.length - activeCount;
  const leaderboard = [...filteredMembers].sort((a, b) => b.doors_knocked - a.doors_knocked);

  const totals = summary?.totals ?? { doors: 0, convos: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 };
  const deltas = summary?.deltas ?? { doors: 0, convos: 0, flyers: 0, followups: 0, appointments: 0, sessions_count: 0, total_duration_seconds: 0 };
  const doorsByDay = summary?.trend?.doorsByDay ?? [];
  const convosPerDoorPct = totals.doors > 0 ? Math.round((totals.convos / totals.doors) * 100) : 0;
  const flyersDelivered = totals.flyers ?? 0;
  const deltaFlyers = deltas.flyers ?? 0;
  const totalDurationSec = totals.total_duration_seconds ?? 0;
  const deltaDurationSec = deltas.total_duration_seconds ?? 0;

  if (loading && !summary && members.length === 0) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Team activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{activeCount} active · {inactiveCount} inactive</p>
            <p className="text-xs text-muted-foreground">of {filteredMembers.length} members this period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <UserCircle className="w-4 h-4" />
              Flyers delivered
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{flyersDelivered}</p>
            <p className={`text-xs ${deltaFlyers >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {deltaFlyers >= 0 ? '+' : ''}{deltaFlyers} vs previous period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DoorOpen className="w-4 h-4" />
              Doors knocked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totals.doors}</p>
            <p className={`text-xs ${deltas.doors >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {deltas.doors >= 0 ? '+' : ''}{deltas.doors} vs previous period
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Convos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totals.convos}</p>
            <p className="text-xs text-muted-foreground">{convosPerDoorPct}% of doors</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CalendarCheck className="w-4 h-4" />
              Appointments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totals.appointments}</p>
            <p className={`text-xs ${deltas.appointments >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {deltas.appointments >= 0 ? '+' : ''}{deltas.appointments} vs previous period
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Team time this week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatDuration(totalDurationSec)}</p>
            <p className={`text-xs ${deltaDurationSec >= 0 ? 'text-muted-foreground' : 'text-destructive'}`}>
              {formatDurationDelta(deltaDurationSec)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 font-medium">Member</th>
                      <th className="text-right py-2 font-medium">Doors</th>
                      <th className="text-right py-2 font-medium">Convos</th>
                      <th className="text-right py-2 font-medium">Sessions</th>
                      <th className="text-right py-2 font-medium">Active days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 10).map((r, i) => (
                      <tr
                        key={r.user_id}
                        className={`border-b border-border/50 ${onMemberClick ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                        onClick={() => onMemberClick?.({ user_id: r.user_id, display_name: r.display_name, color: r.color })}
                        role={onMemberClick ? 'button' : undefined}
                      >
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="shrink-0 w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: r.color }}
                              aria-hidden
                            />
                            <span className="font-medium">#{i + 1} {r.display_name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2">{r.doors_knocked}</td>
                        <td className="text-right py-2">{r.conversations}</td>
                        <td className="text-right py-2">{r.sessions_count}</td>
                        <td className="text-right py-2">{r.active_days}</td>
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
            <CardTitle className="text-base">Doors per day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {doorsByDay.map((row) => (
                <div key={row.date ?? 'unknown'} className="flex items-center gap-3 text-sm">
                  <span className="w-24 text-muted-foreground shrink-0">
                    {row.date ? new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                  </span>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded min-w-[2px]"
                      style={{
                        width: `${Math.min(100, (row.doors / (Math.max(1, ...doorsByDay.map((d) => d.doors)))) * 100)}%`,
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
              <Map className="w-4 h-4" />
              Coverage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No coverage insights yet. View Map → Knocked homes mode to start.
            </p>
            {onOpenMap && (
              <Button variant="outline" size="sm" onClick={onOpenMap}>
                Open Map
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
              <Target className="w-4 h-4" />
              Team Challenges
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground opacity-60">50 doors this week — Coming soon</p>
            <p className="text-sm text-muted-foreground opacity-60">5 sessions this week — Coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
