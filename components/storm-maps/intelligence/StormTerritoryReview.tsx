'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type mapboxgl from 'mapbox-gl';
import type { Polygon } from 'geojson';
import type { TerritoryReview } from '@/lib/storm-maps/intelligence/territory-review';

type Props = { map:mapboxgl.Map; workspaceId:string; getBoundary:()=>Polygon|null };
export function StormTerritoryReview({map,workspaceId,getBoundary}:Props) {
  const [boundary,setBoundary] = useState('');
  const [result,setResult] = useState<{boundary:string;data:TerritoryReview}|null>(null);
  const [error,setError] = useState<{boundary:string;message:string}|null>(null);
  const [retry,setRetry] = useState(0);
  useEffect(() => {
    const read = () => { const polygon=getBoundary(); setBoundary(polygon?JSON.stringify(polygon):''); };
    read();
    map.on('draw.create',read);map.on('draw.update',read);map.on('draw.delete',read);map.on('idle',read);
    return () => {map.off('draw.create',read);map.off('draw.update',read);map.off('draw.delete',read);map.off('idle',read);};
  },[map,getBoundary]);
  useEffect(() => {
    if (!boundary) return;
    const abort = new AbortController();
    setError(null);setResult(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/storm-maps/intelligence/review?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:boundary,signal:abort.signal});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Area review unavailable.');
        if (!abort.signal.aborted) setResult({boundary,data});
      } catch (e) {if (!abort.signal.aborted) setError({boundary,message:(e as Error).message});}
    },400);
    return () => {window.clearTimeout(timer);abort.abort();};
  },[boundary,workspaceId,retry]);
  if (!boundary) return <p className="mt-2 text-slate-400">Finish a boundary to review existing work in that area.</p>;
  const data = result?.boundary===boundary ? result.data : null;
  const failure = error?.boundary===boundary ? error.message : null;
  return <section aria-label="Storm territory review" className="mt-3 border-t border-white/15 pt-3">
    <p className="font-semibold">Area review</p>
    {failure ? <div role="alert" className="mt-2 text-amber-200">{failure}<button type="button" onClick={()=>setRetry(v=>v+1)} className="ml-2 underline">Retry</button></div> : !data ? <p role="status" className="mt-2 text-slate-400">Checking campaigns and recorded inspections…</p> : <>
      <p className="mt-1 text-slate-300">{data.areaKM2.toFixed(2)} km² selected · {data.campaigns.length} overlapping campaigns</p>
      <p className="mt-1 text-[10px] text-slate-400">{data.scope} with saved boundaries. Overlap measures area, not duplicate homes.</p>
      {data.warnings.map(w=><p key={w} className="mt-1 text-amber-200">{w}</p>)}
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded bg-red-400/15 px-2 py-1 text-red-200">{data.inspections.filter(i=>i.outcome==='do_not_knock').length} do not knock</span>
        <span className="rounded bg-amber-300/15 px-2 py-1 text-amber-200">{data.inspections.filter(i=>i.outcome==='follow_up').length} follow-up</span>
        <span className="rounded bg-white/10 px-2 py-1">{data.inspections.length} recorded locations</span>
      </div>
      <div className="mt-2 max-h-40 space-y-2 overflow-auto">
        {data.campaigns.map(c=><Link key={c.id} href={`/campaigns/${c.id}`} target="_blank" rel="noopener noreferrer" className="block rounded bg-white/5 p-2 underline">{c.name} · {c.selectedAreaPercent.toFixed(0)}% of selected area · {c.status}</Link>)}
        {data.inspections.filter(i=>i.outcome==='do_not_knock'||i.outcome==='follow_up').map(i=><div key={i.id} className="rounded bg-white/5 p-2"><button type="button" onClick={()=>map.flyTo({center:[i.longitude,i.latitude],zoom:17})} className="text-left text-cyan-200 underline">{i.property_label||'Recorded location'}</button><p>{i.outcome.replaceAll('_',' ')}</p></div>)}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">Review only: these records do not automatically exclude addresses. Other CRM opt-outs and properties without inspection records are not checked. Final addresses resolve after campaign creation.</p>
    </>}
  </section>;
}
