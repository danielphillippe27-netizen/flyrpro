'use client';
import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { DEFAULT_WIND_STORM_MINIMUM, type WindStormDay } from '@/lib/storm-maps/intelligence/storm-browser';
import { WIND_COUNTRIES, type WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import type { StormWindActions } from '../StormWorkbenchView';
import type { SaveWindTerritory } from './WindZoneSelector';
import { WindStormArchive } from './WindStormArchive';
export function RecentWindStorms({map,workspaceId,country,onView,active,onSave,windActions}:{map:mapboxgl.Map;workspaceId:string;country:WindCountry;onView:()=>void;active:boolean;onSave:SaveWindTerritory;windActions?:StormWindActions}){
  const [minimum,setMinimum]=useState(()=>{const q=new URLSearchParams(window.location.search),value=Number(q.get('minimum'));return q.get('windTime')&&q.get('country')===country&&[40,60,93.341952,120,160].includes(value)?value:DEFAULT_WIND_STORM_MINIMUM;});
  const [anchor]=useState(()=>{const value=new URLSearchParams(window.location.search).get('windTime'),parsed=Date.parse(value??'');return Number.isFinite(parsed)&&parsed<=Date.now()&&parsed<Date.now()-29*86400000?new Date(parsed):new Date();});
  const pageDate=(offset:number)=>new Date(+anchor-offset*86400000).toISOString().slice(0,10);
  const [regionsByTime,setRegionsByTime]=useState<Record<string,string[]>>({});
  const [days,setDays]=useState<WindStormDay[]>([]),[selected,setSelected]=useState(''),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[starts,setStarts]=useState<string|null>(null),[pending,setPending]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);setError('');
    const query=new URLSearchParams({workspaceId,country,minimum:String(minimum),from:new Date(+anchor-(30*(page+1)-1)*86400000).toISOString().slice(0,10),to:new Date(+anchor-30*page*86400000).toISOString().slice(0,10)});
    fetch(`/api/storm-maps/intelligence/wind?${query}`,{signal:abort.signal,cache:'no-store'}).then(async response=>{
      const data=await response.json();if(!response.ok)throw Error(data.error||'Recent wind maps are unavailable.');
      if(abort.signal.aborted)return;
      setDays(previous=>[...new Map([...(page?previous:[]),...data.days].map((day:WindStormDay)=>[day.date,day])).values()].sort((a,b)=>b.date.localeCompare(a.date)));
      setRegionsByTime(previous=>({...previous,...data.regionsByTime}));setStarts(data.archiveStartsAt);setPending(data.indexingPending);
      if(!page){const requested=new URLSearchParams(window.location.search).get('windTime');setSelected(current=>data.times.includes(current)?current:requested&&data.times.includes(requested)?requested:'');}
    }).catch(reason=>{if(!abort.signal.aborted)setError(reason instanceof Error?reason.message:'Recent wind maps are unavailable.');}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[workspaceId,country,page,refresh,minimum,anchor]);
  const selectedDay=days.find(day=>day.date===selected.slice(0,10));
  return <section aria-label="Recent wind storms" className="space-y-3">
    <p className="text-sm font-semibold">Recent wind maps · {WIND_COUNTRIES[country].name}</p>
    <p className="text-xs text-muted-foreground">Gusts of {Math.round(minimum)} km/h / {Math.round(minimum/1.609344)} mph and stronger. Choose a day to open its strongest saved hour.</p>
    {error&&<p role="alert" className="text-xs text-amber-700 dark:text-amber-200">{error}</p>}
    {!selectedDay&&days.map(day=><button type="button" key={day.date} aria-pressed={selected.slice(0,10)===day.date} onClick={()=>setSelected(day.peakTime)} className="block min-h-11 w-full rounded-lg border border-border px-3 py-3 text-left text-sm aria-pressed:bg-muted"><span className="font-semibold">{day.date} · Wind</span><span className="mt-1 block text-xs">{day.regions?.length?`${country==='CA'?'Provinces / territories':'States / territories'}: ${day.regions.join(', ')}`:'Location being indexed'}</span><span className="mt-1 block text-xs">Up to {Math.round(day.maximumKPH)} km/h estimated · {day.hours} saved {day.hours===1?'hour':'hours'}</span></button>)}
    {busy&&<p role="status" className="text-xs">Loading recent wind maps…</p>}
    {!busy&&!error&&!days.length&&<p className="text-xs">{pending?'Saved wind hours are still being checked. Refresh shortly.':'No saved wind areas above the selected wind level were found for this interval. Missing data does not establish no storms.'}</p>}
    {selectedDay&&<button type="button" onClick={()=>{setSelected('');setMinimum(DEFAULT_WIND_STORM_MINIMUM);const query=new URLSearchParams(window.location.search);query.delete('windTime');query.delete('minimum');window.history.replaceState(window.history.state,'',`${window.location.pathname}?${query}`);}} className="min-h-11 text-sm text-primary">← Recent wind maps</button>}
    {selectedDay&&<WindStormArchive key={`${country}:${selected}`} simple selectedRegions={regionsByTime[selected]} selectedMinimum={minimum} selectedCountry={country} selectedTime={selected} map={map} workspaceId={workspaceId} onView={onView} active={active} onSave={onSave} windActions={windActions}/>}
    {starts&&pageDate(30*(page+1)-1)>starts.slice(0,10)&&<button type="button" disabled={busy} onClick={()=>setPage(value=>value+1)} className="min-h-11 w-full rounded-lg border border-border text-sm">Older wind maps</button>}
    <button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)} className="min-h-11 w-full rounded-lg border border-border text-sm">Refresh wind maps</button>
    <p className="text-[11px] text-muted-foreground">Daily summaries of wind estimates over the selected country’s land. They are not counts of distinct storms or confirmed property damage.</p>
  </section>;
}
