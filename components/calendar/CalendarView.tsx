'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addHours, addMonths, addWeeks, addYears, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import {
  CALENDAR_COLOR_HEX,
  CALENDAR_COLOR_KEYS,
  CALENDAR_EVENT_TYPES,
  EVENT_TYPE_META,
  calendarItemFromRow,
  calendarSearchHaystack,
  computeTimedEventLayouts,
  dateKey,
  defaultTitleForEventType,
  itemsForDay,
  itemsForMonth,
  monthGrid,
  monthsInYear,
  resolveTimelineSlot,
  visibleRange,
} from '@/lib/calendar/helpers';
import type {
  CalendarColorKey,
  CalendarContactOption,
  CalendarEventRow,
  CalendarEventType,
  CalendarItem,
} from '@/lib/calendar/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type CalendarLevel = 'year' | 'month' | 'week';
type DayDisplayMode = 'week';

type EventsResponse = {
  events?: CalendarEventRow[];
  total?: number;
  nextOffset?: number | null;
  canIncludeMembers?: boolean;
};

type TeamMemberOption = {
  user_id: string;
  display_name: string;
  role?: string | null;
  color?: string | null;
};

type TeamRosterResponse = {
  members?: TeamMemberOption[];
};

const PAGE_SIZE = 500;
const HOUR_HEIGHT = 44;
const GUTTER_WIDTH = 58;
const LEVELS: Array<{ value: CalendarLevel; label: string }> = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];
const EDITABLE_EVENT_TYPES: CalendarEventType[] = CALENDAR_EVENT_TYPES.filter((type) => type !== 'session');

function colorForKey(key: string): string {
  return CALENDAR_COLOR_HEX[(CALENDAR_COLOR_KEYS.includes(key as CalendarColorKey) ? key : 'red') as CalendarColorKey];
}

function localInputValue(date: Date, allDay = false): string {
  return format(date, allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
}

function dateFromLocalInput(value: string, allDay = false): Date {
  return allDay ? new Date(`${value}T00:00:00`) : new Date(value);
}

function eventTypeLabel(value: string): string {
  return EVENT_TYPE_META[value as CalendarEventType]?.label ?? value.replaceAll('_', ' ');
}

function eventSummary(item: CalendarItem): string {
  if (item.notes?.trim()) return item.notes.trim();
  if (item.address?.trim()) return item.address.trim();
  if (item.location?.trim()) return item.location.trim();
  return item.eventType === 'follow_up' ? 'Follow-up scheduled' : 'Calendar event';
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const status = [response.status, response.statusText].filter(Boolean).join(' ');
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as { error?: unknown; message?: unknown };
      const message = typeof body.error === 'string' ? body.error : body.message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    } catch {
      return status ? `${fallback} (${status})` : fallback;
    }
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.includes('<title>404:')) {
    return status ? `${fallback} (${status})` : fallback;
  }

  return trimmed.length > 240 ? `${fallback} (${status || 'request failed'})` : trimmed;
}

function timeRange(item: CalendarItem): string {
  if (item.isAllDay) return 'All day';
  return `${format(item.startAt, 'h:mm a')} - ${format(item.endAt, 'h:mm a')}`;
}

