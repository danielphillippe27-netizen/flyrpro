'use client';

import { useEffect, useState, useCallback, useId, useMemo, useRef } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { getClientAsync } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Route, Hand, Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SessionFarmLink } from '@/components/activity/SessionFarmLink';
import { ActivityRouteMap, SessionRouteDialog } from '@/components/activity/SessionRouteDialog';
import { getSessionCounts, parseSessionRoute, SESSION_METRICS, type SessionMetric } from '@/lib/activity-session';

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
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setFullYear(start.getFullYear() - 15);
    start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function getRangePresetLabel(preset: Exclude<RangePreset, 'all'>, now = new Date()): string {
  if (preset === 'week') return 'Week';
  if (preset === 'month') {
    return now.toLocaleDateString(undefined, { month: 'long' });
  }
  return String(now.getFullYear());
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

type ActivityMemberOption = {
  user_id: string;
  display_name: string;
};

type ActivityResponse = {
  events?: ActivityEvent[];
  total?: number;
  canIncludeMembers?: boolean;
  members?: ActivityMemberOption[];
};

type SessionPathGeojson = string | GeoJSON.LineString | null;

type TeamActivityFilters = {
  start: string;
  end: string;
  memberIds: readonly string[];
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

function getSessionPathGeojson(event: ActivityEvent): SessionPathGeojson {
  const raw = event.payload.path_geojson;
  if (typeof raw === 'string') return raw;
  if (
    raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    raw.type === 'LineString' &&
    'coordinates' in raw &&
    Array.isArray(raw.coordinates)
  ) {
    return raw as GeoJSON.LineString;
  }
  return null;
}

type ActivityPageViewProps = {
  forcedTypeFilter?: string;
  hideTypeFilters?: boolean;
  defaultRangePreset?: RangePreset;
  emptyMessage?: string;
  sessionRouteFeed?: boolean;
  /** When set, activity is limited to this campaign and the list omits redundant campaign names. */
  campaignId?: string;
  /** Hides period and member controls (e.g. campaign activity tab: sessions only, no chrome). */
  hideFilterControls?: boolean;
  teamFilters?: TeamActivityFilters;
};

export function SessionActivityFeed({ teamFilters }: { teamFilters?: TeamActivityFilters } = {}) {
  return (
    <ActivityPageView
      forcedTypeFilter="session_completed"
      sessionRouteFeed
      hideFilterControls={!!teamFilters}
      emptyMessage="No sessions in this period."
      teamFilters={teamFilters}
    />
  );
}

export function ActivityPageView({
  forcedTypeFilter,
  hideTypeFilters = false,
  defaultRangePreset = 'month',
  emptyMessage = 'No activity in this period.',
  campaignId,
  hideFilterControls = false,
  sessionRouteFeed = false,
  teamFilters,
}: ActivityPageViewProps = {}) {
  const { currentWorkspaceId } = useWorkspace();
  const [rangePreset, setRangePreset] = useState<RangePreset>(defaultRangePreset);
  const [typeFilter, setTypeFilter] = useState<string>(forcedTypeFilter ?? '');
  const [canIncludeMembers, setCanIncludeMembers] = useState(false);
  const [teamMembers, setTeamMembers] = useState<ActivityMemberOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionMetric, setSessionMetric] = useState<SessionMetric | 'all'>('all');
  const [selectedRoute, setSelectedRoute] = useState<{ event: ActivityEvent; path: GeoJSON.LineString | null } | null>(null);
  const routeTriggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);

  const presetRange = useMemo(() => getRangeForPreset(rangePreset), [rangePreset]);
  const { start, end } = teamFilters ?? presetRange;
  const teamMemberIds = teamFilters?.memberIds;
  const rangePresetLabels = useMemo(() => {
    const now = new Date();
    return {
      week: getRangePresetLabel('week', now),
      month: getRangePresetLabel('month', now),
      year: getRangePresetLabel('year', now),
    };
  }, []);
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
      requestRef.current?.abort();
      const request = new AbortController();
      requestRef.current = request;
      if (!append) {
        setEvents([]);
        setTotal(0);
        setOffset(0);
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
        if (sessionRouteFeed && sessionMetric !== 'all') params.set('sessionMetric', sessionMetric);
        if (teamMemberIds?.length) {
          for (const memberId of teamMemberIds) params.append('memberIds', memberId);
        } else if (hideFilterControls || selectedMemberId === 'all') {
          params.set('includeMembers', 'true');
        } else {
          params.set('memberId', selectedMemberId);
        }
        if (campaignId) params.set('campaignId', campaignId);
        const sessionResult = await getClientAsync()
          .then((supabase) => supabase.auth.getSession())
          .catch(() => null);
        const accessToken = sessionResult?.data.session?.access_token ?? null;
        const res = await fetch(`/api/activity?${params.toString()}`, {
          credentials: 'include',
          signal: request.signal,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
          throw new Error(payload?.error || payload?.message || `Failed to load activity (${res.status})`);
        }
        const data = (await res.json()) as ActivityResponse;
        if (request.signal.aborted) return;
        const list = (data.events ?? []) as ActivityEvent[];
        setEvents((prev) => (append ? [...prev, ...list] : list));
        setTotal(data.total ?? 0);
        setOffset(off);
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
      } catch (e) {
        if (request.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Failed to load activity');
        if (!append) setEvents([]);
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    },
    [currentWorkspaceId, start, end, activeTypeFilter, hideFilterControls, selectedMemberId, campaignId, sessionRouteFeed, sessionMetric, teamMemberIds]
  );

  useEffect(() => {
    setRangePreset(defaultRangePreset);
  }, [defaultRangePreset]);

  useEffect(() => {
    setTypeFilter(forcedTypeFilter ?? '');
  }, [forcedTypeFilter]);

  useEffect(() => {
    void fetchActivity(0, false);
    return () => requestRef.current?.abort();
  }, [fetchActivity]);

  useEffect(() => {
    if (selectedMemberId === 'all') return;
    if (teamMembers.some((member) => member.user_id === selectedMemberId)) return;
    setSelectedMemberId('all');
  }, [teamMembers, selectedMemberId]);

  const groupedByDate = events.reduce<Record<string, ActivityEvent[]>>((acc, ev) => {
    let key = ev.event_time.slice(0, 10);
    if (sessionRouteFeed) {
      const date = new Date(ev.event_time);
      if (Number.isFinite(date.getTime())) {
        date.setHours(12, 0, 0, 0);
        key = date.toISOString();
      }
    }
    if (!acc[key]) acc[key] = [];
    acc[key].push(ev);
    return acc;
  }, {});
  const sortAscending = activeTypeFilter === 'followup';
  const sortedDates = Object.keys(groupedByDate).sort((a, b) =>
    sortAscending ? a.localeCompare(b) : b.localeCompare(a)
  );
  const hasMore = events.length < total;
  const loadMore = () => fetchActivity(offset + PAGE_SIZE, true);

  const routePayload = selectedRoute?.event.payload;
  const routeCounts = routePayload ? getSessionCounts(routePayload) : null;
  const routeMetrics = routeCounts && routePayload ? [
    ...SESSION_METRICS.filter(({ id }) => id !== 'flyers' ||
      (routePayload.session_mode ?? routePayload.mode) === 'flyer' || toCount(routeCounts.flyers) > 0)
      .map(({ id, label }) => ({ label, value: formatMetric(routeCounts[id]) })),
    { label: 'Active time', value: formatDuration(routePayload.active_seconds) },
    { label: 'Distance', value: routePayload.distance_meters != null ? `${formatMetric(routePayload.distance_meters)} m` : '—' },
    { label: 'Conversation rate', value: formatRatePercent(routeCounts.conversations, routeCounts.doors) },
    { label: 'Lead rate', value: formatRatePercent(routeCounts.leads, routeCounts.conversations) },
  ] : [];

  return (
    <div className="space-y-4">
      {(!hideFilterControls || sessionRouteFeed) && (
        <div className="flex flex-wrap items-center gap-3">
          {!hideFilterControls && (
            <>
              <span className="text-sm text-muted-foreground">Period:</span>
              {(['week', 'month', 'year'] as const).map((preset) => (
                <Button
                  key={preset}
                  variant={rangePreset === preset ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRangePreset(preset)}
                >
                  {rangePresetLabels[preset]}
                </Button>
              ))}
              {canIncludeMembers && (
                <>
                  <span className="text-sm text-muted-foreground ml-2">|</span>
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
              )}
            </>
          )}
          {sessionRouteFeed && (
            <Select value={sessionMetric} onValueChange={(value) => setSessionMetric(value as SessionMetric | 'all')}>
              <SelectTrigger size="sm" aria-label="Session outcomes" className="min-w-36 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                {SESSION_METRICS.map(({ id, label }) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
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
          <div className="p-8 text-center text-muted-foreground">{sessionRouteFeed && sessionMetric !== 'all' ? 'No sessions match these filters.' : emptyMessage}</div>
        ) : (
          sortedDates.map((dateKey) => (
            <div key={dateKey} className="group">
              <div className={cn(
                'border-b border-border bg-muted/80 px-4 py-2 text-xs font-medium text-muted-foreground',
                sessionRouteFeed ? 'group-first:rounded-t-xl' : 'sticky top-0 z-10 backdrop-blur'
              )}>
                {formatDateKey(sessionRouteFeed ? dateKey : dateKey + 'T12:00:00Z')}
              </div>
              <ul className="divide-y divide-border/50">
                {(groupedByDate[dateKey] ?? []).map((ev) => sessionRouteFeed ? (
                  <SessionFeedRow
                    key={ev.id}
                    event={ev}
                    onOpen={(path, trigger) => {
                      routeTriggerRef.current = trigger;
                      setSelectedRoute({ event: ev, path });
                    }}
                  />
                ) : (
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

      {sessionRouteFeed && (
        <SessionRouteDialog
          session={selectedRoute ? {
            path: selectedRoute.path,
            id: selectedRoute.event.session_id ?? selectedRoute.event.id,
            title: eventActorLabel(selectedRoute.event),
            time: new Date(selectedRoute.event.event_time).toLocaleString(),
            campaignId: selectedRoute.event.campaign_id ??
              (typeof routePayload?.campaign_id === 'string' ? routePayload.campaign_id : null),
            metrics: routeMetrics,
          } : null}
          onClose={() => setSelectedRoute(null)}
          returnFocus={() => routeTriggerRef.current?.focus()}
        />
      )}

      {!sessionRouteFeed && <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
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
                <>
                  <ActivityRouteMap pathGeojson={getSessionPathGeojson(selectedEvent)} />

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
                    {(selectedEvent.payload.session_mode ?? selectedEvent.payload.mode) === 'flyer' && (
                      <div className="rounded border p-2">
                        <div className="text-muted-foreground text-xs">Flyers Delivered</div>
                        <div className="font-medium">{formatMetric(selectedEvent.payload.flyers_delivered)}</div>
                      </div>
                    )}
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
                </>
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

              {selectedEvent.event_type === 'session_completed' && (
                <SessionFarmLink campaignId={selectedEvent.campaign_id ?? (typeof selectedEvent.payload.campaign_id === 'string' ? selectedEvent.payload.campaign_id : null)} />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>}
    </div>
  );
}


function SessionFeedRow({
  event,
  onOpen,
}: {
  event: ActivityEvent;
  onOpen: (path: GeoJSON.LineString | null, trigger: HTMLButtonElement) => void;
}) {
  const path = useMemo(() => parseSessionRoute(event.payload.path_geojson), [event.payload.path_geojson]);
  const counts = getSessionCounts(event.payload);
  const metricsId = useId();
  const title = eventActorLabel(event);
  const rowClass = 'grid w-full gap-x-5 gap-y-2 px-4 py-3 text-left sm:px-5 lg:grid-cols-[minmax(14rem,1.5fr)_minmax(19rem,2fr)_8rem] lg:items-center';
  const content = (
    <>
      <span className="block min-w-0">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <time dateTime={event.event_time} className="text-xs text-muted-foreground">{formatTime(event.event_time)}</time>
      </span>
      <span id={metricsId} className="grid grid-cols-4 gap-2">
        {SESSION_METRICS.map(({ id, label }) => (
          <span key={id}>
            <span className="block text-[11px] text-muted-foreground sm:text-xs">{id === 'flyers' ? 'Flyers' : label}</span>
            <span className="block text-sm font-medium tabular-nums">{counts[id] == null ? '—' : formatMetric(counts[id])}</span>
          </span>
        ))}
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium lg:justify-self-end">
        {path ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-primary">
            <Route className="size-3.5" aria-hidden="true" /> GPS route <ChevronRight className="size-3" aria-hidden="true" />
          </span>
        ) : <span className="text-muted-foreground">View details</span>}
      </span>
    </>
  );

  return (
    <li>
        <button
          type="button"
          aria-label={`View session for ${title} at ${formatTime(event.event_time)}`}
          aria-describedby={metricsId}
          aria-haspopup="dialog"
          onClick={(e) => onOpen(path, e.currentTarget)}
          className={cn(rowClass, 'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring')}
        >
          {content}
        </button>

    </li>
  );
}
