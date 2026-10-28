'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildFarmDoorPlan, type FarmDoorPlan } from '@/lib/farms/door-plan';
import type { FarmAddress } from '@/types/farms';

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dateLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function FarmDoorPlanner({ farmId, addresses, onHomesImported, onAddContact }: {
  farmId: string;
  addresses: FarmAddress[];
  onHomesImported: () => Promise<void>;
  onAddContact: (home: FarmAddress) => void;
}) {
  const [startDate, setStartDate] = useState(localToday);
  const [doorsPerDay, setDoorsPerDay] = useState(100);
  const [saved, setSaved] = useState<FarmDoorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => fetch(`/api/farms/${farmId}/door-plan`).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load door plan.');
      if (active && data.plan) {
        setSaved(data.plan); setStartDate(data.plan.startDate); setDoorsPerDay(data.plan.doorsPerDay);
      }
    }).catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    void load();
    window.addEventListener('flyr-farm-door-plan-refresh', load);
    return () => { active = false; window.removeEventListener('flyr-farm-door-plan-refresh', load); };
  }, [farmId]);
  const draft = useMemo(() => {
    try { return buildFarmDoorPlan(addresses, startDate, doorsPerDay, saved?.calendar); } catch { return null; }
  }, [addresses, startDate, doorsPerDay, saved?.calendar]);
  const plan = preview || !saved ? draft : saved;
  const homeById = useMemo(() => new Map(addresses.map(home => [home.id, home])), [addresses]);
  const plannedIds = useMemo(() => new Set(saved?.days.flatMap(day => day.addressIds) ?? []), [saved]);
  const unplanned = saved ? addresses.filter(home => home.last_outcome_status !== 'do_not_knock' && !plannedIds.has(home.id)).length : 0;
  const missing = saved ? [...plannedIds].filter(id => !homeById.has(id)).length : 0;
  const days = plan?.days ?? [];
  const total = days.reduce((sum, day) => sum + day.addressIds.length, 0);
  const pageCount = Math.max(1, Math.ceil(days.length / 5));
  const visiblePage = Math.min(page, pageCount - 1);
  const selected = days.find(day => day.date === selectedDate);
  const changed = !!saved && (preview || startDate !== saved.startDate || doorsPerDay !== saved.doorsPerDay);

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/farms/${farmId}/door-plan`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate, doorsPerDay, calendar: saved?.calendar }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save plan.');
      setSaved(data.plan); setPreview(false); setPage(0); setSelectedDate(null); setMessage('Daily plan saved for this farm.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save plan.'); }
    finally { setBusy(false); }
  }
  async function importHomes() {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/farms/${farmId}/import-homes`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to import homes.');
      await onHomesImported(); setMessage(`${data.totalCount.toLocaleString()} farm addresses saved. Preview and save a plan to include new homes.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to import homes.'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!plan) return;
    const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [['Date', 'Day', 'Address', 'Farm address ID'], ...days.flatMap(day => day.addressIds.map(id => [day.date, dateLabel(day.date), homeById.get(id)?.formatted ?? 'Address unavailable', id]))];
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'farm-weekday-plan.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Daily door assignments</h2><p className="mt-1 text-sm text-muted-foreground">Cover the whole farm in daily lists, grouped by street. Your saved working days and holidays are respected. Without a custom schedule, Monday–Friday is used. Contacts remain in the farm.</p></div>
      <Button variant="outline" onClick={() => void importHomes()} disabled={busy || loading}>{busy ? 'Working…' : 'Import / refresh farm homes'}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-2"><Label htmlFor="door-plan-start">Start date</Label><Input id="door-plan-start" type="date" value={startDate} disabled={loading || busy} onChange={event => setStartDate(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="door-plan-capacity">Doors per day</Label><Input id="door-plan-capacity" type="number" min={1} max={1000} value={doorsPerDay || ''} disabled={loading || busy} onChange={event => setDoorsPerDay(Number(event.target.value))} /></div>
      <div className="flex items-end"><Button variant="outline" disabled={!draft || loading || busy} onClick={() => { setPreview(true); setPage(0); setSelectedDate(null); }}>Preview plan</Button></div>
      <div className="flex items-end"><Button disabled={!draft || !addresses.length || loading || busy} onClick={() => void save()}>{busy ? 'Saving…' : saved ? 'Replace saved plan' : 'Save daily plan'}</Button></div>
    </div>
    <div aria-live="polite" className="text-sm">
      {loading ? <p>Loading saved plan…</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {message ? <p>{message}</p> : null}
      {!draft ? <p>Choose a valid date and a whole number from 1 to 1,000 doors per day.</p> : null}
      {changed ? <p className="text-amber-600 dark:text-amber-400">{preview ? 'Preview — save to keep these assignments.' : 'Settings changed. Preview or save to update the assignments below.'}</p> : null}
      {unplanned || missing ? <p className="text-amber-600 dark:text-amber-400">{unplanned} homes need assigning; {missing} saved homes are unavailable. Preview and save to update the plan.</p> : null}
    </div>
    <div className="flex flex-wrap gap-6 rounded-lg bg-muted/40 p-3 text-sm">
      <span><strong>{addresses.length.toLocaleString()}</strong> farm addresses</span>
      <span><strong>{total.toLocaleString()}</strong> planned doors</span>
      <span><strong>{days.length.toLocaleString()}</strong> weekdays</span>
      <span>Finish: <strong>{days.length ? dateLabel(days[days.length - 1].date) : '—'}</strong></span>
    </div>
    {plan?.excludedDoNotKnock ? <p className="text-xs text-muted-foreground">{plan.excludedDoNotKnock} do-not-knock homes excluded. Always check current home preferences before visiting.</p> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {days.slice(visiblePage * 5, visiblePage * 5 + 5).map(day => <button key={day.date} type="button" onClick={() => setSelectedDate(day.date)} aria-pressed={selectedDate === day.date} className="rounded-xl border border-border p-4 text-left hover:bg-muted/50 aria-pressed:border-primary">
        <p className="text-sm font-medium">{dateLabel(day.date)}</p><p className="mt-2 text-2xl font-semibold">{day.addressIds.length} <span className="text-sm font-normal">doors</span></p>
        <p className="mt-2 text-xs text-muted-foreground">{homeById.get(day.addressIds[0])?.street_name || 'View daily addresses'}</p>
      </button>)}
    </div>
    {days.length ? <div className="flex flex-wrap items-center gap-3"><Button size="sm" variant="outline" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</Button><span className="text-sm">Days {visiblePage * 5 + 1}–{Math.min(visiblePage * 5 + 5, days.length)} of {days.length}</span><Button size="sm" variant="outline" disabled={visiblePage + 1 >= pageCount} onClick={() => setPage(visiblePage + 1)}>Next</Button><Button size="sm" variant="outline" onClick={download}>Export all daily lists</Button></div> : <p className="text-sm text-muted-foreground">Import homes to build a plan for your farm.</p>}
    {selected ? <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border p-3"><h3 className="font-medium">{dateLabel(selected.date)} · {selected.addressIds.length} doors</h3>{selected.addressIds.map(id => {
      const home = homeById.get(id);
      return <div key={id} className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm"><div>{home?.formatted ?? 'Address unavailable'}{home?.last_outcome_status === 'do_not_knock' ? <p className="text-destructive">Do not knock — skip this home</p> : null}</div>{home ? <Button size="sm" variant="outline" onClick={() => onAddContact(home)}>Add contact</Button> : null}</div>;
    })}</div> : null}
    <p className="text-xs text-muted-foreground">Daily lists use available address records and street order; walking routes and occupied-home counts are not verified.</p>
  </section>;
}
