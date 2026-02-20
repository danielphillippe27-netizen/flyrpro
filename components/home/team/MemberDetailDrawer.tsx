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
import { DoorOpen, MessageSquare, CalendarCheck, Route, Activity } from 'lucide-react';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

type Member = { user_id: string; display_name: string; color: string };

type MemberDetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null;
  workspaceId: string | null;
  range: TeamControlsRange;
};

type ReportTotals = {
  knocks?: number;
  conversations?: number;
  flyers_delivered?: number;
  sessions_count?: number;
  active_days?: number;
};

type ActivityItem = {
  id: string;
  event_type: string;
  event_time: string;
  display_name: string | null;
};

export function MemberDetailDrawer({
  open,
  onOpenChange,
  member,
  workspaceId,
  range,
}: MemberDetailDrawerProps) {
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [report, setReport] = useState<ReportTotals | null>(null);
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
        const data = await res.json();
        setReport((data.totals ?? null) as ReportTotals | null);
      } else {
        setReport(null);
      }
    } catch {
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, [workspaceId, member?.user_id, period]);

  const fetchActivity = useCallback(async () => {
    if (!workspaceId || !member) return;
    setLoadingActivity(true);
    try {
      const res = await fetch(
        `/api/team/activity?workspaceId=${encodeURIComponent(workspaceId)}&memberId=${encodeURIComponent(member.user_id)}&limit=20&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
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
  }, [workspaceId, member?.user_id, range.start, range.end]);

  useEffect(() => {
    if (open && member) {
      fetchReport();
      fetchActivity();
    }
  }, [open, member, period, fetchReport, fetchActivity]);

  const totals = report ?? {};
  const doors = totals.knocks ?? 0;
  const convos = totals.conversations ?? 0;
  const flyers = totals.flyers_delivered ?? 0;
  const sessions = totals.sessions_count ?? 0;
  const activeDays = totals.active_days ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {member && (
              <>
                <span
                  className="w-3 h-3 rounded-full shrink-0"
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
            <div className="flex gap-2">
              {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
                <Button
                  key={p}
                  variant={period === p ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPeriod(p)}
                >
                  {p === 'weekly' ? 'Weekly' : p === 'monthly' ? 'Monthly' : 'Yearly'}
                </Button>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Quick stats</h3>
              {loadingReport ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <DoorOpen className="w-4 h-4 text-muted-foreground" />
                    <span>{doors} doors</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    <span>{convos} convos</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <Route className="w-4 h-4 text-muted-foreground" />
                    <span>{flyers} flyers</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <CalendarCheck className="w-4 h-4 text-muted-foreground" />
                    <span>{sessions} sessions</span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <CalendarCheck className="w-4 h-4 text-muted-foreground" />
                    <span>{activeDays} active days</span>
                  </div>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Activity className="w-4 h-4" />
                Recent activity
              </h3>
              {loadingActivity ? (
                <Skeleton className="h-32 w-full" />
              ) : activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {activity.map((ev) => (
                    <li key={ev.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {new Date(ev.event_time).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                      <span>{ev.event_type.replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
