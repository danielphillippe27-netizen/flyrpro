'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWorkspace } from '@/lib/workspace-context';
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
  canIncludeMembers?: boolean;
  members?: ActivityMemberOption[];
};

type ActivityMemberOption = {
  user_id: string;
  display_name: string;
  color?: string | null;
};

const BUCKET_LABELS: Record<FollowUpBucket, string> = {
  today: 'Today',
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
  const [selectedMemberId, setSelectedMemberId] = useState('all');
  const [teamMembers, setTeamMembers] = useState<ActivityMemberOption[]>([]);
  const [canIncludeMembers, setCanIncludeMembers] = useState(false);
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
          start,
          end,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (selectedMemberId === 'all') {
          params.set('includeMembers', 'true');
        } else {
          params.set('memberId', selectedMemberId);
        }

        const response = await fetch(`/api/activity?${params.toString()}`, { credentials: 'include' });
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as ActivityResponse;

        loaded.push(...(data.events ?? []));
        if (data.canIncludeMembers !== undefined) {
          const nextCanIncludeMembers = Boolean(data.canIncludeMembers);
          setCanIncludeMembers(nextCanIncludeMembers);
          if (!nextCanIncludeMembers) {
            setTeamMembers([]);
            setSelectedMemberId('all');
          }
        }
        if (Array.isArray(data.members)) {
          setTeamMembers(data.members);
        }

        nextOffset = typeof data.nextOffset === 'number' ? data.nextOffset : null;
      }

      setEvents(loaded);
    } catch (fetchError) {
      setEvents([]);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, selectedMemberId]);

  useEffect(() => {
    void fetchFollowUps();
  }, [fetchFollowUps]);

  useEffect(() => {
    if (selectedMemberId === 'all') return;
    if (teamMembers.some((member) => member.user_id === selectedMemberId)) return;
    setSelectedMemberId('all');
  }, [selectedMemberId, teamMembers]);

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
    <div className="min-h-screen bg-gray-50 text-slate-900 dark:bg-background dark:text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-foreground">Follow Up</h1>
          <p className="mt-1 text-muted-foreground">All follow-ups across your activity feed</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Period:</span>
          {(['today', 'overdue', 'future'] as const).map((bucket) => (
            <Button
              key={bucket}
              variant={activeBucket === bucket ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveBucket(bucket)}
            >
              {BUCKET_LABELS[bucket]}
              {counts[bucket] > 0 ? ` (${counts[bucket]})` : ''}
            </Button>
          ))}
          {canIncludeMembers ? (
            <>
              <span className="ml-2 text-sm text-muted-foreground">|</span>
              <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                <SelectTrigger size="sm" className="w-[220px]">
                  <SelectValue placeholder="All team members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All team members</SelectItem>
                  {teamMembers.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : null}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <section className="min-h-[300px] divide-y divide-border rounded-xl border border-border bg-card">
          <div className="min-h-[300px] divide-y divide-slate-100 dark:divide-border/70">
            {loading && events.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading follow-ups...
              </div>
            ) : groupedEvents.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No tasks found, nice work!
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
