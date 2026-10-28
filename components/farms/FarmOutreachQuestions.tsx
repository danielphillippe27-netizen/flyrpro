'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { validPlanDate } from '@/lib/farms/door-plan';
import { forecastOutreach, type OutreachSettings } from '@/lib/farms/outreach-schedule';

const days = [{ id: 1, label: 'Monday', short: 'M' }, { id: 2, label: 'Tuesday', short: 'T' }, { id: 3, label: 'Wednesday', short: 'W' }, { id: 4, label: 'Thursday', short: 'T' }, { id: 5, label: 'Friday', short: 'F' }, { id: 6, label: 'Saturday', short: 'S' }, { id: 0, label: 'Sunday', short: 'S' }];
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function FarmOutreachQuestions({ value, onChange, totalHomes, startDate, weeks, estimated = false, weeksOff = [], location, onHolidayLoadingChange }: {
  value: OutreachSettings; onChange: (value: OutreachSettings) => void; totalHomes: number | null;
  startDate: string; weeks: number; estimated?: boolean; weeksOff?: string[]; location?: { latitude: number; longitude: number } | null; onHolidayLoadingChange?: (loading: boolean) => void;
}) {
  const prefix = useId();
  const latest = useRef(value); latest.current = value;
  const change = useRef(onChange); change.current = onChange;
  const [holidayStatus, setHolidayStatus] = useState('');
  const [country, setCountry] = useState(value.holidayCountry ?? '');
  const [region, setRegion] = useState(value.holidayRegion ?? '');
  const [loading, setLoading] = useState(false);
  useEffect(() => { onHolidayLoadingChange?.(loading); }, [loading, onHolidayLoadingChange]);
  const request = useRef(0);
  const extra = value.extraDaysOff ?? value.holidays;
  function apply(patch: Partial<OutreachSettings>) {
    const current = latest.current;
    const next = { ...current, ...patch };
    const personal = next.extraDaysOff ?? current.holidays;
    next.extraDaysOff = personal;
    next.holidays = [...new Set([...personal, ...(next.holidaysEnabled ? next.publicHolidays ?? [] : [])])].sort();
    latest.current = next;
    change.current(next);
  }
  async function loadHolidays(nextCountry: string, nextRegion: string, year: number) {
    const id = ++request.current;
    setLoading(true); setHolidayStatus('');
    try {
      const query = new URLSearchParams({ country: nextCountry, region: nextRegion, year: String(year) });
      const response = await fetch(`/api/farms/public-holidays?${query}`);
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.dates)) throw new Error(payload.error || 'Holidays could not be loaded.');
      if (id !== request.current) return;
      apply({ holidayCountry: nextCountry, holidayRegion: nextRegion, publicHolidays: payload.dates, holidaysEnabled: true });
      setHolidayStatus('Local holidays are included.');
    } catch (reason) {
      if (id !== request.current) return;
      apply({ holidaysEnabled: false });
      setHolidayStatus(reason instanceof Error ? reason.message : 'Holidays could not be loaded.');
    } finally { if (id === request.current) setLoading(false); }
  }
  const latitude = location?.latitude, longitude = location?.longitude;
  useEffect(() => {
    if (latitude == null || longitude == null || latest.current.holidaysEnabled !== undefined || !validPlanDate(startDate)) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch('/api/maps/google/reverse-geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latitude, longitude }), signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !/^[A-Z]{2}$/.test(result.country ?? '') || !/^[A-Z]{2,3}$/.test(result.region ?? '')) throw new Error('Could not detect local holidays. Choose a region or leave holidays off.');
        if (controller.signal.aborted || latest.current.holidaysEnabled !== undefined) return;
        setCountry(result.country); setRegion(result.region);
        await loadHolidays(result.country, result.region, Number(startDate.slice(0, 4)));
      } catch (reason) {
        if (!controller.signal.aborted) { setLoading(false); setHolidayStatus(reason instanceof Error ? reason.message : 'Could not detect local holidays.'); }
      }
    })();
    return () => { controller.abort(); request.current++; };
    // Detection is tied to the selected farm location, not form edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);
  useEffect(() => {
    if (!value.holidaysEnabled || !value.holidayCountry || !value.holidayRegion || !validPlanDate(startDate)) return;
    const year = startDate.slice(0, 4);
    if (value.publicHolidays?.some(date => date.startsWith(year))) return;
    void loadHolidays(value.holidayCountry, value.holidayRegion, Number(year));
    // Refresh when a saved plan moves outside its stored holiday calendar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, value.holidaysEnabled, value.holidayCountry, value.holidayRegion]);
  const forecast = useMemo(() => {
    try { return { data: totalHomes === null ? null : forecastOutreach(totalHomes, startDate, weeks, value, weeksOff), error: '' }; }
    catch (reason) { return { data: null, error: reason instanceof Error ? reason.message : 'Check your settings.' }; }
  }, [totalHomes, startDate, weeks, value, weeksOff]);
  function number(key: 'doorPasses' | 'callPasses' | 'doorsPerDay' | 'callsPerDay', label: string, max: number) {
    return <div className="space-y-1.5"><Label htmlFor={`${prefix}-${key}`}>{label}</Label><Input id={`${prefix}-${key}`} type="number" min={key.endsWith('Passes') ? 0 : 1} max={max} step={1} value={value[key] || (key.endsWith('Passes') ? 0 : '')} onChange={event => apply({ [key]: Number(event.target.value) })} className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /></div>;
  }
  const data = forecast.data;
  return <div className="min-w-0 space-y-5" aria-label="Farm plan settings">
    <div><h3 className="text-xl font-semibold tracking-tight">Plan your farm</h3><p className="mt-1 text-sm text-muted-foreground">Set your pace. We’ll calculate when you’ll finish.</p></div>
    <div className="max-w-48">{number('doorsPerDay', 'Doors per day', 1000)}</div>
    <fieldset><legend className="mb-2 text-sm font-medium">Working days</legend><div className="flex gap-1.5">{days.map(day => <button type="button" key={day.id} aria-label={day.label} aria-pressed={value.workingDays.includes(day.id)} onClick={() => apply({ workingDays: value.workingDays.includes(day.id) ? value.workingDays.filter(item => item !== day.id) : [...value.workingDays, day.id] })} className={`h-9 min-w-0 flex-1 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value.workingDays.includes(day.id) ? 'border-[#FA263C] bg-[#FA263C] text-white' : 'border-border bg-card'}`}>{day.short}</button>)}</div></fieldset>
    <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-3"><Label htmlFor={`${prefix}-holidays`}>Holidays</Label><input id={`${prefix}-holidays`} type="checkbox" role="switch" checked={!!value.holidaysEnabled} disabled={loading} className="h-5 w-5 accent-[#FA263C]" onChange={event => { if (!event.target.checked) { request.current++; setLoading(false); apply({ holidaysEnabled: false }); setHolidayStatus(''); } else if (country && region && validPlanDate(startDate)) void loadHolidays(country.toUpperCase(), region.toUpperCase(), Number(startDate.slice(0, 4))); else setHolidayStatus('Choose a country and region to include local holidays.'); }} /></div>
      {loading && <p className="mt-2 text-xs text-muted-foreground" role="status">Finding local holidays…</p>}{holidayStatus && <p className="mt-2 text-xs text-muted-foreground" role="status">{holidayStatus}</p>}
      <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Change holiday region</summary><div className="mt-3 flex items-end gap-2"><div className="min-w-0 flex-1"><Label htmlFor={`${prefix}-country`} className="text-xs">Country code</Label><Input id={`${prefix}-country`} value={country} maxLength={2} placeholder="e.g. CA" onChange={e => setCountry(e.target.value.toUpperCase())} /></div><div className="min-w-0 flex-1"><Label htmlFor={`${prefix}-region`} className="text-xs">Region code</Label><Input id={`${prefix}-region`} value={region} maxLength={3} placeholder="Region code" onChange={e => setRegion(e.target.value.toUpperCase())} /></div><Button type="button" size="sm" variant="outline" disabled={loading || !validPlanDate(startDate)} onClick={() => void loadHolidays(country, region, Number(startDate.slice(0, 4)))}>Apply</Button></div></details>
    </div>
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Extra days off {(value.extraDaysOffCount ?? 0) + extra.length > 0 && <span className="text-muted-foreground">· {(value.extraDaysOffCount ?? 0) + extra.length}</span>}</summary><div className="mt-3 max-w-48 space-y-1.5"><Label htmlFor={`${prefix}-off-count`}>Number of extra days off</Label><Input id={`${prefix}-off-count`} type="number" min={0} max={366} step={1} value={value.extraDaysOffCount ?? 0} onChange={e => apply({ extraDaysOffCount: Number(e.target.value) })} /></div><p className="mt-2 text-xs text-muted-foreground">Added to your holiday breaks.</p>{extra.length > 0 && <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-auto">{extra.map(date => <button type="button" key={date} onClick={() => apply({ extraDaysOff: extra.filter(item => item !== date) })} className="rounded border border-border px-2 py-1 text-xs" aria-label={`Remove day off ${date}`}>{dateLabel(date)} ×</button>)}</div>}</details>
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Advanced options</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{number('doorPasses', 'Door-knocking rounds', 12)}{number('callPasses', 'Calling rounds', 12)}{value.callPasses > 0 && number('callsPerDay', 'Calls per day', 1000)}</div></details>
    {forecast.error && <p role="alert" className="text-sm text-destructive">{forecast.error}</p>}
    {totalHomes === null && <p className="text-sm text-muted-foreground">Counting mapped homes…</p>}
    {data && <div className="rounded-xl border border-border bg-muted/20 p-4" aria-live="polite"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your farm plan</p><div className="mt-3 grid grid-cols-2 gap-4"><div><p className="text-xl font-semibold tabular-nums">{totalHomes?.toLocaleString()}</p><p className="text-xs text-muted-foreground">{estimated ? 'Mapped homes' : 'Eligible homes'}</p></div><div><p className="text-xl font-semibold tabular-nums">{data.daysNeeded.toLocaleString()}</p><p className="text-xs text-muted-foreground">Working days needed</p></div><div><p className="text-xl font-semibold tabular-nums">{data.timeOffDays.toLocaleString()}</p><p className="text-xs text-muted-foreground">Holidays + days off</p></div><div><p className="text-xl font-semibold tabular-nums">{data.finishDate || totalHomes === 0 ? data.calendarDays.toLocaleString() : '—'}</p><p className="text-xs text-muted-foreground">Total days to finish</p></div></div><p className="mt-3 text-sm">{data.finishDate ? `Estimated completion: ${dateLabel(data.finishDate)}` : totalHomes === 0 ? 'No homes yet' : 'Completion is beyond 10 years'}</p>{data.finishDate && data.nonWorkingWeekdays > 0 && <p className="mt-1 text-xs text-muted-foreground">Includes {data.nonWorkingWeekdays.toLocaleString()} days outside your working week.</p>}{value.doorPasses + value.callPasses > 1 && <p className="mt-2 text-xs text-muted-foreground">{value.doorPasses + value.callPasses} planned touches per home</p>}{!data.fits && <p className="mt-2 text-sm text-amber-500">{data.doorDays > data.availableDays && data.minimumDoorsPerDay ? `Increase to ${data.minimumDoorsPerDay.toLocaleString()} doors/day to finish in this plan.` : ''}{data.callDays > data.availableDays && data.minimumCallsPerDay ? ` Increase to ${data.minimumCallsPerDay.toLocaleString()} calls/day to finish in this plan.` : ''}</p>}</div>}
  </div>;
}
