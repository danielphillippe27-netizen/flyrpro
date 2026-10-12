'use client';
import { useEffect, useMemo, useState } from 'react';
import { booleanPointInPolygon, point } from '@turf/turf';
import type mapboxgl from 'mapbox-gl';
import { hurricaneWindArea } from '@/lib/storm-maps/intelligence/hurricane-area';
import { stormGeometrySchema, type StormGeometry } from '@/lib/storm-maps/intelligence/geometry';
import { referenceOf, type StormEvent, type StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { StormEventMap } from './intelligence/StormEventMap';
import { StormTerritoryAddressCount } from './StormTerritoryAddressCount';
const ignoreLocation=()=>{};
export function HurricaneAreaSelector({map,event,workspaceId,onSave}:{map:mapboxgl.Map;event:StormEvent;workspaceId:string;onSave:(name:string,boundary:StormGeometry,context:StormCampaignContext)=>Promise<void>}){
 const [minimum,setMinimum]=useState(34),[boundary,setBoundary]=useState<StormGeometry|null>(null),[name,setName]=useState(event.title+' territory'),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const full=useMemo(()=>hurricaneWindArea(event,minimum),[event,minimum]);
 useEffect(()=>{setBoundary(null);setError('');},[minimum,event]);
 useEffect(()=>{
  const source='hurricane-selected-area',line=source+'-line';
  const clear=()=>{if(map.getLayer(line))map.removeLayer(line);if(map.getSource(source))map.removeSource(source);};
  const show=()=>{clear();if(!boundary||!map.isStyleLoaded())return;map.addSource(source,{type:'geojson',data:{type:'Feature',properties:{},geometry:boundary}});map.addLayer({id:line,type:'line',source,paint:{'line-color':'#111111','line-width':3}});};
  const recover=()=>{if(boundary&&!map.getSource(source)&&map.isStyleLoaded())show();};show();map.on('style.load',show);map.on('idle',recover);
  return()=>{map.off('style.load',show);map.off('idle',recover);clear();};
 },[map,boundary]);
 useEffect(()=>{
  const select=(e:mapboxgl.MapMouseEvent)=>{if(!full||!booleanPointInPolygon(point([e.lngLat.lng,e.lngLat.lat]),full))return;choose();};
  const choose=()=>{const b=map.getBounds();if(!b)return;const selected=hurricaneWindArea(event,minimum,[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);if(!selected){setError('No wind area in this map view.');return;}if(!stormGeometrySchema.safeParse(selected).success){setError('Zoom in to select a territory smaller than 500 km².');return;}setBoundary(selected);setError('');};
  map.on('click',select);return()=>{map.off('click',select);};
 },[map,event,minimum,full]);
 return <><StormEventMap map={map} event={event} minimumHailMM={0} onLocation={ignoreLocation}/><div className="space-y-3 rounded-xl border border-cyan-200/30 p-3"><h3 className="text-sm font-semibold text-cyan-200">Select hurricane wind area</h3><label className="block text-xs">Sustained wind<select className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={minimum} onChange={e=>setMinimum(Number(e.target.value))}><option value={34}>34 kt+ · 63 km/h+ · Tropical storm</option><option value={50}>50 kt+ · 93 km/h+</option><option value={64}>64 kt+ · 119 km/h+ · Hurricane</option></select></label><p className="text-xs">{full?'Zoom to your area, then click the wind shading to select all qualifying areas in this map view.':'Historical wind areas are unavailable for this storm.'}</p><p className="text-[10px] text-muted-foreground">Combined historical advisory wind extents. Gaps between advisories may remain. These estimates do not confirm damage.</p>{error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}{boundary&&<><StormTerritoryAddressCount workspaceId={workspaceId} boundary={boundary}/><label className="block text-xs">Territory name<input value={name} onChange={e=>setName(e.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-border bg-background p-2"/></label><button disabled={saving||!name.trim()} className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground" onClick={async()=>{setSaving(true);setError('');try{await onSave(name.trim(),boundary,{version:2,event:referenceOf(event),selectedAt:new Date().toISOString(),minimumHailMM:null,selection:'intensity-zone',evidenceKind:'wind-field',windSelection:{minimumKTS:minimum,method:'advisory-windfield-union',clippedToMap:true}});setError('Storm territory saved.');}catch(e){setError(e instanceof Error?e.message:'Save failed.');}finally{setSaving(false);}}}>{saving?'Saving…':'Save storm territory'}</button></>}</div></>;
}
