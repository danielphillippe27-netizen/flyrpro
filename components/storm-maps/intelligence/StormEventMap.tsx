'use client';
import { useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import type { StormEvent } from '@/lib/storm-maps/intelligence/model';
import { hurricaneWindArea } from '@/lib/storm-maps/intelligence/hurricane-area';
import { visibleEventFeatures } from '@/lib/storm-maps/intelligence/model';
const source='storm-intelligence-event';
const layers=['storm-intelligence-line','storm-intelligence-points','storm-intelligence-wind-fill','storm-intelligence-wind-line','storm-intelligence-category'];
export function StormEventMap({map,event,minimumHailMM,onLocation}:{map:mapboxgl.Map;event:StormEvent|null;minimumHailMM:number;onLocation:(point:{lon:number;lat:number})=>void}){
  useEffect(()=>{
    let drawing=false;
    const modeChanged=(e:{mode?:string})=>{drawing=Boolean(e.mode?.startsWith('draw_'));};
    let popup:mapboxgl.Popup|undefined;
    const draw=()=>{
      if(!event)return;
      // Camera fitting can leave the style waiting for base-map tiles even
      // after style.load. Retry once the map settles instead of losing the event.
      if(!map.isStyleLoaded()){map.once('idle',draw);return;}
      const data:GeoJSON.FeatureCollection={type:'FeatureCollection',features:[...visibleEventFeatures(event,minimumHailMM).filter(f=>f.properties.kind!=='wind-field'),...([34,50,64].flatMap(minimumKTS=>{const geometry=event.hazard==='hurricane'?hurricaneWindArea(event,minimumKTS):null;return geometry?[{type:'Feature' as const,geometry,properties:{kind:'wind-field',minimumKTS,label:`${minimumKTS} kt+ historical advisory extent`}}]:[]}))]};
      const existing=map.getSource(source) as mapboxgl.GeoJSONSource|undefined;
      if(existing)existing.setData(data);else map.addSource(source,{type:'geojson',data});
      if(!map.getLayer(layers[2]))map.addLayer({id:layers[2],type:'fill',source,filter:['in',['get','kind'],['literal',['wind-field','cone']]],paint:{'fill-color':['case',['==',['get','kind'],'cone'],'#fbbf24',['step',['get','minimumKTS'],'#38bdf8',50,'#fb923c',64,'#ef4444']],'fill-opacity':0.18}});
      if(!map.getLayer(layers[3]))map.addLayer({id:layers[3],type:'line',source,filter:['==',['get','kind'],'wind-field'],paint:{'line-color':'#111111','line-width':1}});
      if(!map.getLayer(layers[0]))map.addLayer({id:layers[0],type:'line',source,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['case',['==',['get','kind'],'forecast'],'#fbbf24','#a78bfa'],'line-width':3,'line-opacity':0.8}});
      if(!map.getLayer(layers[1]))map.addLayer({id:layers[1],type:'circle',source,filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':event.hazard==='hurricane'?12:['interpolate',['linear'],['zoom'],3,3,9,6],'circle-color':event.hazard==='hurricane'?['match',['get','category'],'H1','#e00000','H2','#ff00a8','H3','#cb00f0','H4','#ee99ee','H5','#eeeeee','TS','#ffab00','TD','#ffdf00','#6594ef']:['case',['==',['get','kind'],'forecast'],'#fbbf24',['interpolate',['linear'],['coalesce',['get','hailMM'],0],0,'#67e8f9',25.4,'#c084fc',50.8,'#f472b6',76.2,'#f87171']],'circle-stroke-color':'#0f172a','circle-stroke-width':1.5}});
      if(event.hazard==='hurricane'&&!map.getLayer(layers[4]))map.addLayer({id:layers[4],type:'symbol',source,filter:['==',['geometry-type'],'Point'],layout:{'text-field':['case',['in',['get','category'],['literal',['H1','H2','H3','H4','H5']]],['slice',['get','category'],1],['coalesce',['get','category'],'L']],'text-size':13,'text-allow-overlap':true},paint:{'text-color':'#ffffff','text-halo-color':'#111111','text-halo-width':1}});
    };
    const clicked=(e:mapboxgl.MapMouseEvent)=>{
      if(drawing)return;
      if(e.type==='click')onLocation({lon:e.lngLat.lng,lat:e.lngLat.lat});
      if(!map.getLayer(layers[1]))return;
      const hit=map.queryRenderedFeatures(e.point,{layers:[layers[1]]})[0];
      if(!hit){if(e.type!=='click')popup?.remove();return;}
      const p=hit.properties||{},el=document.createElement('div');
      el.style.color='#0f172a';el.style.maxWidth='240px';
      el.textContent=[p.label,new Date(p.time).toLocaleString(),p.hailMM!=null?`Reported hail: ${Number(p.hailMM).toFixed(1)} mm`:'',p.windKPH!=null?`Sustained wind: ${p.windKPH} km/h`:'',p.gustKPH!=null?`Gusts: ${p.gustKPH} km/h`:'',p.pressureMB!=null?`Pressure: ${p.pressureMB} hPa`:'',p.description||''].filter(Boolean).join(' · ');
      popup?.remove();popup=new mapboxgl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    };
    draw();map.on('style.load',draw);map.on('click',clicked);map.on('mousemove',clicked);map.on('draw.modechange',modeChanged);
    return()=>{map.off('idle',draw);map.off('draw.modechange',modeChanged);map.off('style.load',draw);map.off('click',clicked);map.off('mousemove',clicked);popup?.remove();for(const id of layers)if(map.getLayer(id))map.removeLayer(id);if(map.getSource(source))map.removeSource(source);};
  },[map,event,minimumHailMM,onLocation]);
  return null;
}
