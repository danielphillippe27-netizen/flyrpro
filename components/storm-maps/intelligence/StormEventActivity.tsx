'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
type Campaign={id:string;name:string;total:number|null;visited:number|null};
export function StormEventActivity({workspaceId,eventKey}:{workspaceId:string;eventKey:string}){
  const [data,setData]=useState<{campaigns:Campaign[];scope:string}|null>(null),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();setData(null);setError('');fetch(`/api/storm-maps/intelligence/activity?workspaceId=${encodeURIComponent(workspaceId)}&eventKey=${encodeURIComponent(eventKey)}`,{signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}).then(setData).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[workspaceId,eventKey]);
  return <div className="rounded-xl border border-white/10 p-3"><p className="text-xs font-semibold">Campaign activity</p>{error?<p className="mt-2 text-[11px] text-amber-200">{error}</p>:!data?<p className="mt-2 text-[11px] text-slate-400">Loading campaigns…</p>:<><p className="mt-1 text-[10px] text-slate-400">{data.scope} explicitly linked to this event</p>{data.campaigns.length?data.campaigns.map(c=><Link key={c.id} href={`/campaigns/${c.id}`} className="mt-2 block rounded-lg bg-white/5 p-2 text-xs"><p>{c.name}</p><p className="mt-1 text-[10px] text-cyan-200">{c.total==null||c.visited==null?'Stop counts unavailable':`${Math.max(0,c.total-c.visited)} unvisited / ${c.total} stops`}</p></Link>):<p className="mt-2 text-[11px] text-slate-400">No linked campaigns visible to you. Other campaigns may still overlap this area.</p>}</>}</div>;
}
