'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { InspectionRecord } from '@/lib/storm-maps/intelligence/territory-review';
const filters=[['follow_up','Follow-up'],['pending','Pending'],['do_not_knock','Do not knock'],['all','All']] as const;
export function StormInspectionWorklist({workspaceId,map}:{workspaceId:string;map:mapboxgl.Map}) {
  const marker=useRef<mapboxgl.Marker|null>(null);
  useEffect(()=>()=>{marker.current?.remove();marker.current=null;},[map,workspaceId]);
  function focus(row:InspectionRecord) {
    marker.current?.remove();
    marker.current=new mapboxgl.Marker({color:row.outcome==='do_not_knock'?'#f87171':'#67e8f9'}).setLngLat([row.longitude,row.latitude]).addTo(map);
    map.flyTo({center:[row.longitude,row.latitude],zoom:17});
  }
  const [rows,setRows]=useState<InspectionRecord[]>([]);
  const [filter,setFilter]=useState('follow_up');
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[truncated,setTruncated]=useState(false);
  const [revision,setRevision]=useState(0);
  const [editing,setEditing]=useState<InspectionRecord|null>(null);
  const [outcome,setOutcome]=useState('pending'),[notes,setNotes]=useState('');
  const [saving,setSaving]=useState(false),[saveMessage,setSaveMessage]=useState('');
  async function saveObservation() {
    if (!editing) return;
    setSaving(true);setSaveMessage('');
    try {
      const response=await fetch(`/api/storm-maps/intelligence/inspections?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_key:editing.event_key,longitude:editing.longitude,latitude:editing.latitude,property_label:editing.property_label,outcome,notes})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setEditing(null);setSaveMessage('New observation saved. Earlier entries remain in history.');setRevision(v=>v+1);
    } catch(e) {setSaveMessage((e as Error).message);} finally {setSaving(false);}
  }
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);setError('');setRows([]);
    fetch(`/api/storm-maps/intelligence/worklist?workspaceId=${encodeURIComponent(workspaceId)}`,{signal:abort.signal})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);return data;})
      .then(data=>{if(!abort.signal.aborted){setRows(data.inspections);setTruncated(data.truncated);}})
      .catch(e=>{if(!abort.signal.aborted)setError(e.message);})
      .finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[workspaceId,revision]);
  const filtered=rows.filter(row=>(filter==='all'||row.outcome===filter)&&`${row.property_label} ${row.notes}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Storm inspection worklist" className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Inspection worklist</h3><button type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)} className="text-xs text-cyan-200 underline disabled:opacity-50">Refresh</button></div>
    <p className="text-[11px] text-slate-400">Workspace observations across storms. Latest entry for each exact map point and property label; these are not verified parcel matches.</p>
    <div className="grid grid-cols-2 gap-1">{filters.map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)} className={`rounded-lg border p-2 text-xs ${filter===value?'border-cyan-300 bg-cyan-300/10 text-cyan-100':'border-white/10 text-slate-300'}`}>{label}</button>)}</div>
    {saveMessage&&<p role="status" className="text-xs text-cyan-200">{saveMessage}</p>}
    {editing&&<form onSubmit={e=>{e.preventDefault();void saveObservation();}} className="space-y-2 rounded-xl border border-cyan-300/30 p-3">
      <p className="text-xs font-semibold">Update {editing.property_label||'recorded location'}</p>
      <label className="block text-xs">Outcome<select aria-label="Updated inspection outcome" disabled={saving} value={outcome} onChange={e=>setOutcome(e.target.value)} className="mt-1 w-full rounded bg-slate-900 p-2">{['pending','damage_observed','no_damage_observed','follow_up','do_not_knock'].map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label>
      <label className="block text-xs">Notes<textarea disabled={saving} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)} className="mt-1 w-full rounded bg-slate-900 p-2"/></label>
      <p className="text-[10px] text-slate-400">Adds a dated observation and preserves previous entries.</p>
      <div className="flex gap-3"><button disabled={saving} type="submit" className="rounded bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">{saving?'Saving…':'Save observation'}</button><button disabled={saving} type="button" onClick={()=>setEditing(null)} className="text-xs underline">Cancel</button></div>
    </form>}
    <input aria-label="Filter inspections" placeholder="Find a property or note…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-lg border border-white/15 bg-slate-900 p-2 text-xs text-white"/>
    {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
    {busy?<p role="status" className="text-xs text-slate-400">Loading inspections…</p>:<>
      {truncated&&<p className="text-xs text-amber-200">Limited to the newest 500 records. Older locations may be missing.</p>}
      <p className="text-xs text-slate-400">{filtered.length} matching locations</p>
      {filtered.slice(0,100).map(row=><article key={row.id} className="space-y-1 rounded-xl border border-white/10 p-3 text-xs">
        <button type="button" onClick={()=>focus(row)} className="text-left font-semibold text-cyan-200 underline" aria-label={`Show ${row.property_label||'recorded location'} on map`}>{row.property_label||'Recorded location'}</button>
        <p className={row.outcome==='do_not_knock'?'text-red-200':'text-slate-300'}>{row.outcome.replaceAll('_',' ')}</p>
        <p className="text-[10px] text-slate-400">{new Date(row.observed_at).toLocaleString()} · {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}</p>
        {row.notes&&<p className="whitespace-pre-wrap break-words text-slate-300">{row.notes}</p>}
        <p className="break-all text-[10px] text-slate-500">Event reference: {row.event_key}</p>
        <button type="button" disabled={saving} onClick={()=>{setEditing(row);setOutcome(row.outcome);setNotes(row.notes);setSaveMessage('');}} className="text-cyan-200 underline disabled:opacity-50">Update observation</button>
      </article>)}
      {filtered.length>100&&<p className="text-xs text-slate-400">Showing 100 results. Narrow your search to see more.</p>}
    </>}
  </section>;
}
