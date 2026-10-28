'use client';
import { useEffect, useRef, useState } from 'react';
import { useStormTerritoryDisplay } from '@/lib/storm-maps/territory-display';
import type mapboxgl from 'mapbox-gl';
import type { StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
import type { SavedStormTerritory } from '@/lib/storm-maps/intelligence/storm-territories';
import type { WindCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { useStormMobileNavigation } from '@/lib/storm-maps/mobile-session';
import { StormTerritoryAddressCount } from '../StormTerritoryAddressCount';
import { StormTerritoryCampaignActions } from '../StormTerritoryCampaignActions';
export type SaveWindTerritory = (name:string,boundary:GeoJSON.Polygon|GeoJSON.MultiPolygon,context:StormCampaignContext)=>Promise<SavedStormTerritory>;
type Zone={boundary:GeoJSON.Polygon|GeoJSON.MultiPolygon;clickedKPH:number;minimumKPH:number;maximumKPH:number|null;areaKM2:number;cellMeters:number;context:StormCampaignContext};
const source='wolfgrid-wind-zone', outline='wolfgrid-wind-zone-outline', fill='wolfgrid-wind-zone-fill';
export function WindZoneSelector({map,workspaceId,country,time,minimumKPH,onSave,onSelected,simple=false}:{map:mapboxgl.Map;workspaceId:string;country:WindCountry;time:string;minimumKPH:number;onSelected?:()=>void;simple?:boolean;onSave:SaveWindTerritory}){
  const territoryDisplay=useStormTerritoryDisplay();
  const territoryDisplayRef=useRef(territoryDisplay);territoryDisplayRef.current=territoryDisplay;
  const nativeNavigation=useStormMobileNavigation();
  const section=useRef<HTMLDivElement>(null);
  const onSelectedRef=useRef(onSelected);onSelectedRef.current=onSelected;
  const [bandOnly,setBandOnly]=useState(false);
  const [zone,setZone]=useState<Zone|null>(null),[saved,setSaved]=useState<SavedStormTerritory|null>(null);
  const [name,setName]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[working,setWorking]=useState(false);
  const request=useRef<AbortController|null>(null),locked=useRef(false);
  const saving=useRef<Promise<SavedStormTerritory>|null>(null);
  useEffect(()=>{
    setZone(null);setSaved(null);setError('');
    const click=(event:mapboxgl.MapMouseEvent)=>{
      if(locked.current||territoryDisplayRef.current)return;
      request.current?.abort();const abort=new AbortController();request.current=abort;
      setZone(null);setSaved(null);setLoading(true);setError('');
      const lon=((event.lngLat.lng+180)%360+360)%360-180;
      const query=new URLSearchParams({workspaceId,country,time,lon:String(lon),lat:String(event.lngLat.lat),band:bandOnly?'1':'0',minimum:String(minimumKPH)});
      fetch(`/api/storm-maps/intelligence/wind/zone?${query}`,{signal:abort.signal}).then(async response=>{
        const data=await response.json();if(!response.ok)throw Error(data.error||'Could not outline this wind area.');
        if(!abort.signal.aborted){setZone(data);onSelectedRef.current?.();setName(`Wind ${Math.round(data.minimumKPH)}${data.maximumKPH==null?'+':`–${Math.round(data.maximumKPH)}`} km/h · ${time.slice(0,10)}`);}
      }).catch(reason=>{if(!abort.signal.aborted){setError(reason instanceof Error?reason.message:'Wind selection unavailable.');onSelectedRef.current?.();}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    };
    map.on('click',click);return()=>{map.off('click',click);request.current?.abort();};
  },[map,workspaceId,country,time,minimumKPH,bandOnly]);
  useEffect(()=>{
    const clear=()=>{for(const id of [outline,fill])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(source))map.removeSource(source);};
    const draw=()=>{if(!map.isStyleLoaded())return;clear();if(!zone||territoryDisplay)return;
      map.addSource(source,{type:'geojson',data:{type:'Feature',geometry:zone.boundary,properties:{}}});
      map.addLayer({id:fill,type:'fill',source,paint:{'fill-color':'#ffffff','fill-opacity':.08}});
      map.addLayer({id:outline,type:'line',source,paint:{'line-color':'#111111','line-width':3}});
    };draw();map.on('style.load',draw);return()=>{map.off('style.load',draw);clear();};
  },[map,zone,territoryDisplay]);
  useEffect(()=>{if(nativeNavigation&&(zone||error))section.current?.scrollIntoView?.({block:'start',behavior:'smooth'});},[nativeNavigation,zone,error]);
  const busy=(value:boolean)=>{locked.current=value;setWorking(value);};
  const ensureSaved=async()=>{
    if(saved)return saved;
    if(saving.current)return saving.current;
    if(!zone||!name.trim())throw Error('Name the selected wind area first.');
    saving.current=onSave(name.trim(),zone.boundary,zone.context).then(territory=>{setSaved(territory);return territory;});
    try{return await saving.current;}finally{saving.current=null;}
  };
  return <div ref={section} className="space-y-3 rounded-lg border border-border p-3">
    <p className="text-sm font-semibold">Select a wind area</p>

    {!simple&&<label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={bandOnly} disabled={working} onChange={event=>setBandOnly(event.target.checked)}/>Exclude stronger colour bands</label>}
    <p className="text-xs">Tap a shaded gust area to outline its connected wind range.</p>
    {loading&&<p role="status" className="text-xs">Outlining saved gust area…</p>}
    {error&&<p role="alert" className="text-xs text-amber-700 dark:text-amber-200">{error}</p>}
    {zone&&<><p className="text-xs font-semibold">Estimated gust: {Math.round(zone.clickedKPH)} km/h · {Math.round(zone.minimumKPH)}{zone.maximumKPH==null?'+':`–${Math.round(zone.maximumKPH)}`} km/h area</p><p className="text-xs text-muted-foreground">{zone.areaKM2.toFixed(1)} km² · source cells about {(zone.cellMeters/1000).toFixed(1)} km across. Boundary follows the regional grid.</p>
      {(country==='CA'||country==='US')?<StormTerritoryAddressCount workspaceId={workspaceId} boundary={zone.boundary}/>:<p className="text-xs">Create an area campaign from this selection. Automatic address campaigns currently support Canada and the U.S.</p>}
      {!saved&&<label className="block text-xs">Territory name<input aria-label="Wind territory name" maxLength={160} value={name} disabled={working} onChange={event=>setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background p-2"/></label>}
      <StormTerritoryCampaignActions disabled={working||!name.trim()} active={saved} prepareTerritory={ensureSaved} draftBoundary={zone.boundary} workspaceId={workspaceId} onBusyChange={busy} buttonLabel="Create campaign" allowAreaCampaign={false} areaOnly={country==='AU'||country==='NZ'}/>
      {!saved?<button type="button" disabled={working||!name.trim()} onClick={async()=>{busy(true);setError('');try{await ensureSaved();}catch(reason){setError(reason instanceof Error?reason.message:'Could not save wind territory.');}finally{busy(false);}}} className="min-h-11 w-full rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-50">{working?'Saving…':'Create wind area'}</button>:<p role="status" className="text-xs">Wind area created.</p>}
    </>}
    <p className="text-[11px] text-muted-foreground">Estimated wind exposure, not confirmed property damage.</p>
  </div>;
}
