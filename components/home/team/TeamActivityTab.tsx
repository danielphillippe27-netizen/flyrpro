'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Route, Hand, MessageSquare, Calendar, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamControlsRange } from '@/components/home/team/TeamControlsBar';

const PAGE_SIZE = 25;
const TYPE_FILTERS = [
  { value: '', label: 'All', icon: Activity },
  { value: 'session_completed', label: 'Sessions', icon: Route },
  { value: 'knock', label: 'Knocks', icon: Hand },
  { value: 'followup', label: 'Follow-ups', icon: MessageSquare },
  { value: 'appointment', label: 'Appointments', icon: Calendar },
] as const;

type ActivityEvent = {
  id: string;
  user_id: string;
  event_type: string;
  event_time: string;
  ref_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  display_name: string | null;
};

type TeamActivityTabProps = {
  range: TeamControlsRange;
  memberIds: string[];
};

function formatDateKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function eventLabel(type: string): string {
  const t = TYPE_FILTERS.find((f) => f.value === type);
  return t?.label ?? type;
}

export function TeamActivityTab({ range, memberIds }: TeamActivityTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivity = useCallback(
    async (off: number, append: boolean) => {
      if (!currentWorkspaceId) {
        if (!append) {
          setEvents([]);
          setTotal(0);
          setOffset(0);
        }
        setError('No workspace selected');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          workspaceId: currentWorkspaceId,
          start: range.start,
          end: range.end,
          limit: String(PAGE_SIZE),
          offset: String(off),
        });
        if (typeFilter) params.set('type', typeFilter);
        if (memberIds.length === 1) params.set('memberId', memberIds[0]);
        const res = await fetch(`/api/team/activity?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        let list = (data.events ?? []) as ActivityEvent[];
        if (memberIds.length > 1) {
          const idSet = new Set(memberIds);
          list = list.filter((e: ActivityEvent) => idSet.has(e.user_id));
        }
        setEvents((prev) => (append ? [...prev, ...list] : list));
        setTotal(data.total ?? 0);
        setOffset(off);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load activity');
        if (!append) setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [currentWorkspaceId, range.start, range.end, typeFilter, memberIds]
  );

  useEffect(() => {
    fetchActivity(0, false);
  }, [fetchActivity]);

  const onFilterChange = (value: string) => {
    setTypeFilter(value);
  };

  const groupedByDate = events.reduce<Record<string, ActivityEvent[]>>((acc, ev) => {
    const key = ev.event_time.slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});
  const sortedDates = Object.keys(groupedByDate).sort().reverse();

  const hasMore = offset + events.length < total;
  const loadMore = () => fetchActivity(offset + PAGE_SIZE, true);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Type:</span>
        {TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
          <Button
            key={value || 'all'}
            variant={typeFilter === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onFilterChange(value)}
          >
            <Icon className="w-3.5 h-3.5 mr-1" />
            {label}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="rounded-xl border border-border bg-card divide-y divide-border min-h-[300px]">
        {loading && events.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Loading activity…</div>
        ) : sortedDates.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No activity in this period.</div>
        ) : (
          sortedDates.map((dateKey) => (
            <div key={dateKey}>
              <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                {formatDateKey(dateKey + 'T12:00:00Z')}
              </div>
              <ul className="divide-y divide-border/50">
                {(groupedByDate[dateKey] ?? []).map((ev) => (
                  <li key={ev.id} className="px-4 py-3 flex items-start gap-3 text-sm">
                    <span className="text-muted-foreground shrink-0">{formatTime(ev.event_time)}</span>
                    <span className="font-medium shrink-0">{ev.display_name ?? 'Member'}</span>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', 'bg-primary/10 text-primary')}>
                      {eventLabel(ev.event_type)}
                    </span>
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <span className="text-muted-foreground truncate">
                        {typeof ev.payload.summary === 'string'
                          ? ev.payload.summary
                          : ev.payload.doors_knocked != null
                            ? `${ev.payload.doors_knocked} doors`
                            : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {hasMore && events.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
