'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { CalendarDays, RefreshCw, Users } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type AppointmentEvent = {
  id: string;
  user_id: string;
  event_time: string;
  payload: Record<string, unknown>;
  display_name: string | null;
};

type ActivityResponse = {
  events?: AppointmentEvent[];
  total?: number;
  nextOffset?: number | null;
  canIncludeMembers?: boolean;
};

const PAGE_SIZE = 100;

function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function dateKeyFromIso(iso: string): string {
  return dateKey(new Date(iso));
}

function eventSummary(event: AppointmentEvent): string {
  const payload = event.payload ?? {};
  if (typeof payload.summary === 'string' && payload.summary.trim()) return payload.summary.trim();
  if (typeof payload.address === 'string' && payload.address.trim()) return payload.address.trim();
  if (typeof payload.note === 'string' && payload.note.trim()) return payload.note.trim();
  if (typeof payload.notes === 'string' && payload.notes.trim()) return payload.notes.trim();
  return 'Appointment logged';
}

export function AppointmentsCalendarView() {
  const { currentWorkspaceId } = useWorkspace();
  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());
  const [includeMembers, setIncludeMembers] = useState(false);
  const [canIncludeMembers, setCanIncludeMembers] = useState(false);
  const [events, setEvents] = useState<AppointmentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    if (!currentWorkspaceId) {
      setEvents([]);
      setError('No workspace selected');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const start = startOfMonth(month).toISOString();
      const end = endOfMonth(month).toISOString();

      const allEvents: AppointmentEvent[] = [];
      let nextOffset: number | null = 0;

      while (nextOffset !== null) {
        const params = new URLSearchParams({
          workspaceId: currentWorkspaceId,
          type: 'appointment',
          start,
          end,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });

        if (includeMembers) {
          params.set('includeMembers', 'true');
        }

        const response = await fetch(`/api/activity?${params}`);
        if (!response.ok) throw new Error(await response.text());

        const data = (await response.json()) as ActivityResponse;
        const pageEvents = data.events ?? [];
        allEvents.push(...pageEvents);

        if (data.canIncludeMembers !== undefined) {
          setCanIncludeMembers(Boolean(data.canIncludeMembers));
        }

        if (typeof data.nextOffset === 'number' && data.nextOffset > nextOffset) {
          nextOffset = data.nextOffset;
        } else {
          nextOffset = null;
        }
      }

      setEvents(allEvents);
    } catch (fetchError) {
      setEvents([]);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, month, includeMembers]);

  useEffect(() => {
    void fetchAppointments();
  }, [fetchAppointments]);

  const eventsByDay = useMemo(() => {
    return events.reduce<Record<string, AppointmentEvent[]>>((acc, event) => {
      const key = dateKeyFromIso(event.event_time);
      if (!acc[key]) acc[key] = [];
      acc[key].push(event);
      return acc;
    }, {});
  }, [events]);

  const appointmentDays = useMemo(
    () => Object.keys(eventsByDay).map((day) => new Date(`${day}T12:00:00`)),
    [eventsByDay]
  );

  const selectedDayKey = selectedDay ? dateKey(selectedDay) : '';
  const selectedDayEvents = selectedDayKey ? eventsByDay[selectedDayKey] ?? [] : [];
  const totalAppointments = events.length;
  const activeDays = Object.keys(eventsByDay).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchAppointments()} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {canIncludeMembers && (
          <Button
            variant={includeMembers ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIncludeMembers((value) => !value)}
            disabled={loading}
          >
            <Users className="mr-1 h-3.5 w-3.5" />
            All team members
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Appointment Calendar</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Calendar
              mode="single"
              month={month}
              selected={selectedDay}
              onMonthChange={setMonth}
              onSelect={setSelectedDay}
              modifiers={{ hasAppointments: appointmentDays }}
              modifiersClassNames={{ hasAppointments: 'bg-primary/10 text-primary font-semibold' }}
              className="rounded-md border"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {selectedDay ? `Appointments for ${format(selectedDay, 'EEEE, MMM d')}` : 'Appointments'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <CalendarDays className="mr-1 h-3.5 w-3.5" />
                {totalAppointments} this month
              </Badge>
              <Badge variant="outline">{activeDays} active days</Badge>
            </div>

            {loading && events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading appointments…</p>
            ) : selectedDayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No appointments on this day.</p>
            ) : (
              <div className="space-y-2">
                {selectedDayEvents
                  .slice()
                  .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime())
                  .map((event) => (
                    <div key={event.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {new Date(event.event_time).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                        <Badge variant="secondary">{event.display_name ?? 'Member'}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{eventSummary(event)}</p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

