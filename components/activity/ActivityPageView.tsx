'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Route, Hand, Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;
const TYPE_FILTERS = [
  { value: '', label: 'All', icon: Activity },
  { value: 'session_completed', label: 'Sessions', icon: Route },
  { value: 'knock', label: 'Knocks', icon: Hand },
] as const;

const EVENT_LABELS: Record<string, string> = {
  session_completed: 'Sessions',
  knock: 'Knocks',
  followup: 'Follow-ups',
  appointment: 'Appointments',
};

type RangePreset = 'week' | 'month' | 'year' | 'all';

function getRangeForPreset(preset: RangePreset): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  if (preset === 'week') {
    start.setDate(start.getDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === 'year') {
    start.setMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    start.setFullYear(start.getFullYear() - 15);
    start.setUTCHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

type ActivityEvent = {
  id: string;
  user_id: string;
  event_type: string;
  event_time: string;
  ref_id: string | null;
  session_id?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  display_name: string | null;
};

function formatDateKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function eventActorLabel(
  event: Pick<ActivityEvent, 'campaign_name' | 'display_name'>,
  options?: { campaignScoped?: boolean }
): string {
  const userName =
    typeof event.display_name === 'string' && event.display_name.trim().length > 0
      ? event.display_name.trim()
      : 'Member';

  if (options?.campaignScoped) {
    return userName;
  }

  const campaignName =
    typeof event.campaign_name === 'string' && event.campaign_name.trim().length > 0
      ? event.campaign_name.trim()
      : null;

  return campaignName ? `${campaignName} • ${userName}` : userName;
}

function formatMetric(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '-';
  return String(value);
}

function formatDuration(seconds: unknown): string {
  const value = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '-';
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function toCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
}

function formatRatePercent(numerator: unknown, denominator: unknown): string {
  const top = toCount(numerator);
  const bottom = toCount(denominator);
  if (bottom <= 0) return '-';
  return `${((top / bottom) * 100).toFixed(1)}%`;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

type ActivityPageViewProps = {
  forcedTypeFilter?: string;
  hideTypeFilters?: boolean;
  defaultRangePreset?: RangePreset;
  emptyMessage?: string;
  /** When set, activity is limited to this campaign and the list omits redundant campaign names. */
  campaignId?: string;
  /** Hides period and “All team members” controls (e.g. campaign activity tab: sessions only, no chrome). */
  hideFilterControls?: boolean;
};

export function ActivityPageView({
  forcedTypeFilter,
  hideTypeFilters = false,
  defaultRangePreset = 'month',
  emptyMessage = 'No activity in this period.',
  campaignId,
  hideFilterControls = false,
}: ActivityPageViewProps = {}) {
  const { currentWorkspaceId } = useWorkspace();
  const [rangePreset, setRangePreset] = useState<RangePreset>(defaultRangePreset);
  const [typeFilter, setTypeFilter] = useState<string>(forcedTypeFilter ?? '');
  const [includeMembers, setIncludeMembers] = useState(() => Boolean(hideFilterControls));
  const [canIncludeMembers, setCanIncludeMembers] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);

  const { start, end } = useMemo(() => getRangeForPreset(rangePreset), [rangePreset]);
  const activeTypeFilter = forcedTypeFilter ?? typeFilter;

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
          start,
          end,
          limit: String(PAGE_SIZE),
          offset: String(off),
        });
        if (activeTypeFilter) params.set('type', activeTypeFilter);
        if (includeMembers) params.set('includeMembers', 'true');
        if (campaignId) params.set('campaignId', campaignId);
        const res = await fetch(`/api/activity?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const list = (data.events ?? []) as ActivityEvent[];
        setEvents((prev) => (append ? [...prev, ...list] : list));
        setTotal(data.total ?? 0);
        setOffset(off);
        if (data.canIncludeMembers !== undefined) {
          setCanIncludeMembers(data.canIncludeMembers);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load activity');
        if (!append) setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [currentWorkspaceId, start, end, activeTypeFilter, includeMembers, campaignId]
  );

  useEffect(() => {
    setRangePreset(defaultRangePreset);
  }, [defaultRangePreset]);

  useEffect(() => {
    setTypeFilter(forcedTypeFilter ?? '');
  }, [forcedTypeFilter]);

  useEffect(() => {
    fetchActivity(0, false);
  }, [fetchActivity]);

  const groupedByDate = events.reduce<Record<string, ActivityEvent[]>>((acc, ev) => {
    const key = ev.event_time.slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});
  const sortAscending = activeTypeFilter === 'followup';
  const sortedDates = Object.keys(groupedByDate).sort((a, b) =>
    sortAscending ? a.localeCompare(b) : b.localeCompare(a)
  );
  const hasMore = offset + events.length < total;
  const loadMore = () => fetchActivity(offset + PAGE_SIZE, true);

  return (
    <div className="space-y-4">
      {!hideFilterControls && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Period:</span>
          {(['week', 'month', 'year'] as const).map((preset) => (
            <Button
              key={preset}
              variant={rangePreset === preset ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRangePreset(preset)}
            >
              {preset === 'week' ? 'Week' : preset === 'month' ? 'Month' : 'Year'}
            </Button>
          ))}
          {canIncludeMembers && (
            <>
              <span className="text-sm text-muted-foreground ml-2">|</span>
              <Button
                variant={includeMembers ? 'default' : 'outline'}
                size="sm"
                onClick={() => setIncludeMembers((v) => !v)}
              >
                All team members
              </Button>
            </>
          )}
        </div>
      )}
      {!hideTypeFilters && !forcedTypeFilter && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Type:</span>
          {TYPE_FILTERS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value || 'all'}
              variant={typeFilter === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTypeFilter(value)}
            >
              <Icon className="w-3.5 h-3.5 mr-1" />
              {label}
            </Button>
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="rounded-xl border border-border bg-card divide-y divide-border min-h-[300px]">
        {loading && events.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Loading activity…</div>
        ) : sortedDates.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">{emptyMessage}</div>
        ) : (
          sortedDates.map((dateKey) => (
            <div key={dateKey}>
              <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border">
                {formatDateKey(dateKey + 'T12:00:00Z')}
              </div>
              <ul className="divide-y divide-border/50">
                {(groupedByDate[dateKey] ?? []).map((ev) => (
                  <li key={ev.id} className="px-4 py-3 text-sm">
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(ev)}
                      className={cn(
                        'w-full text-left flex items-start gap-3 rounded-md px-1 py-1 -mx-1 -my-1 transition-colors',
                        'cursor-pointer hover:bg-muted/40'
                      )}
                    >
                      <span className="text-muted-foreground shrink-0">{formatTime(ev.event_time)}</span>
                      <span className="font-medium min-w-0 truncate">
                        {eventActorLabel(ev, { campaignScoped: !!campaignId })}
                      </span>
                      <span
                        className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', 'bg-primary/10 text-primary')}
                      >
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
                      <span className="ml-auto text-muted-foreground/70 shrink-0">
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </button>
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

      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedEvent ? `${eventLabel(selectedEvent.event_type)} details` : 'Activity details'}</DialogTitle>
            <DialogDescription>
              {selectedEvent ? eventActorLabel(selectedEvent, { campaignScoped: !!campaignId }) : 'Member'} at{' '}
              {selectedEvent ? new Date(selectedEvent.event_time).toLocaleString() : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {selectedEvent.event_type === 'session_completed' && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Doors</div>
                    <div className="font-medium">
                      {formatMetric(selectedEvent.payload.doors_hit ?? selectedEvent.payload.doors_knocked)}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Conversations</div>
                    <div className="font-medium">{formatMetric(selectedEvent.payload.conversations)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Leads</div>
                    <div className="font-medium">
                      {formatMetric(firstDefined(selectedEvent.payload.leads_created, selectedEvent.payload.leads))}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Flyers Delivered</div>
                    <div className="font-medium">{formatMetric(selectedEvent.payload.flyers_delivered)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Active Time</div>
                    <div className="font-medium">{formatDuration(selectedEvent.payload.active_seconds)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Conversation Rate</div>
                    <div className="font-medium">
                      {formatRatePercent(
                        selectedEvent.payload.conversations,
                        selectedEvent.payload.doors_hit ?? selectedEvent.payload.doors_knocked
                      )}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-muted-foreground text-xs">Lead Rate</div>
                    <div className="font-medium">
                      {formatRatePercent(
                        firstDefined(selectedEvent.payload.leads_created, selectedEvent.payload.leads),
                        selectedEvent.payload.conversations
                      )}
                    </div>
                  </div>
                  <div className="rounded border p-2 col-span-2">
                    <div className="text-muted-foreground text-xs">Distance (meters)</div>
                    <div className="font-medium">{formatMetric(selectedEvent.payload.distance_meters)}</div>
                  </div>
                </div>
              )}

              <div className="rounded border p-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  {selectedEvent.campaign_name && (
                    <>
                      <div className="text-muted-foreground">Campaign</div>
                      <div className="font-medium">{selectedEvent.campaign_name}</div>
                    </>
                  )}
                  <div className="text-muted-foreground">User</div>
                  <div className="font-medium">{selectedEvent.display_name ?? 'Member'}</div>
                  <div className="text-muted-foreground">Event type</div>
                  <div className="font-medium">{eventLabel(selectedEvent.event_type)}</div>
                  <div className="text-muted-foreground">Event time</div>
                  <div className="font-medium">{new Date(selectedEvent.event_time).toLocaleString()}</div>
                  <div className="text-muted-foreground">Created at</div>
                  <div className="font-medium">{new Date(selectedEvent.created_at).toLocaleString()}</div>
                  <div className="text-muted-foreground">Event ID</div>
                  <div className="font-medium break-all">{selectedEvent.id}</div>
                </div>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
