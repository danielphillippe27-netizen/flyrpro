'use client';
import { useContext, useEffect, useState } from 'react';
import { StormCountryContext } from '@/lib/storm-maps/storm-country-context';
import { WIND_COUNTRIES, type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { Settings2, X } from 'lucide-react';
import { StormTimelineRange } from './StormTimelineRange';
import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';
type Range = { start: Date; end: Date };
const localDate = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0,16);
};
export function StormTimelineSettings({ range, duration, settings, onChange, onRange, onSpeed }: {
  range: Range; duration: number; settings: StormGLSettings; onChange: (settings: StormGLSettings) => void;
  onRange: (range: Range) => void; onSpeed: (duration: number) => void;
}) {
  const countryFilter = useContext(StormCountryContext);
  const mode = settings.mode;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({start: localDate(range.start), end: localDate(range.end)});
  useEffect(() => { setDraft({start: localDate(range.start), end: localDate(range.end)}); }, [range.start, range.end]);
  const [error, setError] = useState('');
  const show = () => { setDraft({start: localDate(range.start), end: localDate(range.end)}); setError(''); setOpen(value => !value); };
  const shift = (key: 'start' | 'end', hours: number) => {
    const date = new Date(draft[key]);
    if (!Number.isFinite(+date)) { setError('Choose a valid date first.'); return; }
    setDraft(previous => ({...previous, [key]: localDate(new Date(+date + hours * 3600000))}));
    setError('');
  };
  const apply = () => {
    const start = new Date(draft.start), end = new Date(draft.end), now = Date.now();
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || +start >= +end) { setError('Start must be before end.'); return; }
    if (+start < now - 7 * 86400000 || +end > now + 24 * 3600000 || +end - +start > 7 * 86400000) { setError('Choose a range within the past 7 days and next 24 hours, up to 7 days long.'); return; }
    if (mode === 'history' && +end > now) { setError('Past map must end at or before now.'); return; }
    if (mode === 'forecast' && +start < now - 60000) { setError('Forecast must start at or after now. Switch to Past map for history.'); return; }
    onRange({start,end}); setOpen(false);
  };
  return <div className="relative shrink-0">
    <button type="button" aria-label="Timeline settings" aria-expanded={open} onClick={show} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-900/5 dark:hover:bg-white/10"><Settings2 className="h-5 w-5" /></button>
    {open && <section aria-label="Timeline settings" className="absolute right-0 top-full mt-3 z-50 max-h-[calc(100dvh-12rem)] w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-2xl" style={{overscrollBehavior:'contain'}}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Timeline</h2><button type="button" aria-label="Close timeline settings" onClick={()=>setOpen(false)} className="rounded-full bg-slate-100 p-2"><X className="h-4 w-4" /></button></div>
      {countryFilter && <label className="mb-5 block text-sm font-semibold">Country
        <select aria-label="Storm country" value={countryFilter.country} onChange={event => countryFilter.setCountry(event.target.value as WindCountry)} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2 text-base text-slate-900">
          {(['CA', 'US', 'AU'] as const).map(code => <option key={code} value={code}>{WIND_COUNTRIES[code].name}</option>)}
        </select>
      </label>}
      <h3 className="mb-2 text-base font-semibold">Weather mode</h3>
      <StormTimelineRange settings={settings} onChange={onChange} />
      <h3 className="mb-3 text-base font-semibold">Date range</h3>
      {(['start','end'] as const).map(key=><div key={key} className="mb-4">
        <label className="block text-sm font-semibold capitalize">{key}<input aria-label={key==='start'?'Timeline start':'Timeline end'} type="datetime-local" value={draft[key]} onChange={event=>{setDraft(previous=>({...previous,[key]:event.target.value}));setError('');}} className="mt-1 block w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900" /></label>
        <div className="mt-2 grid grid-cols-4 gap-1">{[-24,-1,1,24].map(hours=><button key={hours} type="button" aria-label={key+' '+(hours>0?'+':'')+hours+' hours'} onClick={()=>shift(key,hours)} className="rounded border border-slate-300 py-2 text-xs hover:bg-slate-100">{hours>0?'+':'−'}{Math.abs(hours)===24?'1 day':'1 hour'}</button>)}</div>
      </div>)}
      <p className="mb-3 text-xs text-slate-500">Times use your local timezone. Available history varies by layer; unavailable dates may show no data.</p>
      {error&&<p role="alert" className="mb-3 text-xs text-red-700">{error}</p>}
      <button type="button" onClick={apply} className="mb-4 w-full rounded-lg bg-[#0c202c] py-2 text-sm font-semibold text-white">Apply date range</button>
      <h3 className="mb-2 border-t pt-3 text-base font-semibold">Animation speed</h3>
      <div className="grid grid-cols-4 gap-2">{[0.25,0.5,1,2].map(speed=><button key={speed} type="button" aria-pressed={duration===12/speed} onClick={()=>onSpeed(12/speed)} className={'rounded-lg border py-2 text-sm '+(duration===12/speed?'bg-[#0c202c] text-white':'border-slate-300')}>{speed}×</button>)}</div>
    </section>}
  </div>;
}
