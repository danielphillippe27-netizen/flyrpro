'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActivityPageView } from '@/components/activity/ActivityPageView';
import { getClientAsync } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type Props = { campaignId?: string | null; createdAt: string };

export function FarmActivityCalendar({ campaignId, createdAt }: Props) {
  const { currentWorkspaceId } = useWorkspace();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [days, setDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [today, setToday] = useState(() => dayKey(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setToday(dayKey(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDays(new Set());
    async function load() {
      try {
        if (!currentWorkspaceId) throw new Error('No workspace');
        if (!campaignId) { setLoading(false); return; }
        const client = await getClientAsync();
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
        const activeDays = new Set<string>();
        let offset = 0;
        let total = 0;
        do {
          const params = new URLSearchParams({
            workspaceId: currentWorkspaceId, campaignId, type: 'session_completed',
            includeMembers: 'false', start: month.toISOString(),
            end: new Date(end.getTime() - 1).toISOString(), limit: '100', offset: String(offset),
          });
          const response = await fetch(`/api/activity?${params}`, {
            credentials: 'include', signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!response.ok) throw new Error('Activity unavailable');
          const result: { events?: { event_time: string }[]; total?: number } = await response.json();
          const events = result.events ?? [];
          events.forEach(event => activeDays.add(dayKey(new Date(event.event_time))));
          offset += events.length;
          total = result.total ?? offset;
          if (!events.length && offset < total) throw new Error('Incomplete activity');
        } while (offset < total);
        if (!controller.signal.aborted) { setDays(activeDays); setLoading(false); }
      } catch {
        if (!controller.signal.aborted) { setError(true); setLoading(false); }
      }
    }
    void load();
    return () => controller.abort();
  }, [campaignId, currentWorkspaceId, month, retry, today]);

  const firstDay = dayKey(new Date(createdAt));
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const currentMonth = today.slice(0, 7) === dayKey(month).slice(0, 7);
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return <div className="space-y-5">
    <section aria-label="Your canvassing calendar" aria-busy={loading} className="rounded-xl border border-border p-3 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold">Don’t break the chain</h3>
          <p className="mt-1 text-sm text-muted-foreground">Every day you get out counts. Keep it green.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">{monthLabel}</span>
          <Button variant="ghost" size="icon" aria-label="Next month" disabled={currentMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      {error ? <div role="alert" className="rounded-lg border border-border p-6 text-center text-sm">Couldn’t load your activity. <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>Try again</Button></div> : <>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-3">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="pb-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}
          {Array.from({ length: month.getDay() }, (_, index) => <div key={`blank-${index}`} />)}
          {Array.from({ length: count }, (_, index) => {
            const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
            const key = dayKey(date);
            const active = days.has(key);
            const missed = !loading && !active && key < today && key >= firstDay;
            const label = loading ? 'Loading' : active ? 'Went out' : missed ? 'Did not go out' : key === today ? 'Still time to go out' : key > today ? 'Upcoming' : 'Before this farm';
            return <div key={key} aria-label={`${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${label}`} title={label}
              className={cn('relative flex aspect-square flex-col items-center justify-center rounded-md border sm:rounded-xl',
                loading ? 'animate-pulse border-border bg-muted' : active ? 'border-green-600 bg-green-600 text-white' : missed ? 'border-red-600 bg-red-600 text-white' : 'border-border bg-muted/30 text-muted-foreground',
                key === today && 'ring-2 ring-foreground ring-offset-2 ring-offset-card')}>
              <span className="absolute left-1.5 top-1 text-xs font-semibold sm:left-3 sm:top-2 sm:text-base">{index + 1}</span>
              {!loading && active && <Check aria-hidden="true" className="mt-3 h-5 w-5 sm:h-10 sm:w-10" strokeWidth={3} />}
              {missed && <X aria-hidden="true" className="mt-3 h-5 w-5 sm:h-10 sm:w-10" strokeWidth={3} />}
              {key === today && !active && !loading && <span className="mt-3 text-[9px] font-medium sm:text-sm">Today</span>}
            </div>;
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-green-600" />Went out</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-red-600" />Didn’t go out</span>
          <span>Your completed sessions in this farm · {loading ? 'Loading…' : `${days.size} active days this month`}</span>
        </div>
      </>}
    </section>
    <section className="overflow-hidden rounded-xl border border-border">
      <button type="button" className="flex w-full items-center justify-between p-4 text-left font-semibold hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-expanded={sessionsOpen} aria-controls="farm-activity-sessions" onClick={() => setSessionsOpen(open => !open)}>
        Activity sessions <ChevronDown className={cn('h-5 w-5 transition-transform', sessionsOpen && 'rotate-180')} />
      </button>
      <div id="farm-activity-sessions" hidden={!sessionsOpen}>
        {sessionsOpen && <div className="border-t border-border p-3 sm:p-4">{campaignId ? <ActivityPageView campaignId={campaignId} forcedTypeFilter="session_completed" hideFilterControls defaultRangePreset="all" emptyMessage="No sessions for this farm yet." /> : <p className="text-sm text-muted-foreground">No sessions for this farm yet.</p>}</div>}
      </div>
    </section>
  </div>;
}