export function CalendarView() {
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canFilterMembers = currentRole === 'owner';
  const [level, setLevel] = useState<CalendarLevel>('month');
  const [visibleDate, setVisibleDate] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [canIncludeMembers, setCanIncludeMembers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  const [draftStart, setDraftStart] = useState<Date>(addHours(startOfDay(new Date()), new Date().getHours() + 1));

  useEffect(() => {
    if (!canFilterMembers || !currentWorkspaceId) {
      setTeamMembers([]);
      setSelectedMemberIds([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: TeamRosterResponse | null) => {
        if (cancelled) return;
        setTeamMembers(Array.isArray(data?.members) ? data.members : []);
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canFilterMembers, currentWorkspaceId]);

  const fetchEvents = useCallback(async () => {
    if (!currentWorkspaceId) {
      setEvents([]);
      setError('No workspace selected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const range = visibleRange(visibleDate, 6, 6);
      const allEvents: CalendarEventRow[] = [];
      let nextOffset: number | null = 0;

      while (nextOffset !== null) {
        const params = new URLSearchParams({
          workspaceId: currentWorkspaceId,
          eventTypes: CALENDAR_EVENT_TYPES.join(','),
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });
        if (canFilterMembers) {
          params.set('includeMembers', 'true');
          if (selectedMemberIds.length > 0) params.set('memberIds', selectedMemberIds.join(','));
        }

        const response = await fetch(`/api/calendar/events?${params}`);
        if (!response.ok) throw new Error(await apiErrorMessage(response, 'Failed to load calendar'));
        const data = (await response.json()) as EventsResponse;
        allEvents.push(...(data.events ?? []));
        if (data.canIncludeMembers !== undefined) setCanIncludeMembers(Boolean(data.canIncludeMembers));
        nextOffset =
          typeof data.nextOffset === 'number' && data.nextOffset > nextOffset
            ? data.nextOffset
            : null;
      }

      setEvents(allEvents);
    } catch (fetchError) {
      setEvents([]);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [canFilterMembers, currentWorkspaceId, selectedMemberIds, visibleDate]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const items = useMemo(
    () => events.map(calendarItemFromRow).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    [events]
  );

  const filteredItems = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => calendarSearchHaystack(item).includes(query));
  }, [items, searchText]);

  const visibleItems = searching ? filteredItems : items;
  const totalAppointments = items.filter((item) => item.eventType === 'appointment').length;
  const totalFollowUps = items.filter((item) => item.eventType === 'follow_up').length;
  const selectedMemberSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const memberFilterLabel =
    selectedMemberIds.length === 0
      ? 'All members'
      : selectedMemberIds.length === 1
        ? teamMembers.find((member) => member.user_id === selectedMemberIds[0])?.display_name ?? '1 member'
        : `${selectedMemberIds.length} members`;

  function setCalendarLevel(nextLevel: CalendarLevel) {
    setLevel(nextLevel);
    setSearching(false);
    setSearchText('');
    if (nextLevel === 'week') {
      setVisibleDate(startOfWeek(selectedDate));
    }
  }

  function toggleMemberFilter(userId: string) {
    setSelectedMemberIds((current) => {
      if (current.length === 0) return [userId];
      if (current.includes(userId)) {
        const next = current.filter((id) => id !== userId);
        return next.length > 0 ? next : [];
      }
      return [...current, userId];
    });
  }

  function moveVisible(delta: number) {
    if (level === 'year') setVisibleDate((date) => addYears(date, delta));
    if (level === 'month') {
      setVisibleDate((date) => addMonths(date, delta));
      setSelectedDate((date) => addMonths(date, delta));
    }
    if (level === 'week') {
      setSelectedDate((date) => addWeeks(date, delta));
      setVisibleDate((date) => addWeeks(date, delta));
    }
  }

  function openCreate(start?: Date) {
    const base = start ?? selectedDate;
    const hour = new Date().getHours();
    const next = new Date(base);
    next.setHours(Math.min(hour + 1, 23), 0, 0, 0);
    setDraftStart(next);
    setEditingItem(null);
    setEditorOpen(true);
  }

  function openEdit(item: CalendarItem) {
    if (!item.row || item.kind === 'session' || item.kind === 'reminder') return;
    setEditingItem(item);
    setDraftStart(item.startAt);
    setEditorOpen(true);
  }

  async function saveEvent(payload: Record<string, unknown>) {
    const target = editingItem?.sourceId;
    const response = await fetch(target ? `/api/calendar/events/${target}` : '/api/calendar/events', {
      method: target ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        workspaceId: currentWorkspaceId,
      }),
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, 'Failed to save event'));
    await fetchEvents();
  }

  async function deleteEvent(item: CalendarItem) {
    const response = await fetch(`/api/calendar/events/${item.sourceId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await apiErrorMessage(response, 'Failed to delete event'));
    await fetchEvents();
  }

  const showMemberFilter = canFilterMembers && (canIncludeMembers || teamMembers.length > 0);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-background text-foreground">
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="grid gap-2 xl:grid-cols-[minmax(18rem,1fr)_auto_minmax(18rem,1fr)] xl:items-center">
          <div className="flex min-w-0 items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => moveVisible(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 px-2">
              <p className="truncate text-xl font-semibold text-foreground sm:text-2xl">{calendarTitle(level, visibleDate, selectedDate)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {loading ? 'Syncing...' : `${items.length} events, ${totalAppointments} appointments, ${totalFollowUps} follow-ups`}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => moveVisible(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex h-9 w-full overflow-hidden rounded-md border border-border bg-muted/40 p-0.5 sm:w-auto">
            {LEVELS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCalendarLevel(option.value)}
                className={cn(
                  'h-8 flex-1 rounded-[5px] px-4 text-sm font-medium sm:flex-none',
                  level === option.value && 'bg-background shadow-sm'
                )}
                aria-pressed={level === option.value}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 xl:justify-end">
            {showMemberFilter && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="max-w-[13rem] gap-1.5">
                    <Users className="h-4 w-4" />
                    <span className="truncate">{memberFilterLabel}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuCheckboxItem
                    checked={selectedMemberIds.length === 0}
                    onCheckedChange={() => setSelectedMemberIds([])}
                  >
                    All members
                  </DropdownMenuCheckboxItem>
                  {teamMembers.map((member) => (
                    <DropdownMenuCheckboxItem
                      key={member.user_id}
                      checked={selectedMemberIds.length === 0 || selectedMemberSet.has(member.user_id)}
                      onCheckedChange={() => toggleMemberFilter(member.user_id)}
                    >
                      <span
                        className="mr-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: member.color ?? '#8e8e93' }}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate">{member.display_name || 'Member'}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant={searching ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setSearching((value) => !value);
                if (searching) setSearchText('');
              }}
              aria-label="Search"
            >
              {searching ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void fetchEvents()} disabled={loading} aria-label="Refresh">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => openCreate()} aria-label="Add event">
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        {searching && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search calendar"
              className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="min-h-0 flex-1">
          {searching ? (
            <AgendaList items={filteredItems} query={searchText} onEdit={openEdit} />
          ) : level === 'year' ? (
            <YearView
              visibleDate={visibleDate}
              items={items}
              onSelectMonth={(month) => {
                setVisibleDate(month);
                setSelectedDate(month);
                setCalendarLevel('month');
              }}
            />
          ) : level === 'month' ? (
            <MonthView
              month={visibleDate}
              items={items}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onEdit={openEdit}
            />
          ) : (
            <DayView
              selectedDate={startOfWeek(selectedDate)}
              activeDate={selectedDate}
              items={visibleItems}
              dayMode="week"
              onSelectDate={setSelectedDate}
              onCreate={openCreate}
              onEdit={openEdit}
            />
          )}
        </div>

        {!loading && visibleItems.length === 0 && !error && (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No events
          </div>
        )}
      </div>

      <CalendarEventDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialStart={draftStart}
        item={editingItem}
        workspaceId={currentWorkspaceId}
        onSave={saveEvent}
        onDelete={deleteEvent}
      />
    </div>
  );
}

function calendarTitle(level: CalendarLevel, visibleDate: Date, selectedDate: Date): string {
  if (level === 'year') return format(visibleDate, 'yyyy');
  if (level === 'month') return format(visibleDate, 'MMMM yyyy');
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  return `${format(weekStart, 'MMM d')} - ${format(weekEnd, weekStart.getFullYear() === weekEnd.getFullYear() ? 'MMM d, yyyy' : 'MMM d, yyyy')}`;
}

function YearView({
  visibleDate,
  items,
  onSelectMonth,
}: {
  visibleDate: Date;
  items: CalendarItem[];
  onSelectMonth: (date: Date) => void;
}) {
  return (
    <div className="grid min-h-[calc(100vh-13rem)] gap-x-8 gap-y-10 rounded-lg border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {monthsInYear(visibleDate).map((month) => {
        const monthItems = itemsForMonth(items, month);
        return (
          <button
            key={month.toISOString()}
            type="button"
            onClick={() => onSelectMonth(month)}
            className="min-h-[12rem] rounded-md p-3 text-left transition-colors hover:bg-muted/50"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xl font-semibold text-primary">{format(month, 'MMMM')}</span>
              {monthItems.length > 0 && <Badge variant="outline">{monthItems.length}</Badge>}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid(month).slice(0, 35).map((cell) => {
                const dayItems = itemsForDay(monthItems, cell.date);
                return (
                  <div
                    key={cell.id}
                    className={cn(
                      'flex h-7 items-center justify-center rounded text-[11px]',
                      cell.isInDisplayedMonth ? 'text-foreground' : 'text-muted-foreground/40',
                      isSameDay(cell.date, new Date()) && 'bg-primary text-primary-foreground'
                    )}
                  >
                    <span>{format(cell.date, 'd')}</span>
                    {dayItems.length > 0 && <span className="ml-0.5 h-1 w-1 rounded-full bg-primary" />}
                  </div>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MonthView({
  month,
  items,
  selectedDate,
  onSelectDate,
  onEdit,
}: {
  month: Date;
  items: CalendarItem[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onEdit: (item: CalendarItem) => void;
}) {
  const cells = monthGrid(month);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="px-2 py-2 text-center text-sm font-medium text-muted-foreground">
            {day}
          </div>
        ))}
      </div>
      <div className="grid min-h-[calc(100vh-15rem)] grid-cols-7">
        {cells.map((cell) => {
          const dayItems = itemsForDay(items, cell.date);
          return (
            <div
              key={cell.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDate(cell.date)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectDate(cell.date);
                }
              }}
              className={cn(
                'min-h-[7rem] border-b border-r border-border p-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50',
                !cell.isInDisplayedMonth && 'bg-muted/20 text-muted-foreground/60',
                isSameDay(cell.date, selectedDate) && 'bg-primary/10'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-semibold',
                  isSameDay(cell.date, new Date()) && 'bg-primary text-primary-foreground'
                )}
              >
                {format(cell.date, cell.date.getDate() === 1 ? 'MMM d' : 'd')}
              </span>
              <div className="mt-2 space-y-1">
                {dayItems.slice(0, 4).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onEdit(item);
                      }
                    }}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                    style={{ backgroundColor: colorForKey(item.colorKey) }}
                  >
                    {item.title}
                  </button>
                ))}
                {dayItems.length > 4 && (
                  <div className="text-[11px] font-medium text-muted-foreground">+{dayItems.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({
  selectedDate,
  activeDate,
  items,
  dayMode,
  onSelectDate,
  onCreate,
  onEdit,
}: {
  selectedDate: Date;
  activeDate?: Date;
  items: CalendarItem[];
  dayMode: DayDisplayMode;
  onSelectDate: (date: Date) => void;
  onCreate: (date: Date) => void;
  onEdit: (item: CalendarItem) => void;
}) {
  const dayCount = dayMode === 'week' ? 7 : 1;
  const days = Array.from({ length: dayCount }, (_, index) => addDays(startOfDay(selectedDate), index));
  const allDayItems = items.filter((item) => item.isAllDay && days.some((day) => itemsForDay([item], day).length > 0));

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid border-b border-border bg-muted/30" style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((day) => {
          const isActiveDay = isSameDay(day, activeDate ?? new Date());
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDate(day)}
              className="px-2 py-2 text-center transition-colors hover:bg-muted/50"
            >
              <div className={cn('text-xs font-semibold uppercase text-muted-foreground', isActiveDay && 'text-primary')}>
                {format(day, 'EEE')}
              </div>
              <div
                className={cn(
                  'mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-base',
                  isActiveDay && 'bg-primary text-primary-foreground'
                )}
              >
                {format(day, 'd')}
              </div>
            </button>
          );
        })}
      </div>

      {allDayItems.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2">
          {allDayItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onEdit(item)}
              className="rounded-full px-3 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: colorForKey(item.colorKey) }}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[calc(100vh-17rem)] overflow-y-auto">
        <div
          className="relative"
          style={{ height: HOUR_HEIGHT * 24 }}
          onDoubleClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const slot = resolveTimelineSlot({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top + event.currentTarget.scrollTop,
              timelineWidth: rect.width,
              gutterWidth: GUTTER_WIDTH,
              hourHeight: HOUR_HEIGHT,
              days,
            });
            if (slot) onCreate(slot);
          }}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="absolute left-0 right-0 border-t border-border" style={{ top: hour * HOUR_HEIGHT }}>
              <div className="w-[58px] pr-2 text-right text-xs text-muted-foreground">
                {hour === 0 ? '' : format(new Date(2026, 0, 1, hour), hour === 12 ? 'ha' : 'h a')}
              </div>
            </div>
          ))}

          {days.map((day, dayIndex) => {
            const dayItems = itemsForDay(items, day);
            const layouts = computeTimedEventLayouts(day, dayItems);
            const width = `calc((100% - ${GUTTER_WIDTH}px) / ${days.length})`;
            return (
              <div
                key={day.toISOString()}
                className="absolute top-0 h-full border-l border-border"
                style={{ left: `calc(${GUTTER_WIDTH}px + ${dayIndex} * ${width})`, width }}
              >
                {layouts.map((layout) => {
                  const columnWidth = 100 / layout.columnCount;
                  return (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() => onEdit(layout.item)}
                      className="absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs text-white shadow-sm"
                      style={{
                        top: (layout.startMinute / 60) * HOUR_HEIGHT,
                        height: Math.max(24, (layout.durationMinutes / 60) * HOUR_HEIGHT - 2),
                        left: `calc(${layout.column * columnWidth}% + 4px)`,
                        width: `calc(${columnWidth}% - 7px)`,
                        backgroundColor: colorForKey(layout.item.colorKey),
                      }}
                    >
                      <div className="truncate font-semibold">{layout.item.title}</div>
                      <div className="truncate opacity-90">{timeRange(layout.item)}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {days.some((day) => isSameDay(day, new Date())) && <NowLine days={days} />}
        </div>
      </div>
    </div>
  );
}

function NowLine({ days }: { days: Date[] }) {
  const now = new Date();
  const todayIndex = days.findIndex((day) => isSameDay(day, now));
  if (todayIndex < 0) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dayWidth = `calc((100% - ${GUTTER_WIDTH}px) / ${days.length})`;
  return (
    <div className="pointer-events-none absolute z-10 flex items-center" style={{ top: (minutes / 60) * HOUR_HEIGHT - 9, left: GUTTER_WIDTH }}>
      <div
        className="h-px bg-primary"
        style={{ marginLeft: `calc(${todayIndex} * ${dayWidth})`, width: dayWidth }}
      />
    </div>
  );
}

function AgendaList({
  items,
  query,
  onEdit,
  title,
}: {
  items: CalendarItem[];
  query: string;
  onEdit: (item: CalendarItem) => void;
  title?: string;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = dateKey(item.startAt);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries())
      .sort(([lhs], [rhs]) => lhs.localeCompare(rhs))
      .map(([key, groupItems]) => ({
        key,
        date: groupItems[0]?.startAt ?? new Date(`${key}T12:00:00`),
        items: groupItems.sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
      }));
  }, [items]);

  return (
    <div className="rounded-lg border border-border bg-card">
      {title && <div className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</div>}
      {grouped.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">No events</div>
      ) : (
        <div className="divide-y divide-border">
          {grouped.map((section) => (
            <div key={section.key} className="p-4">
              <div className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{format(section.date, 'EEE d MMM')}</div>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onEdit(item)}
                    className="flex w-full gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <span
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorForKey(item.colorKey) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{highlightQuery(item.title, query)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {timeRange(item)}
                        </span>
                        {(item.location || item.address) && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{item.location ?? item.address}</span>
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{eventSummary(item)}</span>
                    </span>
                    <Badge variant={item.eventType === 'follow_up' ? 'outline' : 'secondary'}>{eventTypeLabel(item.eventType)}</Badge>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function highlightQuery(title: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return title;
  const index = title.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index < 0) return title;
  return (
    <>
      {title.slice(0, index)}
      <span className="text-primary">{title.slice(index, index + trimmed.length)}</span>
      {title.slice(index + trimmed.length)}
    </>
  );
}

function CalendarEventDialog({
  open,
  onOpenChange,
  initialStart,
  item,
  workspaceId,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStart: Date;
  item: CalendarItem | null;
  workspaceId: string | null;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onDelete: (item: CalendarItem) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [startValue, setStartValue] = useState(localInputValue(initialStart));
  const [endValue, setEndValue] = useState(localInputValue(addHours(initialStart, 1)));
  const [eventType, setEventType] = useState<CalendarEventType>('appointment');
  const [colorKey, setColorKey] = useState<CalendarColorKey>('red');
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<CalendarContactOption[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<CalendarContactOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const source = item?.row;
    const start = item?.startAt ?? initialStart;
    const end = item?.endAt ?? addHours(initialStart, 1);
    const resolvedType = EDITABLE_EVENT_TYPES.includes(source?.event_type as CalendarEventType)
      ? (source?.event_type as CalendarEventType)
      : 'appointment';
    const resolvedColor = CALENDAR_COLOR_KEYS.includes(source?.color_key as CalendarColorKey)
      ? (source?.color_key as CalendarColorKey)
      : EVENT_TYPE_META[resolvedType].defaultColorKey;

    setTitle(source?.title ?? '');
    setLocation(source?.location ?? source?.contact_address ?? '');
    setIsAllDay(source?.is_all_day ?? false);
    setStartValue(localInputValue(start, source?.is_all_day ?? false));
    setEndValue(localInputValue(end, source?.is_all_day ?? false));
    setEventType(resolvedType);
    setColorKey(resolvedColor);
    setNotes(source?.notes ?? '');
    setContactSearch('');
    setSelectedContact(
      source?.contact_id
        ? {
            id: source.contact_id,
            fullName: source.contact_name ?? 'Lead',
            email: null,
            phone: null,
            address: source.contact_address,
            notes: null,
          }
        : null
    );
    setError(null);
  }, [initialStart, item, open]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const params = new URLSearchParams({ workspaceId });
    fetch(`/api/contacts?${params}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => setContacts(Array.isArray(data) ? data : []))
      .catch(() => setContacts([]));
  }, [open, workspaceId]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    const sorted = contacts.slice().sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (!query) return sorted;
    return sorted.filter((contact) =>
      [contact.fullName, contact.address ?? '', contact.email ?? '', contact.phone ?? '', contact.notes ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [contactSearch, contacts]);

  function selectContact(contact: CalendarContactOption) {
    setSelectedContact(contact);
    setContactSearch('');
    if (!location.trim() && contact.address) setLocation(contact.address);
    if (!title.trim()) setTitle(defaultTitleForEventType(eventType, contact.fullName));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const startAt = dateFromLocalInput(startValue, isAllDay);
      const endAt = dateFromLocalInput(endValue, isAllDay);
      await onSave({
        title,
        location,
        is_all_day: isAllDay,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        event_type: eventType,
        color_key: colorKey,
        notes,
        contact_id: selectedContact?.id ?? null,
        contact_name: selectedContact?.fullName ?? null,
        contact_address: selectedContact?.address ?? null,
      });
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save event');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete(item);
      onOpenChange(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete event');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {error && <div className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">{error}</div>}

          <div className="grid gap-2">
            <Label htmlFor="calendar-title">Title</Label>
            <Input id="calendar-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={EVENT_TYPE_META[eventType].label} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="calendar-location">Location</Label>
            <Input id="calendar-location" value={location} onChange={(event) => setLocation(event.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                value={eventType}
                onValueChange={(value) => {
                  const next = value as CalendarEventType;
                  setEventType(next);
                  setColorKey(EVENT_TYPE_META[next].defaultColorKey);
                  if (!title.trim()) setTitle(defaultTitleForEventType(next, selectedContact?.fullName));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_EVENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {EVENT_TYPE_META[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-3 rounded-md border border-border px-3 py-2">
              <Switch checked={isAllDay} onCheckedChange={setIsAllDay} id="all-day" />
              <Label htmlFor="all-day" className="pb-0.5">All day</Label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="calendar-start">Starts</Label>
              <Input id="calendar-start" type={isAllDay ? 'date' : 'datetime-local'} value={startValue} onChange={(event) => setStartValue(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="calendar-end">Ends</Label>
              <Input id="calendar-end" type={isAllDay ? 'date' : 'datetime-local'} value={endValue} onChange={(event) => setEndValue(event.target.value)} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Lead</Label>
            {selectedContact ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selectedContact.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{selectedContact.address ?? selectedContact.email ?? ''}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedContact(null)}>
                  Clear
                </Button>
              </div>
            ) : (
              <>
                <Input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search leads" />
                <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                  {filteredContacts.slice(0, 8).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => selectContact(contact)}
                      className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                    >
                      <span className="block text-sm font-medium">{contact.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{contact.address ?? contact.email ?? contact.phone ?? ''}</span>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No leads found</div>}
                </div>
              </>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CALENDAR_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={key}
                  onClick={() => setColorKey(key)}
                  className={cn('h-8 w-8 rounded-full border-2', colorKey === key ? 'border-foreground' : 'border-transparent')}
                  style={{ backgroundColor: colorForKey(key) }}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="calendar-notes">Notes</Label>
            <Textarea id="calendar-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {item && (
            <Button variant="destructive" onClick={() => void remove()} disabled={saving} className="mr-auto">
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
