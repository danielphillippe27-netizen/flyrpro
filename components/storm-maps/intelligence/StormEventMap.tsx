'use client';
import { useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';
import { visibleEventFeatures } from '@/lib/storm-maps/intelligence/model';
const source='storm-intelligence-event';
const layers=['storm-intelligence-area','storm-intelligence-area-outline','storm-intelligence-line','storm-intelligence-points'];
const areaColor: mapboxgl.Expression = ['case',['==',['get','kind'],'forecast-cone'],'#fbbf24',['==',['get','windThresholdKTS'],64],'#f87171',['==',['get','windThresholdKTS'],50],'#fb923c','#38bdf8'];
export function StormEventMap({map,event,minimumHailMM,onLocation,territoryDrawing=false}:{map:mapboxgl.Map;event:StormEvent|null;minimumHailMM:number;territoryDrawing?:boolean;onLocation:(point:{lon:number;lat:number})=>void}){
  useEffect(()=>{
    let drawing=territoryDrawing;
    const modeChanged=(e:{mode?:string})=>{drawing=Boolean(e.mode?.startsWith('draw_'));};
    let popup:mapboxgl.Popup|undefined;
    const draw=()=>{
      if(!event)return;
      // Camera fitting can leave the style waiting for base-map tiles even
      // after style.load. Retry once the map settles instead of losing the event.
      if(!map.isStyleLoaded()){map.once('idle',draw);return;}
      const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:visibleEventFeatures(event,minimumHailMM)};
      const existing=map.getSource(source) as mapboxgl.GeoJSONSource|undefined;
      if(existing)existing.setData(data);else map.addSource(source,{type:'geojson',data});
      if(!map.getLayer(layers[0]))map.addLayer({id:layers[0],type:'fill',source,filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':areaColor,'fill-opacity':0.16}});
      if(!map.getLayer(layers[1]))map.addLayer({id:layers[1],type:'line',source,filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':areaColor,'line-width':1.5,'line-opacity':0.8}});
      if(!map.getLayer(layers[2]))map.addLayer({id:layers[2],type:'line',source,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['case',['==',['get','kind'],'forecast'],'#fbbf24','#a78bfa'],'line-width':3,'line-opacity':0.8}});
      if(!map.getLayer(layers[3]))map.addLayer({id:layers[3],type:'circle',source,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,3,9,6],'circle-color':['case',['==',['get','kind'],'forecast'],'#fbbf24',['case',['all',['!=',['get','windKPH'],null],['==',['get','hailMM'],null]],['interpolate',['linear'],['get','windKPH'],0,'#67e8f9',93,'#fde047',119,'#fb923c',150,'#f87171'],['interpolate',['linear'],['coalesce',['get','hailMM'],0],0,'#67e8f9',25.4,'#c084fc',50.8,'#f472b6',76.2,'#f87171']]],'circle-stroke-color':'#0f172a','circle-stroke-width':1.5}});
    };
    const clicked=(e:mapboxgl.MapMouseEvent)=>{
      if(territoryDrawing||drawing)return;
      onLocation({lon:e.lngLat.lng,lat:e.lngLat.lat});
      if(!map.getLayer(layers[3]))return;
      const hit=map.queryRenderedFeatures(e.point,{layers:[layers[3],layers[0]]})[0];
      if(!hit)return;
      const p=hit.properties||{},el=document.createElement('div');
      el.style.color='#0f172a';el.style.maxWidth='240px';
      el.textContent=[p.label,p.advisoryPhase?`${p.advisoryPhase} advisory`:'',new Date(p.time).toLocaleString(),p.category?`Category: ${p.category}`:'',p.hailMM!=null?`Reported hail: ${Number(p.hailMM).toFixed(1)} mm`:'',p.windKPH!=null?`Sustained wind: ${p.windKPH} km/h`:'',p.description||''].filter(Boolean).join(' · ');
      popup?.remove();popup=new mapboxgl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    };
    draw();map.on('style.load',draw);map.on('click',clicked);map.on('draw.modechange',modeChanged);
    return()=>{map.off('idle',draw);map.off('draw.modechange',modeChanged);map.off('style.load',draw);map.off('click',clicked);popup?.remove();for(const id of layers)if(map.getLayer(id))map.removeLayer(id);if(map.getSource(source))map.removeSource(source);};
  },[map,event,minimumHailMM,onLocation,territoryDrawing]);
  return null;
}
