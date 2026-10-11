'use client';
import { useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';
import { visibleEventFeatures } from '@/lib/storm-maps/intelligence/model';
const source='storm-intelligence-event';
const layers=['storm-intelligence-line','storm-intelligence-points'];
export function StormEventMap({map,event,minimumHailMM,onLocation}:{map:mapboxgl.Map;event:StormEvent|null;minimumHailMM:number;onLocation:(point:{lon:number;lat:number})=>void}){
  useEffect(()=>{
    if(!event)return;
    let popup:mapboxgl.Popup|undefined;
    const draw=()=>{
      if(!map.isStyleLoaded())return;
      const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:visibleEventFeatures(event,minimumHailMM)};
      const existing=map.getSource(source) as mapboxgl.GeoJSONSource|undefined;
      if(existing)existing.setData(data);else map.addSource(source,{type:'geojson',data});
      if(!map.getLayer(layers[0]))map.addLayer({id:layers[0],type:'line',source,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['case',['==',['get','kind'],'forecast'],'#fbbf24','#a78bfa'],'line-width':3,'line-opacity':0.8}});
      if(!map.getLayer(layers[1]))map.addLayer({id:layers[1],type:'circle',source,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,3,9,6],'circle-color':['case',['==',['get','kind'],'forecast'],'#fbbf24',['interpolate',['linear'],['coalesce',['get','hailMM'],0],0,'#67e8f9',25.4,'#c084fc',50.8,'#f472b6',76.2,'#f87171']],'circle-stroke-color':'#0f172a','circle-stroke-width':1.5}});
    };
    const clicked=(e:mapboxgl.MapMouseEvent)=>{
      onLocation({lon:e.lngLat.lng,lat:e.lngLat.lat});
      if(!map.getLayer(layers[1]))return;
      const hit=map.queryRenderedFeatures(e.point,{layers:[layers[1]]})[0];
      if(!hit)return;
      const p=hit.properties||{},el=document.createElement('div');
      el.style.color='#0f172a';el.style.maxWidth='240px';
      el.textContent=[p.label,new Date(p.time).toLocaleString(),p.hailMM!=null?`Reported hail: ${Number(p.hailMM).toFixed(1)} mm`:'',p.windKPH!=null?`Wind: ${p.windKPH} km/h`:'',p.description||''].filter(Boolean).join(' · ');
      popup?.remove();popup=new mapboxgl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    };
    draw();map.on('style.load',draw);map.on('click',clicked);
    return()=>{map.off('style.load',draw);map.off('click',clicked);popup?.remove();for(const id of layers)if(map.getLayer(id))map.removeLayer(id);if(map.getSource(source))map.removeSource(source);};
  },[map,event,minimumHailMM,onLocation]);
  return null;
}
