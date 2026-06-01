'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SessionBreadcrumbMap } from '@/components/home/team/SessionBreadcrumbMap';
import { Route, Hand, MessageSquare, Calendar, Activity, DoorOpen, Clock3, MapPinned, Users } from 'lucide-react';
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

type SessionDetail = {
  id: string;
  user_id: string | null;
  display_name: string;
  campaign_id: string | null;
  campaign_name: string;
  start_time: string | null;
  end_time: string | null;
  active_seconds: number;
  distance_meters: number;
  doors_hit: number;
  conversations: number;
  flyers_delivered: number;
  leads_created: number;
  conversations_per_door: number;
  leads_per_conversation: number;
  path_geojson: string | GeoJSON.LineString | null;
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

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value * 100)}%`;
}

export function TeamActivityTab({ range, memberIds }: TeamActivityTabProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

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

  const openSession = useCallback(async (sessionId: string | null | undefined) => {
    if (!currentWorkspaceId || !sessionId) return;
    setSelectedSessionId(sessionId);
    setSelectedSession(null);
    setSessionError(null);
    setLoadingSession(true);
    try {
      const params = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        sessionId,
      });
      const res = await fetch(`/api/team/session?${params.toString()}`);
      const data = await res.json().catch(() => null) as { session?: SessionDetail; error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to load session');
      }
      setSelectedSession(data?.session ?? null);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Failed to load session');
    } finally {
      setLoadingSession(false);
    }
  }, [currentWorkspaceId]);

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
                {(groupedByDate[dateKey] ?? []).map((ev) => {
                  const isSession = ev.event_type === 'session_completed';
                  const canOpenSession = isSession && typeof ev.ref_id === 'string' && ev.ref_id.length > 0;
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left text-sm',
                          canOpenSession ? 'cursor-pointer hover:bg-muted/30' : 'cursor-default'
                        )}
                        disabled={!canOpenSession}
                        onClick={() => openSession(ev.ref_id)}
                      >
                        <span className="text-muted-foreground shrink-0">{formatTime(ev.event_time)}</span>
                        <span className="font-medium shrink-0">{ev.display_name ?? 'Member'}</span>
                        <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', 'bg-primary/10 text-primary')}>
                          {eventLabel(ev.event_type)}
                        </span>
                        {ev.payload && Object.keys(ev.payload).length > 0 && (
                          <span className="min-w-0 truncate text-muted-foreground">
                            {typeof ev.payload.summary === 'string'
                              ? ev.payload.summary
                              : ev.payload.doors_knocked != null || ev.payload.doors_hit != null
                                ? `${String(ev.payload.doors_knocked ?? ev.payload.doors_hit)} doors`
                                : ''}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
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

      <Sheet
        open={selectedSessionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSessionId(null);
            setSelectedSession(null);
            setSessionError(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Session activity</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            {loadingSession ? (
              <div className="space-y-3">
                <div className="h-72 animate-pulse rounded-xl bg-muted" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="h-24 animate-pulse rounded-xl bg-muted" />
                  <div className="h-24 animate-pulse rounded-xl bg-muted" />
                  <div className="h-24 animate-pulse rounded-xl bg-muted" />
                  <div className="h-24 animate-pulse rounded-xl bg-muted" />
                </div>
              </div>
            ) : sessionError ? (
              <Card className="border-destructive/50">
                <CardContent className="py-3 text-sm text-destructive">{sessionError}</CardContent>
              </Card>
            ) : selectedSession ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">{selectedSession.display_name}</div>
                    <h3 className="mt-1 text-xl font-semibold text-foreground">{selectedSession.campaign_name}</h3>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {selectedSession.start_time ? formatDateKey(selectedSession.start_time) : 'Unknown date'} at{' '}
                      {selectedSession.start_time ? formatTime(selectedSession.start_time) : 'unknown time'}
                    </div>
                  </div>
                  <Badge variant="outline">{formatDuration(selectedSession.active_seconds)}</Badge>
                </div>

                <SessionBreadcrumbMap pathGeojson={selectedSession.path_geojson} />

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <DoorOpen className="h-4 w-4" />
                      <span>Doors</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{selectedSession.doors_hit}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>Convos</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{selectedSession.conversations}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatPercent(selectedSession.conversations_per_door)} door-to-convo
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPinned className="h-4 w-4" />
                      <span>Distance</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{formatDistance(selectedSession.distance_meters)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock3 className="h-4 w-4" />
                      <span>Field time</span>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{formatDuration(selectedSession.active_seconds)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-sm text-muted-foreground">Flyers delivered</div>
                    <div className="mt-1 text-lg font-semibold">{selectedSession.flyers_delivered}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-sm text-muted-foreground">Leads created</div>
                    <div className="mt-1 text-lg font-semibold">{selectedSession.leads_created}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-sm text-muted-foreground">Lead rate</div>
                    <div className="mt-1 text-lg font-semibold">{formatPercent(selectedSession.leads_per_conversation)}</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                Session details unavailable.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
