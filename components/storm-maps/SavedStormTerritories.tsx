'use client';
import { StormTerritoryAddressCount } from './StormTerritoryAddressCount';
import { StormTerritoryCampaignActions } from './StormTerritoryCampaignActions';
import { StormTerritoryOverlay } from './StormTerritoryOverlay';
import { bbox,area,intersect,feature,featureCollection } from '@turf/turf';
import { StormTerritoryEditor } from './StormTerritoryEditor';
const ignoreSelection=()=>{};
import { useEffect, useState } from 'react';

import type mapboxgl from 'mapbox-gl';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
type Props = { initiallyOpen?: boolean; renderOverlay?: boolean; map: mapboxgl.Map; workspaceId: string; revision: number; active: SavedStormTerritory | null; onSelect: (territory: SavedStormTerritory | null) => void; onCampaign: (territory: SavedStormTerritory) => void };
export function SavedStormTerritories({ map, workspaceId, revision, active, onSelect, onCampaign, renderOverlay = true, initiallyOpen = false }: Props) {
  const [creating, setCreating] = useState(false);
  const [refresh,setRefresh]=useState(0),[editing,setEditing]=useState(false);
  const [territories, setTerritories] = useState<SavedStormTerritory[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: abort.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.territories;
    }).then(data => { if (!abort.signal.aborted) setTerritories(data); }).catch(reason => { if (!abort.signal.aborted) setError(reason.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [workspaceId, revision,refresh]);
  async function manage(action:'rename'|'duplicate'|'delete'){
    if(!active)return;
    let name=active.name;
    if(action==='rename'){const value=window.prompt('Storm territory name',name);if(!value)return;name=value;}
    if(action==='delete'&&!window.confirm('Delete this saved storm territory? Existing campaigns will remain.'))return;
    setError('');
    try{
      const method=action==='duplicate'?'POST':action==='delete'?'DELETE':'PATCH';
      const body=action==='duplicate'?{name:`${name} copy`.slice(0,160),boundary:active.boundary,context:active.context}:action==='rename'?{id:active.id,name,revision:active.revision??1}:undefined;
      const response=await fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}${action==='delete'?`&id=${active.id}`:''}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      const data=await response.json();if(!response.ok)throw Error(data.error);onSelect(data.territory??null);setRefresh(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:'Could not update territory.');}
  }
  const select = (territory: SavedStormTerritory) => {
    setEditing(false);onSelect(territory);
    const bounds=bbox(territory.boundary);
    map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]], { padding: 100, maxZoom: 12, pitch: 0, bearing: 0, duration: 600 });
  };
  const overlapping=active?territories.filter(other=>{if(other.id===active.id)return false;try{const overlap=intersect(featureCollection([feature(active.boundary),feature(other.boundary)]));return !!overlap&&area(overlap)>1;}catch{return false;}}):[];
  return <>{renderOverlay && <StormTerritoryOverlay map={map} territory={active} />}<details open={initiallyOpen || !!active} className="mt-4 rounded-xl border border-cyan-300/25 p-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-200">Saved storm territories</summary><div className="mt-3 space-y-2">
    {loading && <p role="status" className="text-[11px]">Loading territories…</p>}
    {error && <p role="alert" className="text-[11px] text-amber-200">{error}</p>}
    {!loading && !error && !territories.length && <p className="text-[11px] text-slate-400">Select a hail or wind area and save its boundary here.</p>}
    {territories.map(territory => <button key={territory.id} type="button" disabled={creating} aria-pressed={active?.id === territory.id} onClick={() => select(territory)} className={`w-full rounded-lg border p-2 text-left text-xs ${active?.id === territory.id ? 'border-cyan-300' : 'border-white/15'}`}><p className="font-semibold">{territory.name}</p><p className="mt-1 text-[10px] text-slate-400">{territory.context.event.start.slice(0,10)} · {territory.context.gustSelection ? `Estimated wind ${Math.round(territory.context.gustSelection.minimumKPH)}${territory.context.gustSelection.maximumKPH==null?'+':`–${Math.round(territory.context.gustSelection.maximumKPH)}`} km/h · ${territory.context.gustSelection.time.slice(11,16)} UTC` : territory.context.minimumHailMM == null ? 'Storm inspection area' : `${territory.context.minimumHailMM === 0 ? '>0' : territory.context.minimumHailMM.toFixed(1)} mm${territory.context.maximumHailMM == null ? '+' : `–${territory.context.maximumHailMM.toFixed(1)} mm`}`}</p></button>)}
    {active && <div className="space-y-2 border-t border-white/10 pt-3"><StormTerritoryAddressCount workspaceId={workspaceId} boundary={active.boundary} /><p className="text-xs font-semibold">{active.name}</p>{!!overlapping.length&&<p className="text-[11px] text-amber-200">Overlaps {overlapping.map(t=>t.name).join(', ')}. Review existing campaign targets to avoid duplicate canvassing.</p>}{editing&&<StormTerritoryEditor key={active.id} map={map} workspaceId={workspaceId} context={active.context} initial={active.boundary} initialName={active.name} onSelecting={ignoreSelection} onSave={async(name,boundary)=>{const response=await fetch(`/api/storm-maps/intelligence/territories?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:active.id,revision:active.revision??1,name,boundary})});const data=await response.json();if(!response.ok)throw Error(data.error);onSelect(data.territory);setEditing(false);setRefresh(v=>v+1);}}/>}<StormTerritoryCampaignActions key={active.id} active={active} workspaceId={workspaceId} onBusyChange={setCreating} /><button type="button" onClick={() => onCampaign(active)} className="w-full rounded-lg bg-red-500 py-2 text-xs font-semibold">Draw campaign inside territory</button><button type="button" onClick={()=>setEditing(value=>!value)} className="text-[11px] text-cyan-200">{editing?'Cancel boundary edit':'Edit boundary'}</button><div className="flex gap-3">{(['rename','duplicate','delete'] as const).map(action=><button type="button" key={action} onClick={()=>void manage(action)} className="text-[11px] capitalize text-cyan-200">{action}</button>)}</div><button type="button" onClick={() => onSelect(null)} className="text-[11px] text-cyan-200">Hide territory</button></div>}
  </div></details></>;
}
