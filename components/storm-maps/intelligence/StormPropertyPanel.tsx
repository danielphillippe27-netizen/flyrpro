'use client';
import { useEffect, useRef, useState } from 'react';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';
type Period={dateTimeISO:string;maxSizeMM:number|null};
type Inspection={id:string;property_label:string;outcome:string;notes:string;observed_at:string};
const input='w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-xs text-white';
export function StormPropertyPanel({workspaceId,event,point}:{workspaceId:string;event:StormEvent;point:{lon:number;lat:number}|null}){
  const [date,setDate]=useState(event.start.slice(0,10));
  const [periods,setPeriods]=useState<Period[]|null>(null);
  const lookupRequest=useRef<AbortController|null>(null);
  const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const [label,setLabel]=useState('');const [notes,setNotes]=useState('');const [outcome,setOutcome]=useState('pending');
  const [inspections,setInspections]=useState<Inspection[]>([]);const [revision,setRevision]=useState(0);
  const [inspectionError,setInspectionError]=useState('');
  useEffect(()=>{lookupRequest.current?.abort();setBusy(false);setPeriods(null);setMessage('');setLabel('');setNotes('');setOutcome('pending');return()=>lookupRequest.current?.abort();},[point]);
  useEffect(()=>{
    const abort=new AbortController();
    fetch(`/api/storm-maps/intelligence/inspections?workspaceId=${encodeURIComponent(workspaceId)}&eventKey=${encodeURIComponent(event.key)}`,{signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(d=>{setInspections(d.inspections);setInspectionError('');}).catch(e=>{if(!abort.signal.aborted)setInspectionError(e.message);});
    return()=>abort.abort();
  },[workspaceId,event.key,revision]);
  useEffect(()=>{lookupRequest.current?.abort();setBusy(false);setPeriods(null);setMessage('');},[date]);
  async function lookup(){
    if(!point)return;lookupRequest.current?.abort();const abort=new AbortController();lookupRequest.current=abort;setBusy(true);setMessage('');setPeriods(null);
    try{const r=await fetch(`/api/storm-maps/intelligence/hail?workspaceId=${encodeURIComponent(workspaceId)}&lat=${point.lat}&lon=${point.lon}&date=${date}`,{signal:abort.signal});const d=await r.json();if(!r.ok)throw new Error(d.error);if(abort.signal.aborted)return;setPeriods(d.periods);setMessage(d.coverage==='unavailable'?'No archive data returned for this location/date. This does not establish no hail.':d.message);}catch(e){if(!abort.signal.aborted)setMessage((e as Error).message);}finally{if(!abort.signal.aborted)setBusy(false);}
  }
  async function save(){
    if(!point)return;setBusy(true);setMessage('');
    try{const r=await fetch(`/api/storm-maps/intelligence/inspections?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_key:event.key,longitude:point.lon,latitude:point.lat,property_label:label,outcome,notes})});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage('Inspection saved to this storm.');setRevision(v=>v+1);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  function exportSummary(){
    if(!point)return;
    const body=['WOLFGRID · Property Storm Summary',label||`Location: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`,event.title,`Source: ${event.source}`,`Event: ${event.start} – ${event.end}`,`Hail lookup UTC day: ${date}`,periods?.length?`Maximum returned hail estimate: ${Math.max(...periods.flatMap(p=>p.maxSizeMM==null?[]:[p.maxSizeMM]),0).toFixed(1)} mm`:'No location hail lookup included.',`User inspection: ${outcome.replaceAll('_',' ')}`,notes,'Weather estimates identify exposure, not confirmed property damage. User inspection findings are separate from provider data. This is not a certified meteorological report.'].join('\n\n');
    const url=URL.createObjectURL(new Blob([body],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='wolfgrid-storm-summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <details className="rounded-xl border border-white/10 p-3" open={Boolean(point)}><summary className="cursor-pointer text-xs font-semibold">Property history & inspections</summary><p className="mt-2 text-[11px] text-slate-400">Select a location on the map. A map point is not a verified address.</p>
    {point&&<div className="mt-3 space-y-2"><p className="text-[11px] text-cyan-200">{point.lat.toFixed(5)}, {point.lon.toFixed(5)}</p><label className="block text-[11px]">Hail archive date (UTC)<input type="date" value={date} max={new Date().toISOString().slice(0,10)} onChange={e=>setDate(e.target.value)} className={input}/></label><button disabled={busy} onClick={lookup} className="w-full rounded-lg border border-cyan-300/30 p-2 text-xs text-cyan-200 disabled:opacity-40">{busy?'Working…':'Look up historical hail here'}</button>
    {periods&&periods.length>0&&<p className="text-xs">{periods.some(p=>p.maxSizeMM!=null)?`Maximum returned estimate: ${Math.max(...periods.flatMap(p=>p.maxSizeMM==null?[]:[p.maxSizeMM])).toFixed(1)} mm`:'Hail size unavailable'} · {periods.length} hourly records</p>}
    <input aria-label="Property address or label" placeholder="Address or property label" value={label} onChange={e=>setLabel(e.target.value)} maxLength={200} className={input}/><select aria-label="Inspection outcome" value={outcome} onChange={e=>setOutcome(e.target.value)} className={input}>{['pending','damage_observed','no_damage_observed','follow_up','do_not_knock'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select><textarea aria-label="Inspection notes" placeholder="Inspection notes" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={4000} className={input}/><div className="grid grid-cols-2 gap-2"><button disabled={busy||!label.trim()} onClick={save} className="rounded-lg bg-cyan-300 p-2 text-xs font-semibold text-slate-950 disabled:opacity-40">Save inspection</button><button onClick={exportSummary} className="rounded-lg border border-white/15 p-2 text-xs">Export summary</button></div></div>}
    {message&&<p role="status" className="mt-2 text-[11px] text-amber-200">{message}</p>}{inspectionError&&<p className="mt-2 text-[11px] text-amber-200">{inspectionError}</p>}
    {!!inspections.length&&<div className="mt-3 space-y-2"><p className="text-[10px] text-slate-400">Recent inspections for this event</p>{inspections.slice(0,6).map(i=><div key={i.id} className="border-t border-white/10 pt-2 text-[11px]"><p>{i.property_label} · {i.outcome.replaceAll('_',' ')}</p><p className="text-slate-400">{new Date(i.observed_at).toLocaleString()}</p></div>)}</div>}
  </details>;
}
