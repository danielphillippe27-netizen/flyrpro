'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { Clock, User } from 'lucide-react';

const PAGE_SIZE = 100;
const FETCH_YEAR_SPAN = 15;

type FollowUpBucket = 'today' | 'overdue' | 'future';

type FollowUpEvent = {
  id: string;
  user_id: string;
  event_type: 'followup';
  event_time: string;
  payload: {
    summary?: string;
    contact_name?: string | null;
    address?: string;
    status?: string;
    follow_up_at?: string | null;
    campaign_id?: string;
  };
  display_name: string | null;
  campaign_name?: string | null;
};

type ActivityResponse = {
  events?: FollowUpEvent[];
  total?: number;
  nextOffset?: number | null;
};

const BUCKET_LABELS: Record<FollowUpBucket, string> = {
  today: "Today's Tasks",
  overdue: 'Overdue',
  future: 'Future',
};

function getFetchWindow(): { start: string; end: string } {
  const start = new Date();
  start.setFullYear(start.getFullYear() - FETCH_YEAR_SPAN);
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setFullYear(end.getFullYear() + FETCH_YEAR_SPAN);
  end.setHours(23, 59, 59, 999);

  return { start: start.toISOString(), end: end.toISOString() };
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getBucket(iso: string): FollowUpBucket {
  const due = startOfLocalDay(new Date(iso));
  const today = startOfLocalDay(new Date());
  if (due.getTime() === today.getTime()) return 'today';
  return due.getTime() < today.getTime() ? 'overdue' : 'future';
}

function formatDateHeader(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatDueTime(iso: string): string {
  const date = new Date(iso);
  const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;
  if (isMidnight) return 'All day';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: date.getMinutes() ? '2-digit' : undefined });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function contactName(event: FollowUpEvent): string {
  const payloadName = event.payload.contact_name;
  if (typeof payloadName === 'string' && payloadName.trim()) return payloadName.trim();

  const summary = event.payload.summary;
  if (typeof summary === 'string' && summary.trim()) {
    return summary.split(' • ')[0]?.trim() || 'Follow up';
  }

  return 'Follow up';
}

function taskSummary(event: FollowUpEvent): string {
  const summary = event.payload.summary;
  const name = contactName(event);
  if (typeof summary === 'string' && summary.trim()) {
    const [, ...rest] = summary.split(' • ');
    const detail = rest.join(' • ').trim();
    if (detail) return detail;
  }

  const status = event.payload.status?.replace(/[_-]/g, ' ').trim();
  return status ? `Follow up: ${status}` : `Follow up with ${name}`;
}

export function FollowUpTaskBoard() {
  const { currentWorkspaceId } = useWorkspace();
  const [activeBucket, setActiveBucket] = useState<FollowUpBucket>('today');
  const [events, setEvents] = useState<FollowUpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFollowUps = useCallback(async () => {
    if (!currentWorkspaceId) {
      setEvents([]);
      setError('No workspace selected');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { start, end } = getFetchWindow();
      const loaded: FollowUpEvent[] = [];
      let nextOffset: number | null = 0;

      while (nextOffset !== null) {
        const params = new URLSearchParams({
          workspaceId: currentWorkspaceId,
          type: 'followup',
          includeMembers: 'true',
          start,
          end,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });

        const response = await fetch(`/api/activity?${params.toString()}`);
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as ActivityResponse;

        loaded.push(...(data.events ?? []));

        nextOffset = typeof data.nextOffset === 'number' ? data.nextOffset : null;
      }

      setEvents(loaded);
    } catch (fetchError) {
      setEvents([]);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void fetchFollowUps();
  }, [fetchFollowUps]);

  const counts = useMemo(() => {
    return events.reduce<Record<FollowUpBucket, number>>(
      (acc, event) => {
        acc[getBucket(event.event_time)] += 1;
        return acc;
      },
      { today: 0, overdue: 0, future: 0 }
    );
  }, [events]);

  const activeEvents = useMemo(() => {
    return events
      .filter((event) => getBucket(event.event_time) === activeBucket)
      .sort((left, right) => {
        const leftTime = new Date(left.event_time).getTime();
        const rightTime = new Date(right.event_time).getTime();
        return activeBucket === 'overdue' ? rightTime - leftTime : leftTime - rightTime;
      });
  }, [activeBucket, events]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, FollowUpEvent[]>();
    for (const event of activeEvents) {
      const key = startOfLocalDay(new Date(event.event_time)).toISOString();
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
  }, [activeEvents]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-background dark:text-foreground">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white dark:border-border dark:bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 overflow-x-auto">
            {(['today', 'overdue', 'future'] as const).map((bucket) => (
              <button
                key={bucket}
                type="button"
                onClick={() => setActiveBucket(bucket)}
                className={cn(
                  'relative flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-semibold text-slate-600 transition-colors sm:text-base',
                  'hover:text-slate-950 dark:text-muted-foreground dark:hover:text-foreground',
                  activeBucket === bucket && 'text-slate-950 dark:text-foreground'
                )}
              >
                <span>{BUCKET_LABELS[bucket]}</span>
                {counts[bucket] > 0 && (
                  <span className="text-slate-400 dark:text-muted-foreground">({counts[bucket]})</span>
                )}
                {activeBucket === bucket && (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-border">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-red-500 dark:text-red-400" />
              <h1 className="text-base font-semibold sm:text-lg">{BUCKET_LABELS[activeBucket]}</h1>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void fetchFollowUps()} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <div className="min-h-[320px] divide-y divide-slate-100 dark:divide-border/70">
            {loading && events.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-slate-400">
                <Clock className="h-12 w-12 animate-pulse text-red-500 dark:text-red-400" />
                <p className="text-sm font-medium">Loading follow-ups...</p>
              </div>
            ) : groupedEvents.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-slate-400">
                <Clock className="h-12 w-12 text-red-500 dark:text-red-400" />
                <p className="text-sm font-medium">No tasks found, nice work!</p>
              </div>
            ) : (
              groupedEvents.map((group) => (
                <div key={group.date}>
                  <div className="bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 dark:bg-muted/40 dark:text-foreground">
                    {formatDateHeader(group.date)} ({group.items.length})
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-border/60">
                    {group.items.map((event, index) => {
                      const name = contactName(event);
                      const hue = (name.charCodeAt(0) + index * 23) % 360;

                      return (
                        <li key={event.id} className="grid grid-cols-[32px_48px_1fr_auto] items-center gap-4 px-4 py-4">
                          <span
                            aria-hidden="true"
                            className="block h-6 w-6 rounded-md border border-slate-300 dark:border-border"
                          />
                          <div
                            className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white"
                            style={{
                              backgroundColor: `hsl(${hue}, 40%, 56%)`,
                            }}
                          >
                            {initials(name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-red-600 dark:text-red-400">{name}</div>
                            <div className="mt-0.5 truncate text-sm text-slate-700 dark:text-muted-foreground">
                              {taskSummary(event)}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                              <User className="h-3.5 w-3.5" />
                              <span>{event.display_name ?? 'Me'}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-muted-foreground">
                            <Clock className="h-4 w-4 text-slate-400" />
                            {formatDueTime(event.event_time)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
