import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {StormTerritoryOverlay} from '../../../components/storm-maps/StormTerritoryOverlay';
async function main(){
 const dom=new JSDOM('<div id="root"></div>');
 Object.assign(globalThis,{React,window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 let ready=false,disposed=false;
 const sources=new Map<string,unknown>(),layers=new Map<string,unknown>(),events=new Map<string,Set<()=>void>>();
 const map={isStyleLoaded:()=>ready&&!disposed,getStyle:()=>{if(!ready||disposed)throw Error('Style is not done loading');return {layers:[]};},getLayer:(id:string)=>{if(disposed)throw Error('Disposed map');return layers.get(id);},getSource:(id:string)=>{if(disposed)throw Error('Disposed map');return sources.get(id);},addLayer:(layer:{id:string})=>layers.set(layer.id,layer),addSource:(id:string,value:unknown)=>sources.set(id,value),removeLayer:(id:string)=>layers.delete(id),removeSource:(id:string)=>sources.delete(id),on:(event:string,callback:()=>void)=>{if(!events.has(event))events.set(event,new Set());events.get(event)!.add(callback);},off:(event:string,callback:()=>void)=>events.get(event)?.delete(callback)};
 const territory={name:'Wind test',boundary:{type:'Polygon',coordinates:[[[-113,48],[-112,48],[-112,49],[-113,49],[-113,48]]]},context:{minimumHailMM:null,gustSelection:{minimumKPH:93.341952,maximumKPH:null,time:'2026-10-18T02:00:00.000Z'}}};
 const root=createRoot(document.getElementById('root')!);
 const render=async(value:typeof territory|null)=>{await act(async()=>{root.render(<StormTerritoryOverlay map={map as never} territory={value as never}/>);});};
 const emit=async(event:string)=>{await act(async()=>{for(const callback of events.get(event)??[])callback();});};
 await render(null);await render(territory);
 assert.equal(sources.size,0,'Campaign mount waits for the basemap instead of crashing');
 await emit('style.load');assert.equal(sources.size,0,'Early style.load is safe while tiles are loading');
 ready=true;await emit('idle');assert(sources.has('campaign-storm-territory'));assert.equal(layers.size,4);
 const paint=(layers.get('campaign-storm-territory-fill') as {paint:Record<string,unknown>}).paint;assert.equal(paint['fill-color'],'#a78bfa');assert.equal(paint['fill-opacity'],0.1,'Saved territory leaves the basemap readable');
 ready=false;sources.clear();layers.clear();await emit('style.load');ready=true;await emit('idle');assert.equal(layers.size,4,'Wind outline returns after a basemap switch');
 ready=false;await render(null);ready=true;await emit('idle');assert.equal(layers.size,0,'Disabling while loading removes the outline once ready');
 await render(territory);assert.equal(layers.size,4);
 disposed=true;await act(async()=>{root.unmount();});assert([...events.values()].every(set=>set.size===0),'Disposed maps detach listeners safely');
 console.log('PASS: campaign storm overlay waits for map readiness, recovers from style switches, clears disabled layers and tolerates disposal.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
