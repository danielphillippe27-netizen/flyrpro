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
type Props={map:mapboxgl.Map;workspaceId:string;onSelect:(event:StormEvent|null)=>void;onCampaign?:(context:StormCampaignContext)=>void};
export function StormIntelligencePanel({map,workspaceId,onSelect,onCampaign}:Props){
  const [view,setView]=useState<'hail'|'hurricane'|'saved'|'worklist'>('hail');
  const [hazard,setHazard]=useState<StormHazard>('hail');
  const [from,setFrom]=useState(()=>dateDaysAgo(6)),[to,setTo]=useState(()=>dateDaysAgo(0));
  const [period,setPeriod]=useState<'today'|'yesterday'|'week'|'custom'>('week');
  const [searched,setSearched]=useState(false);
  const [events,setEvents]=useState<StormEvent[]>([]),[selected,setSelected]=useState<StormEvent|null>(null);
  const [saved,setSaved]=useState<Array<{id:string;reference:StormReference}>>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[coverage,setCoverage]=useState('');
  const [minimum,setMinimum]=useState(0),[search,setSearch]=useState('');
  const [point,setPoint]=useState<{lon:number;lat:number}|null>(null);
  const requestRef=useRef<AbortController|null>(null);
  const select=useCallback((event:StormEvent|null)=>{setSelected(event);setPoint(null);onSelect(event);if(event){const b=eventBounds(event);if(b&&b[2]-b[0]<180)map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:{top:100,bottom:130,left:350,right:map.getContainer().clientWidth>1100?420:80},maxZoom:9,duration:600});}},[map,onSelect]);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  useEffect(()=>{setSelected(null);setEvents([]);setPoint(null);},[workspaceId]);
  async function load(reference?:StormReference,active=false){
    if(reference){setPeriod('custom');setFrom(reference.start.slice(0,10));setTo(reference.end.slice(0,10));setHazard(reference.hazard);}
    requestRef.current?.abort();const abort=new AbortController();requestRef.current=abort;setBusy(true);setSearched(true);setCoverage('');setSearch('');setError('');setEvents([]);select(null);
    const bounds=map.getBounds();if(!bounds){setBusy(false);return;}
    // Saved report references represent a UTC day/state. Refetch the full US
    // before selecting the same stable key, independent of the current camera.
    const bbox=reference?.source==='iem'?[-180,18,-50,85]:[Math.max(-180,bounds.getWest()),Math.max(-85,bounds.getSouth()),Math.min(180,bounds.getEast()),Math.min(85,bounds.getNorth())];
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
  return <div className="space-y-3">
    <div className="flex gap-4 border-b border-white/10 pb-2">{([['hail','Search'],['saved','Saved storms'],['worklist','Inspections']] as const).map(([id,title])=><button key={id} onClick={()=>{requestRef.current?.abort();setBusy(false);setView(id==='hail'&&hazard==='hurricane'?'hurricane':id);setEvents([]);select(null);setCoverage('');setError('');setSearched(false);}} aria-pressed={id==='hail'?(view==='hail'||view==='hurricane'):view===id} className={`py-1 text-[11px] ${(id==='hail'?(view==='hail'||view==='hurricane'):view===id)?'font-semibold text-cyan-300':'text-slate-400'}`}>{title}</button>)}</div>
    {view==='worklist'&&<StormInspectionWorklist key={workspaceId} workspaceId={workspaceId} map={map}/>}
    {view!=='saved'&&view!=='worklist'&&<>
      <fieldset><legend className="mb-2 text-xs font-semibold">Storm type</legend><div className="grid grid-cols-2 gap-2">{(['hail','wind','tornado','hurricane'] as const).map(type=><button key={type} aria-pressed={hazard===type} onClick={()=>{requestRef.current?.abort();setBusy(false);setHazard(type);setView(type==='hurricane'?'hurricane':'hail');setEvents([]);select(null);setCoverage('');setError('');setSearched(false);}} className={`rounded-xl border px-3 py-3 text-left text-xs font-semibold capitalize ${hazard===type?'border-cyan-300 bg-cyan-300/10 text-cyan-200':'border-white/10 bg-white/5 text-slate-300'}`}>{type}<span className="mt-1 block text-[10px] font-normal normal-case text-slate-400">{type==='hail'?'Size & reports':type==='hurricane'?'Storm tracks':'Reported events'}</span></button>)}</div></fieldset>
      <fieldset><legend className="mb-2 text-xs font-semibold">When?</legend><div className="grid grid-cols-2 gap-2">{([['today','Today',0],['yesterday','Yesterday',1],['week','Last 7 days',6],['custom','Choose dates',0]] as const).map(([id,label,days])=><button key={id} aria-pressed={period===id} onClick={()=>{setPeriod(id);if(id!=='custom'){setFrom(dateDaysAgo(days));setTo(dateDaysAgo(id==='yesterday'?1:0));}requestRef.current?.abort();setBusy(false);setEvents([]);select(null);setCoverage('');setError('');setSearched(false);}} className={`rounded-lg border py-2 text-[11px] ${period===id?'border-cyan-300/50 bg-cyan-300/10 text-cyan-200':'border-white/10 text-slate-300'}`}>{label}</button>)}</div></fieldset>
      {period==='custom'&&<div className="grid grid-cols-2 gap-2"><label className="text-[11px]">From<input aria-label="Storm history start date" type="date" value={from} onChange={e=>setFrom(e.target.value)} max={dateDaysAgo(0)} className={input}/></label><label className="text-[11px]">Through<input aria-label="Storm history end date" type="date" value={to} onChange={e=>setTo(e.target.value)} max={dateDaysAgo(0)} className={input}/></label></div>}
      <p className="text-[10px] text-slate-400">{from===to?from:`${from} – ${to}`} · UTC{period==='custom'?' · Up to 31 days per search':''}</p>
      <button disabled={busy} onClick={()=>void load()} className="w-full rounded-xl bg-cyan-300 py-3 text-xs font-semibold text-slate-950 disabled:opacity-40">{busy?'Finding storms…':'Find storms in this area'}</button>
      <p className="text-[10px] text-slate-400">{hazard==='hurricane'?'Search past tracks near the map, or find active storms worldwide.':'Move the map to your area, then search U.S. storm reports.'}</p>
      {view==='hurricane'&&<button disabled={busy} onClick={()=>void load(undefined,true)} className="w-full rounded-lg border border-white/15 py-2 text-xs">Find active hurricanes worldwide</button>}
    </>}
    {view==='saved'&&<div className="space-y-2">{saved.map(s=><button key={s.id} onClick={()=>void load(s.reference)} className="w-full rounded-xl border border-white/15 p-3 text-left text-xs">{s.reference.title}</button>)}{!saved.length&&!error&&<p className="text-xs text-slate-400">Save an event to revisit it here.</p>}</div>}
    {error&&<p role="alert" className="rounded-lg border border-amber-300/25 p-2 text-xs text-amber-200">{error}</p>}
    {coverage&&<details className="text-[10px] text-slate-400"><summary className="cursor-pointer">Source & coverage</summary><p className="mt-2 leading-relaxed">{coverage}</p></details>}
    {!!events.length&&<><p className="text-xs font-semibold">{events.length} storm {events.length===1?'result':'results'} · Choose one to view</p><input aria-label="Filter storm results" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by name, state or date…" className={input}/><div className="max-h-56 space-y-2 overflow-auto">{filtered.map(event=><button key={event.key} onClick={()=>select(event)} aria-pressed={selected?.key===event.key} className={`w-full rounded-xl border p-3 text-left ${selected?.key===event.key?'border-cyan-300 bg-cyan-300/10':'border-white/10 bg-white/5'}`}><p className="text-xs font-semibold">{event.title}</p><p className="mt-1 text-[10px] text-slate-400">{event.maxHailMM!=null?`Max reported ${event.maxHailMM.toFixed(1)} mm · `:''}{event.category?`${event.category} · `:''}{event.maxWindKPH!=null?`${event.maxWindKPH} km/h · `:''}{event.hazard==='hurricane'?'Advisory track':`${event.reportCount} reports in search region`}</p></button>)}</div></>}
    {searched&&!busy&&!events.length&&!error&&<p className="text-xs">No matching events returned. Coverage is incomplete; this does not establish no storms.</p>}
    {!selected && view==='hail' && hazard==='hail' && /^\d{4}-\d{2}-\d{2}$/.test(from) && <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-xs">Check hail at a Canadian address</summary><p className="mt-2 text-[10px] text-slate-400">Click a map location to check hail on {from} (UTC). Regional report search covers the U.S.</p><StormPropertyPanel key={`lookup:${from}`} workspaceId={workspaceId} event={lookupEvent} point={point}/></details>}
    {selected&&<div className="space-y-3 border-t border-white/15 pt-3"><div><p className="text-sm font-semibold">{selected.title}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(selected.start).toLocaleString()} – {new Date(selected.end).toLocaleString()}</p></div>
    {selected.hazard==='hail'&&<p className="text-[10px] text-violet-200">{Date.parse(selected.start)>=Date.now()-7*86400000?'Recent U.S. event: maximum hail-size shading is loaded for this UTC day. The filter below applies to report points only.':'Regional hail-size shading is outside the rolling seven-day map window. Historical report points and location lookups remain available.'}</p>}
    {selected.hazard==='hail'&&<label className="block text-[11px]">Minimum reported hail size<select value={minimum} onChange={e=>setMinimum(Number(e.target.value))} className={input}>{[[0,'All sizes'],[25.4,'25.4 mm / 1 inch'],[38.1,'38.1 mm / 1.5 inches'],[50.8,'50.8 mm / 2 inches']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>}
    <p className="rounded-lg bg-amber-300/10 p-2 text-[10px] leading-relaxed text-amber-200">{selected.hazard==='hurricane'?'The line shows the cyclone centre track; amber marks forecast positions. No verified wind-damage footprint is supplied here.':'Points are individual observations. They are not a continuous hail swath or proof of damage to nearby homes.'}</p>
    <div className="grid grid-cols-2 gap-2"><button onClick={save} className="rounded-lg border border-white/15 py-2 text-xs">Save storm</button><button onClick={()=>{const url=new URL(window.location.href);url.searchParams.set('storm',selected.key);url.searchParams.set('stormFrom',selected.start.slice(0,10));url.searchParams.set('stormTo',selected.end.slice(0,10));navigator.clipboard.writeText(url.toString()).then(()=>setCoverage('Storm reference link copied.')).catch(()=>setError('Could not copy link.'));}} className="rounded-lg border border-white/15 py-2 text-xs">Copy reference link</button></div>
    {onCampaign&&<button onClick={()=>onCampaign({version:1,event:referenceOf(selected),selectedAt:new Date().toISOString(),minimumHailMM:selected.hazard==='hail'?minimum:null,selection:'user-drawn',evidenceKind:selected.hazard==='hurricane'?'track':'reports'})} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold">Draw campaign for this storm</button>}
    <StormEventActivity workspaceId={workspaceId} eventKey={selected.key}/>
    <StormPropertyPanel key={selected.key} workspaceId={workspaceId} event={selected} point={point}/></div>}
    <StormEventMap map={map} event={selected} minimumHailMM={minimum} onLocation={setPoint}/>
  </div>;
}
