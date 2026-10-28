'use client';
import { useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { validPlanDate } from '@/lib/farms/door-plan';
import { forecastOutreach, outreachDate, type OutreachSettings } from '@/lib/farms/outreach-schedule';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function FarmOutreachQuestions({ value, onChange, totalHomes, startDate, weeks, estimated = false, weeksOff = [] }: {
  value: OutreachSettings; onChange: (value: OutreachSettings) => void; totalHomes: number | null;
  startDate: string; weeks: number; estimated?: boolean; weeksOff?: string[];
}) {
  const prefix = useId();
  const [holidayStart, setHolidayStart] = useState('');
  const [holidayEnd, setHolidayEnd] = useState('');
  const [holidayError, setHolidayError] = useState('');
  const forecast = useMemo(() => {
    try { return { data: totalHomes === null ? null : forecastOutreach(totalHomes, startDate, weeks, value, weeksOff), error: '' }; }
    catch (error) { return { data: null, error: error instanceof Error ? error.message : 'Check your settings.' }; }
  }, [totalHomes, startDate, weeks, value, weeksOff]);
  function number(key: 'doorPasses' | 'callPasses' | 'doorsPerDay' | 'callsPerDay', label: string, max: number) {
    return <div className="space-y-2"><Label htmlFor={`${prefix}-${key}`}>{label}</Label><Input id={`${prefix}-${key}`} type="number" min={key.endsWith('Passes') ? 0 : 1} max={max} step={1} value={value[key] || (key.endsWith('Passes') ? 0 : '')} onChange={event => onChange({ ...value, [key]: Number(event.target.value) })} /></div>;
  }
  function addHoliday() {
    setHolidayError('');
    const end = holidayEnd || holidayStart;
    if (!validPlanDate(startDate) || !validPlanDate(holidayStart) || !validPlanDate(end) || !Number.isInteger(weeks) || weeks < 1 || weeks > 52 || end < holidayStart || holidayStart < startDate || end > outreachDate(startDate, weeks * 7 - 1)) { setHolidayError('Choose dates inside the plan, with the end on or after the start.'); return; }
    const dates: string[] = [];
    for (let date = holidayStart; date <= end && dates.length < 366; date = outreachDate(date, 1)) dates.push(date);
    onChange({ ...value, holidays: [...new Set([...value.holidays, ...dates])].sort() });
    setHolidayStart(''); setHolidayEnd('');
  }
  const data = forecast.data;
  return <div className="min-w-0 space-y-5" aria-label="Outreach planning questions">
    <div><h3 className="font-semibold">How do you want to work this farm?</h3><p className="mt-1 text-sm text-muted-foreground">A round means reaching every home once. Choose your pace and we’ll calculate the time needed.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{number('doorPasses', 'Door-knocking rounds in this plan', 12)}{number('doorsPerDay', 'Doors per working day', 1000)}{number('callPasses', 'Calling rounds in this plan', 12)}{number('callsPerDay', 'Calls per working day', 1000)}</div>
    <fieldset><legend className="mb-2 text-sm font-medium">Which days do you work?</legend><div className="flex flex-wrap gap-2">{[1,2,3,4,5,6,0].map(day => <label key={day} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${value.workingDays.includes(day) ? 'border-red-500/50 bg-red-500/10' : 'border-border'}`}><input type="checkbox" checked={value.workingDays.includes(day)} onChange={event => onChange({ ...value, workingDays: event.target.checked ? [...value.workingDays, day] : value.workingDays.filter(item => item !== day) })} className="accent-[#E33449]" />{dayLabels[day]}</label>)}</div></fieldset>
    <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Holidays & vacation dates · {value.holidays.length} dates off</summary><p className="mt-2 text-xs text-muted-foreground">Add the holidays you observe and your vacation dates. No holidays are assumed. Weekends already off aren’t counted twice.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`${prefix}-off-start`}>First day off</Label><Input id={`${prefix}-off-start`} type="date" value={holidayStart} onChange={event => setHolidayStart(event.target.value)} /></div><div><Label htmlFor={`${prefix}-off-end`}>Last day off (optional)</Label><Input id={`${prefix}-off-end`} type="date" value={holidayEnd} onChange={event => setHolidayEnd(event.target.value)} /></div></div><Button type="button" variant="outline" size="sm" className="mt-3" onClick={addHoliday}>Add time off</Button>{holidayError && <p role="alert" className="mt-2 text-sm text-destructive">{holidayError}</p>}<div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto">{value.holidays.map(date => <button type="button" key={date} onClick={() => onChange({ ...value, holidays: value.holidays.filter(item => item !== date) })} className="rounded border border-border px-2 py-1 text-xs" aria-label={`Remove day off ${date}`}>{dateLabel(date)} ×</button>)}</div></details>
    {forecast.error && <p role="alert" className="text-sm text-destructive">{forecast.error}</p>}
    {totalHomes === null && <p className="text-sm text-muted-foreground">The time estimate appears once the address count is ready.</p>}
    {data && <div className="rounded-xl border border-border bg-muted/20 p-4" aria-live="polite"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{estimated ? 'Estimate from mapped address pins' : 'Plan from eligible farm homes'}</p><div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">{[['Working days needed', data.daysNeeded.toLocaleString()], ['Working days available', data.availableDays.toLocaleString()], ['Days off excluded', data.holidaysExcluded.toLocaleString()], ['Projected finish', data.finishDate ? dateLabel(data.finishDate) : totalHomes === 0 ? 'No homes yet' : 'Beyond 10 years']].map(([label, value]) => <div key={label}><p className="text-lg font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>)}</div><p className="mt-4 text-sm">{totalHomes?.toLocaleString()} homes · {data.doorAttempts.toLocaleString()} planned door attempts · {data.callAttempts.toLocaleString()} planned calls.</p><p className={`mt-2 text-sm ${data.fits ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{data.fits ? `Fits in ${weeks} weeks with ${data.spareDays} working days to spare.` : `Needs ${Math.abs(data.spareDays)} more working days. Aim for at least ${data.minimumDoorsPerDay ?? '—'} doors and ${data.minimumCallsPerDay ?? '—'} calls per working day, or reduce rounds.`}</p><p className="mt-2 text-xs text-muted-foreground">Door and calling quotas share the same working days. Call totals are targets; only contacts with usable phone numbers can be called. Rounds run consecutively, with no assumed wait between rounds.{estimated ? ' Final assignments use imported eligible homes, which may differ from the map estimate.' : ''}</p></div>}
  </div>;
}
