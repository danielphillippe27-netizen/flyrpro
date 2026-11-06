'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { CampaignAddress } from '@/types/database';
import type { CanonicalClientTileBundle } from '@/lib/map/canonicalTileBundle';
import { addressCoordinate, buildingIdentity, splitTownhome, townhomeAddressGroups, townhomeLabels, type TownhomeFootprint } from '@/lib/map/townhomeSlices';
import { IOS_BUILDING_DEPTH } from '@/lib/map/iosMapPresentation';
import { useCardEngagement } from '@/lib/cards/useCardEngagement';
import { statusKey } from '@/lib/map/canonicalTileState';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import { DEFAULT_STATUS_FILTERS, MAP_STATUS_CONFIG, getMapUntouchedColor, type StatusFilters } from '@/lib/constants/mapStatus';

export const TOWNHOME_SOURCE = 'townhome-live-units';
import { TOWNHOME_LAYERS } from '@/lib/map/townhomeInteraction';
const EMPTY: GeoJSON.FeatureCollection = {type:'FeatureCollection',features:[]};
export type TownhomeCoverage = {buildingIds:string[];addressIds:string[]};
type Props = {
  map:mapboxgl.Map; campaignId?:string; mapLoaded:boolean; styleKey:string; bundle?:CanonicalClientTileBundle;
  buildings?:GeoJSON.FeatureCollection | null; addresses:CampaignAddress[]; visible:boolean; dark:boolean;
  selectedAddressId?:string|null; selectedAddressIds?:string[]; hiddenBuildingIds?:string[]; deletedAddressIds?:string[]; visibleAddressIds?:string[];
  statusFilters?:StatusFilters; onCoverageChange:(coverage:TownhomeCoverage)=>void;
  onClick:(target:{buildingId:string;addressId:string;parcelId:null},options:{additive:boolean})=>void;
};
export function TownhomeUnitsLayer(props:Props) {
  const {map,mapLoaded,styleKey,bundle}=props;
  useCardEngagement(map,props.campaignId ?? bundle?.campaign_id,TOWNHOME_SOURCE,'address');
  const [exact,setExact]=useState<GeoJSON.FeatureCollection>(EMPTY);
  const [loadError,setLoadError]=useState(false);
  const latest=useRef(props);latest.current=props;
  const footprintRecords=useMemo(()=>bundle?.records.buildings ?? (props.buildings?.features ?? []).map(f=>({id:buildingIdentity(f),properties:f.properties ?? {}})),[bundle,props.buildings]);
  const groups=useMemo(()=>townhomeAddressGroups(footprintRecords,props.addresses.filter(a=>!props.deletedAddressIds?.includes(a.id)),bundle?.links),[footprintRecords,props.addresses,props.deletedAddressIds,bundle]);
  const idsKey=JSON.stringify([...groups.keys()].sort());
  const revision=bundle?.tiles.geometry_revision;
  const endpoint=bundle?.tiles.geometry_pack?.url;
  useEffect(()=>{
    setExact(EMPTY);setLoadError(false);
    if(!bundle || !endpoint)return;
    const ids=JSON.parse(idsKey) as string[];if(!ids.length)return;
    const controller=new AbortController();
    async function load() {
      const features:GeoJSON.Feature[]=[];
      // Bounded requests, independent of status and selection changes.
      for(let start=0;start<ids.length;start+=100){
        const url=new URL(endpoint!,window.location.href);
        url.pathname=url.pathname.replace(/\/geometry$/,'/townhome-footprints');
        for(const id of ids.slice(start,start+100))url.searchParams.append('id',id);
        const response=await fetch(url,{signal:controller.signal});
        if(!response.ok)throw new Error('Townhome geometry unavailable');
        const data=await response.json() as GeoJSON.FeatureCollection;
        if(data.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('Invalid townhome geometry');
        features.push(...data.features);
      }
      if(!controller.signal.aborted)setExact({type:'FeatureCollection',features});
    }
    void load().catch(()=>{if(!controller.signal.aborted)setLoadError(true);});
    return()=>controller.abort();
  // Geometry belongs to this revision; status changes must not download it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[endpoint,revision,idsKey]);
  const footprints=useMemo(()=>{
    const records=new Map(footprintRecords.map(r=>[r.id.toLowerCase(),r]));
    return (bundle ? exact : props.buildings ?? EMPTY).features.flatMap(f=>{
      if(f.geometry.type!=='Polygon'&&f.geometry.type!=='MultiPolygon')return [];
      const id=buildingIdentity(f);
      return [{...f,properties:{...records.get(id)?.properties,...f.properties,building_id:id}} as TownhomeFootprint];
    });
  },[bundle,exact,props.buildings,footprintRecords]);
  const geometrySignature=JSON.stringify([...groups].map(([id,addresses])=>[id,addresses.map(a=>[a.id,a.house_number,a.street_name,a.formatted,addressCoordinate(a)])]));
  const slices=useMemo(()=>footprints.flatMap(f=>splitTownhome(f,groups.get(buildingIdentity(f)) ?? [])),[footprints,geometrySignature]); // eslint-disable-line react-hooks/exhaustive-deps
  const sliceRef=useRef(slices);sliceRef.current=slices;
  const onCoverageRef=useRef(props.onCoverageChange);onCoverageRef.current=props.onCoverageChange;
  useEffect(()=>{
    onCoverageRef.current({buildingIds:[...new Set(slices.map(s=>s.properties.building_id))],addressIds:[...new Set(slices.map(s=>s.properties.address_id))]});
    return()=>onCoverageRef.current({buildingIds:[],addressIds:[]});
  },[slices]);
  const syncRef=useRef<()=>void>(()=>{});
  syncRef.current=()=>{
    const p=latest.current;
    const source=map.getSource(TOWNHOME_SOURCE) as mapboxgl.GeoJSONSource|undefined;
    const labels=map.getSource(`${TOWNHOME_SOURCE}-labels`) as mapboxgl.GeoJSONSource|undefined;
    if(!source||!labels)return;
    const byId=new Map(p.addresses.map(a=>[a.id,a]));
    const filters=p.statusFilters ?? DEFAULT_STATUS_FILTERS;
    for(const slice of sliceRef.current){
      const a=byId.get(slice.properties.address_id);if(!a)continue;
      const key=statusKey(getCampaignAddressMapStatus(a),filters.QR_SCANNED&&(Number(a.scans??0)>0||Boolean(a.last_scanned_at)));
      const selected=p.selectedAddressId===a.id||Boolean(p.selectedAddressIds?.includes(a.id));
      const color=a.is_teammate_owned?'#166534':key==='UNTOUCHED'&&selected?(p.dark?'#94a3b8':'#475569'):filters[key]&&key!=='UNTOUCHED'?MAP_STATUS_CONFIG[key].color:getMapUntouchedColor(p.dark);
      map.setFeatureState({source:TOWNHOME_SOURCE,id:a.id},{color,selected,teammate_owned:Boolean(a.is_teammate_owned)});
    }
    const visibleIds=sliceRef.current.filter(s=>!p.hiddenBuildingIds?.includes(s.properties.building_id)&&!p.deletedAddressIds?.includes(s.properties.address_id)&&(!p.visibleAddressIds||p.visibleAddressIds.includes(s.properties.address_id))).map(s=>s.properties.address_id);
    for(const id of TOWNHOME_LAYERS)if(map.getLayer(id)){
      map.setLayoutProperty(id,'visibility',p.visible?'visible':'none');
      map.setFilter(id,['in',['get','address_id'],['literal',visibleIds]]);
    }
    if(map.getLayer(TOWNHOME_LAYERS[0]))map.setPaintProperty(TOWNHOME_LAYERS[0],'fill-extrusion-color',['case',['boolean',['feature-state','teammate_owned'],false],'#166534',['all',filters.QR_SCANNED,['boolean',['feature-state','card_engaged'],false]],'#8b5cf6',['coalesce',['feature-state','color'],'#475569']]);
    // Parcels stay underneath even after a late source/style rebuild.
    for(const id of TOWNHOME_LAYERS)if(map.getLayer(id))map.moveLayer(id);
  };
  useEffect(()=>{
    if(!mapLoaded)return;
    let attachedData:typeof slices|undefined;
    const attach=()=>{
      if(!map.isStyleLoaded())return;
      if(!map.getSource(TOWNHOME_SOURCE)){
        map.addSource(TOWNHOME_SOURCE,{type:'geojson',data:EMPTY});
        map.addSource(`${TOWNHOME_SOURCE}-labels`,{type:'geojson',data:EMPTY});
        // WebGL bevels on clipped acute corners produce spikes; square slice edges retain exact coverage.
        map.addLayer({id:TOWNHOME_LAYERS[0],type:'fill-extrusion',source:TOWNHOME_SOURCE,minzoom:10,layout:{'fill-extrusion-edge-radius':0},paint:{...IOS_BUILDING_DEPTH,'fill-extrusion-color':['coalesce',['feature-state','color'],'#475569'],'fill-extrusion-height':['get','overlay_height'],'fill-extrusion-base':['get','overlay_base'],'fill-extrusion-opacity':1}});
        map.addLayer({id:TOWNHOME_LAYERS[1],type:'line',source:TOWNHOME_SOURCE,minzoom:10,layout:{'line-elevation-reference':'ground','line-z-offset':['+', ['get','overlay_height'],.04]},paint:{'line-color':'#334155','line-width':2,'line-opacity':['case',['boolean',['feature-state','selected'],false],1,0]}});
        // GL JS already elevates labels to the roof: only add clearance, not roof height twice.
        map.addLayer({id:TOWNHOME_LAYERS[2],type:'symbol',source:`${TOWNHOME_SOURCE}-labels`,minzoom:17,layout:{'text-field':['get','house_number'],'text-size':['interpolate',['linear'],['zoom'],17,11.5,20,15],'text-allow-overlap':true,'text-ignore-placement':true,'text-pitch-alignment':'viewport','symbol-z-elevate':true,'symbol-elevation-reference':'ground'},paint:{'text-color':'#ffffff','text-halo-color':'#111827','text-halo-width':1,'symbol-z-offset':.05}});
        attachedData=undefined;
      }
      if(attachedData!==sliceRef.current){
        (map.getSource(TOWNHOME_SOURCE) as mapboxgl.GeoJSONSource).setData({type:'FeatureCollection',features:sliceRef.current.map(s=>({...s,id:s.properties.address_id}))});
        (map.getSource(`${TOWNHOME_SOURCE}-labels`) as mapboxgl.GeoJSONSource).setData(townhomeLabels(sliceRef.current));
        attachedData=sliceRef.current;
        syncRef.current();
      }
    };
    const click=(event:mapboxgl.MapMouseEvent)=>{
      if(!latest.current.visible)return;
      const layers=TOWNHOME_LAYERS.filter(id=>map.getLayer(id));if(!layers.length)return;
      const hit=map.queryRenderedFeatures(event.point,{layers})[0];
      if(hit?.properties?.address_id&&hit.properties.building_id)latest.current.onClick({buildingId:hit.properties.building_id,addressId:hit.properties.address_id,parcelId:null},{additive:event.originalEvent.metaKey||event.originalEvent.ctrlKey});
    };
    attach();map.on('style.load',attach);map.on('idle',attach);map.on('click',click);
    return()=>{
      map.off('style.load',attach);map.off('idle',attach);map.off('click',click);
      if(!map.getStyle())return;
      for(const id of [...TOWNHOME_LAYERS].reverse())if(map.getLayer(id))map.removeLayer(id);
      for(const id of [`${TOWNHOME_SOURCE}-labels`,TOWNHOME_SOURCE])if(map.getSource(id))map.removeSource(id);
    };
  },[map,mapLoaded,styleKey]);
  useEffect(()=>{
    const source=map.getSource(TOWNHOME_SOURCE) as mapboxgl.GeoJSONSource|undefined;
    if(source){source.setData({type:'FeatureCollection',features:slices.map(s=>({...s,id:s.properties.address_id}))});(map.getSource(`${TOWNHOME_SOURCE}-labels`) as mapboxgl.GeoJSONSource)?.setData(townhomeLabels(slices));syncRef.current();}
  },[map,slices]);
  useEffect(()=>{syncRef.current();},[props.visible,props.dark,props.selectedAddressId,props.selectedAddressIds,props.addresses,props.statusFilters,props.hiddenBuildingIds,props.deletedAddressIds,props.visibleAddressIds]);
  return loadError&&props.visible?<p role="status" className="absolute bottom-4 left-4 z-20 rounded bg-background p-2 text-xs">Townhome detail could not load. Existing map remains available.</p>:null;
}
