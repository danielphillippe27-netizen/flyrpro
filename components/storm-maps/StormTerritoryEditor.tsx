'use client';
import { useEffect,useRef,useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import type mapboxgl from 'mapbox-gl';
import { stormGeometrySchema,type StormGeometry } from '@/lib/storm-maps/intelligence/geometry';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import { StormTerritoryAddressCount } from './StormTerritoryAddressCount';
export function StormTerritoryEditor({map,workspaceId,context,onSave,onSelecting,initial,initialName}:{map:mapboxgl.Map;workspaceId:string;context:StormCampaignContext;initial?:StormGeometry;initialName?:string;onSave:(name:string,boundary:StormGeometry,context:StormCampaignContext)=>Promise<void>;onSelecting:(v:boolean)=>void}){
 const drawRef=useRef<MapboxDraw|null>(null);
 const [boundary,setBoundary]=useState<StormGeometry|null>(null),[name,setName]=useState(initialName??`${context.event.title} territory`.slice(0,160)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const draw=new MapboxDraw({displayControlsDefault:false,controls:{polygon:true,trash:true},defaultMode:'simple_select'});drawRef.current=draw;map.addControl(draw,'bottom-left');
  if(initial){const parts=initial.type==='Polygon'?[initial]:initial.coordinates.map(coordinates=>({type:'Polygon' as const,coordinates}));draw.add({type:'FeatureCollection',features:parts.map(geometry=>({type:'Feature',properties:{},geometry}))});}
  const update=()=>{const parts=draw.getAll().features.filter(f=>f.geometry.type==='Polygon').map(f=>(f.geometry as GeoJSON.Polygon).coordinates);setBoundary(parts.length===0?null:parts.length===1?{type:'Polygon',coordinates:parts[0]}:{type:'MultiPolygon',coordinates:parts});};
  const mode=(event:unknown)=>onSelecting((event as {mode:string}).mode!=='simple_select');
  update();for(const event of ['draw.create','draw.update','draw.delete'])map.on(event,update);map.on('draw.modechange',mode);
  return()=>{for(const event of ['draw.create','draw.update','draw.delete'])map.off(event,update);map.off('draw.modechange',mode);onSelecting(false);try{if(map.getStyle()&&map.hasControl(draw))map.removeControl(draw);}catch{/* disposed map */}drawRef.current=null;};
 },[map,initial,onSelecting]);
 const valid=boundary?stormGeometrySchema.safeParse(boundary):null;
 const save=async()=>{if(!valid?.success||!name.trim())return;setBusy(true);setError('');try{await onSave(name,valid.data,context);}catch(e){setError(e instanceof Error?e.message:'Could not save territory.');}finally{setBusy(false);}};
 return <div className="space-y-3 rounded-xl border border-cyan-200/25 p-3"><h3 className="text-sm font-semibold">Storm territory editor</h3><p className="text-xs text-slate-300">Draw separate neighbourhoods. Select a shape, then a vertex to adjust it; use the map trash control to remove selected portions.</p><label className="block text-xs">Name<input className="mt-1 w-full rounded-lg bg-slate-900 p-2" value={name} maxLength={160} onChange={e=>setName(e.target.value)}/></label><button type="button" onClick={()=>drawRef.current?.changeMode('draw_polygon')} className="w-full rounded-lg border border-white/20 py-2 text-xs">Add neighbourhood polygon</button>{boundary&&valid?.success&&<StormTerritoryAddressCount workspaceId={workspaceId} boundary={boundary}/>}<p className="text-[10px] text-amber-200">All pins within this custom boundary are counted. Storm exposure is unavailable until historical zone geometry is verified.</p>{boundary&&!valid?.success&&<p role="alert" className="text-xs text-amber-200">Use non-crossing neighbourhood boundaries totalling under 500 km².</p>}<button type="button" disabled={busy||!valid?.success||!name.trim()} onClick={()=>void save()} className="w-full rounded-lg bg-cyan-200 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy?'Saving…':'Save storm territory'}</button>{error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}</div>;
}
