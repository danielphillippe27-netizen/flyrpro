'use client';
import {useEffect,useState} from 'react';
import type mapboxgl from 'mapbox-gl';
import type {MapboxMapController} from '@xweather/mapsgl';
import type {SavedStormTerritory} from '@/lib/storm-maps/intelligence/storm-territories';
export function StormCampaignHailOverlay({map,workspaceId,territory,enabled}:{map:mapboxgl.Map;workspaceId:string;territory:SavedStormTerritory|null;enabled:boolean}){
 const [status,setStatus]=useState('');
 useEffect(()=>{
  if(!enabled||!territory){setStatus('');return;}
  if(territory.context.event.hazard!=='hail'){setStatus('Hail shading is available for hail territories.');return;}
  const start=new Date(territory.context.event.start),end=new Date(Math.min(Date.parse(territory.context.event.end),Date.now()));
  if(+start<Date.now()-7*86400000||+end<=+start){setStatus('Hail shading is outside the available 7-day history. The saved outline remains visible.');return;}
  const abort=new AbortController();let controller:MapboxMapController|undefined;let disposed=false;
  setStatus('Loading hail shading…');
  const load=async()=>{
   const center=map.getCenter();
   const response=await fetch('/api/storm-maps/manifest?'+new URLSearchParams({workspaceId,lat:String(center.lat),lon:String(center.lng)}),{signal:abort.signal,cache:'no-store'});
   if(!response.ok)throw Error('Hail shading unavailable.');
   const manifest=await response.json();if(!manifest.providerHealth?.xweather?.available)throw Error('Hail shading unavailable.');
   const sdk=await import('@xweather/mapsgl');
   for(let attempt=0;!disposed&&!map.isStyleLoaded();attempt++){if(attempt>=100)throw Error('Map is not ready.');await new Promise(resolve=>setTimeout(resolve,100));}
   if(disposed)return;
   const account=new sdk.Account('wolfgrid','session'),server=window.location.origin+'/api/storm-maps/gl/session-'+workspaceId;
   account.servers.mapsgl=server;account.servers.api=server+'/api';account.servers.maps=server+'/maps';
   const beforeId=map.getStyle().layers?.find(layer=>layer.id.startsWith('gl-draw-'))?.id;
   controller=new sdk.MapboxMapController(map,{account,animation:{preloadData:false},slots:{slots:{underlay:{beforeId},inlay:{beforeId}}}});
   controller.on('load',()=>{
    if(disposed||!controller)return;
    controller.timeline.clear();controller.timeline.endDate=end;controller.timeline.startDate=start;controller.timeline.goToDate(controller.timeline.endDate);
    controller.addWeatherLayer('hail-size-max',{paint:{opacity:0.55},timing:{clamp:'past'},legend:false});
   });
   controller.on('load:complete',()=>{if(!disposed)setStatus('');});
   controller.on('error',()=>{if(!disposed)setStatus('Hail shading unavailable. The saved outline remains visible.');});
  };
  void load().catch(()=>{if(!disposed)setStatus('Hail shading unavailable. The saved outline remains visible.');});
  return()=>{disposed=true;abort.abort();controller?.dispose();};
 },[map,workspaceId,territory,enabled]);
 return enabled&&status?<p role="status" className="absolute bottom-6 left-6 z-20 max-w-xs rounded-lg bg-slate-950 p-2 text-xs text-white">{status}</p>:null;
}
