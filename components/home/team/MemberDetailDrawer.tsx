'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DoorOpen, MessageSquare, CalendarCheck, Route, Activity, Clock3, MapPinned } from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type Member = { user_id: string; display_name: string; color: string };

type MemberDetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  workspaceId: string | null;
  range: TeamControlsRange;
};

type ReportResponse = {
  totals?: {
    knocks?: number;
    conversations?: number;
    appointments?: number;
    sessions_count?: number;
    active_days?: number;
    avg_knocks_per_session?: number;
    total_duration_seconds?: number;
    conversations_per_door?: number;
    appointments_per_conversation?: number;
  };
  sessions?: Array<{
    id: string;
    start_time: string | null;
    end_time: string | null;
    doors_hit: number;
    conversations: number;
    active_seconds: number;
    campaign_id: string | null;
    campaign_name: string;
  }>;
  topZones?: Array<{
    campaign_id: string | null;
    campaign_name: string;
    doors: number;
    conversations: number;
    sessions_count: number;
    conversation_rate: number;
  }>;
};

type ActivityItem = {
  id: string;
  event_type: string;
  event_time: string;
  display_name: string | null;
};

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatSessionTime(iso: string | null) {
  if (!iso) return 'Unknown';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MemberDetailDrawer({
  open,
  onOpenChange,
  member,
  workspaceId,
  range,
}: MemberDetailDrawerProps) {
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const fetchReport = useCallback(async () => {
    if (!workspaceId || !member) return;
    setLoadingReport(true);
    try {
      const res = await fetch(
        `/api/team/report?workspaceId=${encodeURIComponent(workspaceId)}&userId=${encodeURIComponent(member.user_id)}&period=${period}`
      );
      if (res.ok) {
        const data = (await res.json()) as ReportResponse;
        setReport(data);
      } else {
        setReport(null);
      }
    } catch {
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [workspaceId, member, period]);

  const fetchActivity = useCallback(async () => {
    if (!workspaceId || !member) return;
    setLoadingActivity(true);
    try {
      const res = await fetch(
        `/api/team/activity?workspaceId=${encodeURIComponent(workspaceId)}&memberId=${encodeURIComponent(member.user_id)}&limit=12&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
      );
      if (res.ok) {
        const data = await res.json();
        setActivity((data.items ?? data.events ?? []) as ActivityItem[]);
      } else {
        setActivity([]);
      }
    } catch {
      setActivity([]);
    } finally {
      setLoadingActivity(false);
    }
  }, [workspaceId, member, range.end, range.start]);

  useEffect(() => {
    if (open && member) {
      fetchReport();
      fetchActivity();
    }
  }, [open, member, period, fetchReport, fetchActivity]);

  const totals = report?.totals ?? {};
  const sessions = report?.sessions ?? [];
  const topZones = report?.topZones ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {member && (
              <>
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: member.color }}
                  aria-hidden
                />
                {member.display_name}
              </>
            )}
          </SheetTitle>
        </SheetHeader>
        {!member ? (
          <p className="text-sm text-muted-foreground">Select a member.</p>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap gap-2">
              {(['weekly', 'monthly', 'yearly'] as const).map((value) => (
                <Button
                  key={value}
                  variant={period === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriod(value)}
                >
                  {value === 'weekly' ? 'Weekly' : value === 'monthly' ? 'Monthly' : 'Yearly'}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {loadingReport ? (
                <>
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DoorOpen className="h-4 w-4" />
                      <span>Doors</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{totals.knocks ?? 0}</div>
                    <div className="text-xs text-muted-foreground">{totals.avg_knocks_per_session ?? 0} per session</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MessageSquare className="h-4 w-4" />
                      <span>Convos</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{totals.conversations ?? 0}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatPercent(totals.conversations_per_door ?? 0)} door-to-convo
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarCheck className="h-4 w-4" />
                      <span>Appointments</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{totals.appointments ?? 0}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatPercent(totals.appointments_per_conversation ?? 0)} convo-to-appointment
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock3 className="h-4 w-4" />
                      <span>Field time</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{formatDuration(totals.total_duration_seconds ?? 0)}</div>
                    <div className="text-xs text-muted-foreground">{totals.sessions_count ?? 0} sessions</div>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Route className="h-4 w-4" />
                  <span>Session history</span>
                </div>
                {loadingReport ? (
                  <Skeleton className="h-52 rounded-xl" />
                ) : sessions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    No sessions logged in this period.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessions.map((session) => (
                      <div key={session.id} className="rounded-xl border border-border/60 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{session.campaign_name}</div>
                            <div className="text-xs text-muted-foreground">{formatSessionTime(session.start_time)}</div>
                          </div>
                          <Badge variant="outline">{formatDuration(session.active_seconds)}</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <div className="text-muted-foreground">Doors</div>
                            <div className="font-medium">{session.doors_hit}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Convos</div>
                            <div className="font-medium">{session.conversations}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Rate</div>
                            <div className="font-medium">
                              {formatPercent(session.doors_hit > 0 ? session.conversations / session.doors_hit : 0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <MapPinned className="h-4 w-4" />
                    <span>Best territories</span>
                  </div>
                  {loadingReport ? (
                    <Skeleton className="h-40 rounded-xl" />
                  ) : topZones.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                      No territory data in this period yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {topZones.map((zone) => (
                        <div key={`${zone.campaign_id ?? 'unassigned'}-${zone.campaign_name}`} className="rounded-xl border border-border/60 p-4">
                          <div className="font-medium">{zone.campaign_name}</div>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Convos</span>
                            <span className="font-medium">{zone.conversations}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Doors</span>
                            <span className="font-medium">{zone.doors}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Convo rate</span>
                            <span className="font-medium">{formatPercent(zone.conversation_rate)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    <span>Recent activity</span>
                  </div>
                  {loadingActivity ? (
                    <Skeleton className="h-36 rounded-xl" />
                  ) : activity.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                      No recent activity.
                    </div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {activity.map((event) => (
                        <li key={event.id} className="rounded-xl border border-border/60 p-3">
                          <div className="font-medium">{event.event_type.replace(/_/g, ' ')}</div>
                          <div className="text-xs text-muted-foreground">{formatSessionTime(event.event_time)}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
