import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {CampaignAddressPmtilesLayer} from '../../../components/map/CampaignAddressPmtilesLayer';
import type {CampaignAddress} from '../../../types/database';

async function main() {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {React, window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true});
  type Layer = {id:string; source:string; type:string; minzoom?:number; maxzoom?:number; filter:unknown[]; paint:Record<string,unknown>};
  type Source = {data:GeoJSON.FeatureCollection; setData:(data:GeoJSON.FeatureCollection)=>void};
  const layers = new Map<string, Layer>(), sources = new Map<string, Source>();
  const events = new Map<string, Set<(event:unknown)=>void>>();
  let clicked:string|null = null;
  const map = {
    getStyle:()=>({layers:[], sources:{}}), isStyleLoaded:()=>true,
    getLayer:(id:string)=>layers.get(id), getSource:(id:string)=>sources.get(id),
    addLayer:(layer:Layer)=>layers.set(layer.id,layer),
    addSource:(id:string,source:{data:GeoJSON.FeatureCollection})=>sources.set(id,{...source,setData(data:GeoJSON.FeatureCollection){this.data=data;}}),
    removeLayer:(id:string)=>layers.delete(id), removeSource:(id:string)=>sources.delete(id),
    setFilter:(id:string,filter:unknown[])=>{layers.get(id)!.filter=filter;},
    setPaintProperty:(id:string,key:string,value:unknown)=>{layers.get(id)!.paint[key]=value;},
    setFeatureState:()=>{}, getCanvas:()=>({style:{cursor:''}}),
    queryRenderedFeatures:(_point:unknown,options:{layers:string[]})=>options.layers.includes('campaign-addresses-pmtiles-lead-glow')
      ? [{properties:{address_id:'home-1',building_id:'building-1'}}] : [],
    on:(name:string,fn:(event:unknown)=>void)=>{if(!events.has(name))events.set(name,new Set());events.get(name)!.add(fn);},
    off:(name:string,fn:(event:unknown)=>void)=>events.get(name)?.delete(fn),
  };
  const addresses:CampaignAddress[]=[1,2].map(number=>({
    id:`home-${number}`, campaign_id:'test-campaign', address:`${number} Test Street`,
    formatted:`${number} Test Street`, source:'map', created_at:'2026-10-24T00:00:00Z',
    coordinate:{lon:-112.8+number*0.01,lat:48.2+number*0.01}, address_status:'none',
  }));
  const root=createRoot(document.getElementById('root')!);
  const render=async(visible=true,deletedAddressIds:string[]=[])=>act(async()=>{
    root.render(<CampaignAddressPmtilesLayer map={map as never} campaignId={null} mapLoaded visible={visible}
      addresses={addresses} deletedAddressIds={deletedAddressIds} allowFallbackFetches={false}
      onAddressClick={id=>{clicked=id;}}/>);
  });
  await render();
  const dots=layers.get('campaign-addresses-pmtiles-lead-glow')!;
  assert(dots,'Local campaign addresses get overview dots as well as cylinders');
  assert.equal(dots.type,'circle');
  assert((dots.minzoom??0)<7.91,'Dots are visible at the reported regional zoom');
  assert.equal(dots.maxzoom,16,'Overview dots give way to detailed cylinders at street level');
  assert.deepEqual(dots.filter[1],['==',['geometry-type'],'Point']);
  assert.equal(sources.get(dots.source)!.data.features.filter((f)=>f.geometry.type==='Point').length,2);
  await act(async()=>{for(const fn of events.get('click')??[])fn({point:{x:1,y:1},originalEvent:{}});});
  assert.equal(clicked,'home-1','Overview dots open the same address card as detailed homes');
  await render(true,['home-1']);
  assert(sources.get(dots.source)!.data.features.every((f)=>f.properties?.address_id==='home-2'),'Deleted homes are removed from overview markers');
  assert.deepEqual(layers.get(dots.id)!.filter[1],['==',['geometry-type'],'Point'],'Refresh keeps the point filter');
  await render(false);
  assert.equal(layers.size,0,'Switching to Buildings removes address dots and cylinders');
  await act(async()=>root.unmount());
  assert([...events.values()].every(set=>set.size===0));
  console.log('PASS: regional address visibility, street-level transition, address clicks, deletion and view cleanup.');
}
main().catch(error=>{console.error(error);process.exit(1);});
