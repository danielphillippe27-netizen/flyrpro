'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { eventBounds, referenceOf, type StormEvent, type StormReference, type StormHazard, type StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { StormInspectionWorklist } from './StormInspectionWorklist';
import { StormEventActivity } from './StormEventActivity';
import { StormEventMap } from './StormEventMap';
import { StormPropertyPanel } from './StormPropertyPanel';
const input='mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-xs text-white';
const dateDaysAgo=(days:number)=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
const hailSize=(mm:number)=>`${(mm/25.4).toFixed(2)} in / ${mm.toFixed(1)} mm`;
const windSpeed=(kph:number)=>`${Math.round(kph/1.609344)} mph / ${Math.round(kph)} km/h`;
const eventSource=(event:StormEvent)=>event.source==='iem'?'IEM · U.S. storm reports':'Vaisala Xweather';
type Props={map:mapboxgl.Map;workspaceId:string;onSelect:(event:StormEvent|null)=>void;onCampaign?:(context:StormCampaignContext)=>void};
export function StormIntelligencePanel({map,workspaceId,onSelect,onCampaign}:Props){
  const [view,setView]=useState<'hail'|'hurricane'|'saved'|'worklist'>('hail');
  const [hazard,setHazard]=useState<StormHazard>('hail');
  const [from,setFrom]=useState(()=>dateDaysAgo(6)),[to,setTo]=useState(()=>dateDaysAgo(0));
  const [period,setPeriod]=useState<'today'|'yesterday'|'week'|'custom'>('week');
  const [scope,setScope]=useState<'map'|'us'>('map');
  const [searched,setSearched]=useState(false);
  const [events,setEvents]=useState<StormEvent[]>([]),[selected,setSelected]=useState<StormEvent|null>(null);
  const [saved,setSaved]=useState<Array<{id:string;reference:StormReference}>>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[coverage,setCoverage]=useState('');
  const [minimum,setMinimum]=useState(0),[search,setSearch]=useState('');
  const [point,setPoint]=useState<{lon:number;lat:number}|null>(null);
  const panelRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(selected)panelRef.current?.closest('section')?.scrollTo({top:0});},[selected]);
  const requestRef=useRef<AbortController|null>(null);
  const select=useCallback((event:StormEvent|null)=>{setSelected(event);setPoint(null);onSelect(event);if(event){const b=eventBounds(event);if(b&&b[2]-b[0]<180)map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:{top:100,bottom:130,left:350,right:map.getContainer().clientWidth>1100?420:80},maxZoom:12,pitch:0,bearing:0,retainPadding:false,duration:600});}},[map,onSelect]);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  useEffect(()=>{setSelected(null);setEvents([]);setPoint(null);},[workspaceId]);
  async function load(reference?:StormReference,active=false){
    if(reference){setPeriod('custom');setFrom(reference.start.slice(0,10));setTo(reference.end.slice(0,10));setHazard(reference.hazard);}
    requestRef.current?.abort();const abort=new AbortController();requestRef.current=abort;setBusy(true);setSearched(true);setCoverage('');setSearch('');setError('');setEvents([]);select(null);
    const bounds=map.getBounds();if(!bounds){setBusy(false);return;}
    // Saved report references represent a UTC day/state. Refetch the full US
    // before selecting the same stable key, independent of the current camera.
    const bbox=(reference?.source==='iem'||(scope==='us'&&hazard!=='hurricane'))?[-180,18,-50,85]:[Math.max(-180,bounds.getWest()),Math.max(-85,bounds.getSouth()),Math.min(180,bounds.getEast()),Math.min(85,bounds.getNorth())];
    const params=new URLSearchParams({workspaceId,bbox:bbox.join(','),hazard:reference?.hazard||(view==='hurricane'?'hurricane':hazard),from:reference?.start.slice(0,10)||from,to:reference?.end.slice(0,10)||to});
    if(reference?.source==='xweather')params.set('sourceId',reference.sourceId);
    if(active)params.set('active','true');
    try{const r=await fetch(`/api/storm-maps/intelligence/events?${params}`,{signal:abort.signal});const d=await r.json();if(!r.ok)throw new Error(d.error);if(abort.signal.aborted)return;setEvents(d.events);setCoverage(d.coverage);if(reference){const found=d.events.find((e:StormEvent)=>e.key===reference.key);if(found)select(found);else setError('This saved event could not be retrieved from its source.');}}
    catch(e){if(!abort.signal.aborted)setError((e as Error).message);}finally{if(!abort.signal.aborted)setBusy(false);}
  }
  const restoredLink=useRef(false);
  useEffect(()=>{
    if(restoredLink.current)return;
    restoredLink.current=true;
    const params=new URLSearchParams(window.location.search), key=params.get('storm');
    if(!key)return;
    const start=params.get('stormFrom'),end=params.get('stormTo');
    if(!start||!end||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return;
    const source=key.startsWith('xweather:')?'xweather':key.startsWith('iem:')?'iem':null;
    if(!source)return;
    const hazard=source==='xweather'?'hurricane':key.split(':')[1];
    if(!['hail','wind','tornado','hurricane'].includes(hazard))return;
    setView(hazard==='hurricane'?'hurricane':'hail');
    void load({key,title:key,hazard:hazard as StormHazard,source,sourceId:source==='xweather'?key.slice(9):key.split(':').slice(2).join(':'),start:`${start}T00:00:00Z`,end:`${end}T23:59:59Z`});
    // Restore only once; subsequent camera/date changes belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{
    if(view!=='saved')return;const abort=new AbortController();setError('');
    fetch(`/api/storm-maps/intelligence/saved?workspaceId=${encodeURIComponent(workspaceId)}`,{signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(d=>setSaved(d.events)).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();
  },[view,workspaceId]);
  async function save(){if(!selected)return;setError('');try{const r=await fetch(`/api/storm-maps/intelligence/saved?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(referenceOf(selected))});const d=await r.json();if(!r.ok)throw new Error(d.error);setCoverage('Saved to this workspace. Source data is retrieved again when reopened.');}catch(e){setError((e as Error).message);}}
  const lookupEvent:StormEvent={key:`location-hail:${from}`,title:`Location hail lookup · ${from} UTC`,hazard:'hail',source:'xweather',sourceId:'location-lookup',start:`${from}T00:00:00Z`,end:`${from}T23:59:59Z`,features:[],reportCount:0,maxHailMM:null,maxWindKPH:null,category:null,active:false,footprintStatus:'unavailable'};
  const filtered=events.filter(e=>e.title.toLowerCase().includes(search.toLowerCase()));
  return <div ref={panelRef} className="space-y-3">
    <div className="flex gap-4 border-b border-white/10 pb-2">{([['hail','Search'],['saved','Saved storms'],['worklist','Inspections']] as const).map(([id,title])=><button key={id} onClick={()=>{requestRef.current?.abort();setBusy(false);setView(id==='hail'&&hazard==='hurricane'?'hurricane':id);setEvents([]);select(null);setCoverage('');setError('');setSearched(false);}} aria-pressed={id==='hail'?(view==='hail'||view==='hurricane'):view===id} className={`py-1 text-[11px] ${(id==='hail'?(view==='hail'||view==='hurricane'):view===id)?'font-semibold text-cyan-300':'text-slate-400'}`}>{title}</button>)}</div>
    {view==='worklist'&&<StormInspectionWorklist key={workspaceId} workspaceId={workspaceId} map={map}/>}
    {!selected&&view!=='saved'&&view!=='worklist'&&<>
      <button type="button" onClick={()=>document.querySelector<HTMLInputElement>('input[placeholder="Search an address..."]')?.focus()} className="w-full rounded-lg border border-white/15 px-3 py-2 text-left text-xs text-slate-300">Location · Search address or city ↗</button>
      <fieldset><legend className="mb-2 text-xs font-semibold">Storm type</legend><div className="grid grid-cols-4 gap-1">{(['hail','wind','tornado','hurricane'] as const).map(type=><button key={type} aria-pressed={hazard===type} onClick={()=>{requestRef.current?.abort();setBusy(false);setHazard(type);setView(type==='hurricane'?'hurricane':'hail');setEvents([]);select(null);setCoverage('');setError('');setSearched(false);}} className={`rounded-lg border px-1 py-2 text-center text-[10px] font-semibold capitalize ${hazard===type?'border-cyan-300 bg-cyan-300/10 text-cyan-200':'border-white/10 bg-white/5 text-slate-300'}`}>{type}</button>)}</div></fieldset>
      <div className="grid grid-cols-2 gap-2"><label className="text-[11px]">When<select aria-label="Storm dates" value={period} onChange={e=>{const value=e.target.value as typeof period;setPeriod(value);if(value!=='custom'){setFrom(dateDaysAgo(value==='week'?6:value==='yesterday'?1:0));setTo(dateDaysAgo(value==='yesterday'?1:0));}requestRef.current?.abort();setBusy(false);setEvents([]);select(null);setSearched(false);setCoverage('');setError('');}} className={input}><option value="today">Today (UTC)</option><option value="yesterday">Yesterday (UTC)</option><option value="week">Last 7 days</option><option value="custom">Choose dates…</option></select></label><label className="text-[11px]">Where<select aria-label="Storm search area" value={hazard==='hurricane'?'map':scope} disabled={hazard==='hurricane'} onChange={e=>setScope(e.target.value as 'map'|'us')} className={input}><option value="map">Map area</option><option value="us">All U.S. reports</option></select></label></div>
      {period==='custom'&&<div className="grid grid-cols-2 gap-2"><label className="text-[11px]">From<input aria-label="Storm history start date" type="date" value={from} onChange={e=>setFrom(e.target.value)} max={dateDaysAgo(0)} className={input}/></label><label className="text-[11px]">Through<input aria-label="Storm history end date" type="date" value={to} onChange={e=>setTo(e.target.value)} max={dateDaysAgo(0)} className={input}/></label></div>}
      <p className="text-[10px] text-slate-400">{from===to?from:`${from} – ${to}`} · UTC{period==='custom'?' · Up to 31 days per search':''}</p>
      <button disabled={busy} onClick={()=>void load()} className="w-full rounded-xl bg-cyan-300 py-3 text-xs font-semibold text-slate-950 disabled:opacity-40">{busy?'Finding storms…':'Find storms'}</button>
      <p className="text-[10px] text-slate-400">{hazard==='hurricane'?'Search past tracks near the map, or find active storms worldwide.':scope==='us'?'Find recent reports across the U.S.':'Use Search address to move the map, then find U.S. storm reports.'}</p>
      {view==='hurricane'&&<button disabled={busy} onClick={()=>void load(undefined,true)} className="w-full rounded-lg border border-white/15 py-2 text-xs">Find active hurricanes worldwide</button>}
    </>}
    {!selected&&view==='saved'&&<div className="space-y-2">{saved.map(s=><button key={s.id} onClick={()=>void load(s.reference)} className="w-full rounded-xl border border-white/15 p-3 text-left text-xs">{s.reference.title}</button>)}{!saved.length&&!error&&<p className="text-xs text-slate-400">Save an event to revisit it here.</p>}</div>}
    {error&&<p role="alert" className="rounded-lg border border-amber-300/25 p-2 text-xs text-amber-200">{error}</p>}
    {coverage&&<details className="text-[10px] text-slate-400"><summary className="cursor-pointer">Source & coverage</summary><p className="mt-2 leading-relaxed">{coverage}</p></details>}
    {!selected&&!!events.length&&<><p className="text-xs font-semibold">{events.length} storm {events.length===1?'result':'results'} · Choose one to view</p><input aria-label="Filter storm results" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by name, state or date…" className={input}/><div className="space-y-2">{filtered.map(event=><button key={event.key} onClick={()=>select(event)} aria-pressed={selected?.key===event.key} className={`w-full rounded-xl border p-3 text-left ${selected?.key===event.key?'border-cyan-300 bg-cyan-300/10':'border-white/10 bg-white/5'}`}><p className="text-xs font-semibold">{event.title}</p><p className="mt-1 text-[10px] text-slate-400">{event.maxHailMM!=null?`Max reported ${hailSize(event.maxHailMM)} · `:''}{event.category?`${event.category} · `:''}{event.maxWindKPH!=null?`${windSpeed(event.maxWindKPH)} · `:''}{event.hazard==='hurricane'?'Advisory track':`${event.reportCount} ${event.reportCount===1?'report':'reports'} in search region`}</p><p className="mt-1 text-[9px] text-slate-500">{eventSource(event)}</p></button>)}</div></>}
    {searched&&!busy&&!events.length&&!error&&<p className="text-xs">No matching events returned. Coverage is incomplete; this does not establish no storms.</p>}
    {!selected && view==='hail' && hazard==='hail' && /^\d{4}-\d{2}-\d{2}$/.test(from) && <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs">Check hail at a Canadian address</summary><p className="mt-2 text-[10px] text-slate-400">Click a map location to check hail on {from} (UTC). Regional report search covers the U.S.</p><StormPropertyPanel key={`lookup:${from}`} workspaceId={workspaceId} event={lookupEvent} point={point}/></details>}
    {selected&&<div className="space-y-3"><button onClick={()=>select(null)} className="text-xs text-cyan-200">← Back to results</button><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-200">{selected.active?'Active storm · includes forecast':'Past storm'}</p><p className="text-sm font-semibold">{selected.title}</p><p className="mt-1 text-[10px] text-slate-400">{selected.start.slice(0,10)}{selected.start.slice(0,10)!==selected.end.slice(0,10)?` – ${selected.end.slice(0,10)}`:''} · UTC</p></div>
    <p className="text-[11px] text-cyan-200">{selected.maxHailMM!=null?`Largest reported hail: ${hailSize(selected.maxHailMM)}`:selected.maxWindKPH!=null?`${selected.hazard==='hurricane'?'Sustained wind':'Maximum reported wind'}: ${windSpeed(selected.maxWindKPH)}`:selected.category||'Severity unavailable'}<span className="mt-1 block text-[10px] text-slate-400">{eventSource(selected)}</span></p>
    {onCampaign&&<button onClick={()=>onCampaign({version:1,event:referenceOf(selected),selectedAt:new Date().toISOString(),minimumHailMM:selected.hazard==='hail'?minimum:null,selection:'user-drawn',evidenceKind:selected.hazard==='hurricane'?'track':'reports'})} className="w-full rounded-lg bg-red-500 py-3 text-xs font-semibold">Create campaign</button>}<p className="text-[10px] text-slate-400">Draw the neighborhood you want to work. The storm stays visible.</p>
    <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs">Storm details & sharing</summary><div className="mt-3 space-y-3">
    {selected.hazard==='hail'&&<p className="text-[10px] text-violet-200">{Date.parse(selected.start)>=Date.now()-7*86400000?'Recent U.S. event: maximum hail-size shading is loaded for this UTC day. The filter below applies to report points only.':'Regional hail-size shading is outside the rolling seven-day map window. Historical report points and location lookups remain available.'}</p>}
    {selected.hazard==='hail'&&<label className="block text-[11px]">Minimum reported hail size<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))} className={input}>{[[0,'All sizes'],[25.4,'25.4 mm / 1 inch'],[38.1,'38.1 mm / 1.5 inches'],[50.8,'50.8 mm / 2 inches']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
    <p className="rounded-lg bg-amber-300/10 p-2 text-[10px] leading-relaxed text-amber-200">{selected.hazard==='hurricane'?'The line shows the cyclone centre track; amber marks forecast positions. No verified wind-damage footprint is supplied here.':'Points are individual observations. They are not a continuous hail swath or proof of damage to nearby homes.'}</p>
    <div className="grid grid-cols-2 gap-2"><button onClick={save} className="rounded-lg border border-white/15 py-2 text-xs">Save storm</button><button onClick={()=>{const url=new URL(window.location.href);url.searchParams.set('storm',selected.key);url.searchParams.set('stormFrom',selected.start.slice(0,10));url.searchParams.set('stormTo',selected.end.slice(0,10));navigator.clipboard.writeText(url.toString()).then(()=>setCoverage('Storm reference link copied.')).catch(()=>setError('Could not copy link.'));}} className="rounded-lg border border-white/15 py-2 text-xs">Copy reference link</button></div>

    </div></details><details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs">Campaign activity</summary><div className="mt-3"><StormEventActivity workspaceId={workspaceId} eventKey={selected.key}/></div></details>
    <StormPropertyPanel key={selected.key} workspaceId={workspaceId} event={selected} point={point}/></div>}
    <StormEventMap map={map} event={selected} minimumHailMM={minimum} onLocation={setPoint}/>
  </div>;
}
