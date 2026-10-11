'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { eventBounds,type StormEvent,type StormHazard } from '@/lib/storm-maps/intelligence/model';
import { mergeStormEvents } from '@/lib/storm-maps/intelligence/history';
import { HAIL_THRESHOLDS,type StormGeometry } from '@/lib/storm-maps/intelligence/geometry';
import { StormEventMap } from './StormEventMap';
import { StormLocationSearch } from '../StormLocationSearch';
type Zone={id:string;minimum_mm:number;geometry:StormGeometry;source_resolution_m:number;estimation_method:string;source_updated_at:string};
const daysAgo=(days:number)=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
const input='w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground';
export function StormDiscoveryPanel({map,workspaceId,onSelect,onTerritory}:{map:mapboxgl.Map;workspaceId:string;onSelect:(event:StormEvent|null)=>void;onTerritory:()=>void}){
 const [period,setPeriod]=useState('30'),[from,setFrom]=useState(()=>daysAgo(29)),[to,setTo]=useState(()=>daysAgo(0)),[hazard,setHazard]=useState<StormHazard>('hail'),[minimum,setMinimum]=useState(25.4);
 const [events,setEvents]=useState<StormEvent[]>([]),[selected,setSelected]=useState<StormEvent|null>(null),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [zones,setZones]=useState<Zone[]>([]),[reason,setReason]=useState('Historical geometry unavailable.'),[counts,setCounts]=useState<Array<{minimumMM:number;count:number}>|null>(null);
 const [area,setArea]=useState('map'),[areaChanged,setAreaChanged]=useState(false),[windMinimum,setWindMinimum]=useState(0);
 const abortRef=useRef<AbortController|null>(null),searchBounds=useRef<number[]>([]);
 const select=useCallback((event:StormEvent|null)=>{setSelected(event);onSelect(event);if(event){const b=eventBounds(event);if(b)map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:80,maxZoom:12,retainPadding:false});}},[map,onSelect]);
 const search=useCallback(async(next:string|null=null)=>{
  abortRef.current?.abort();const abort=new AbortController();abortRef.current=abort;setBusy(true);setError('');
  if(!next){setEvents([]);setCursor(null);select(null);const b=map.getBounds();if(!b){setBusy(false);return;}setAreaChanged(false);searchBounds.current=area==='all'?[-180,-85,180,85]:[Math.max(-180,b.getWest()),Math.max(-85,b.getSouth()),Math.min(180,b.getEast()),Math.min(85,b.getNorth())];}
  const query=new URLSearchParams({workspaceId,from,to,hazard,bbox:searchBounds.current.join(',')});if(next)query.set('cursor',next);
  try{const r=await fetch(`/api/storm-maps/intelligence/events?${query}`,{signal:abort.signal});const data=await r.json();if(!r.ok)throw Error(data.error);if(!abort.signal.aborted){setEvents(previous=>mergeStormEvents(next?previous:[],data.events));setCursor(data.nextCursor);}}
  catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Storm search unavailable.');}finally{if(!abort.signal.aborted)setBusy(false);}
 },[workspaceId,from,to,hazard,map,select,area]);
 useEffect(()=>{const moved=()=>setAreaChanged(true);map.on('moveend',moved);return()=>{map.off('moveend',moved);};},[map]);
 useEffect(()=>{void search();return()=>abortRef.current?.abort();},[search]);
 useEffect(()=>{
  setZones([]);setCounts(null);setReason('Historical geometry unavailable.');if(!selected)return;
  const abort=new AbortController();
  void fetch(`/api/storm-maps/intelligence/zones?workspaceId=${encodeURIComponent(workspaceId)}&eventKey=${encodeURIComponent(selected.key)}`,{signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!abort.signal.aborted){setZones(d.zones??[]);setReason(d.reason??'');}if(d.exposureAvailable){const r=await fetch(`/api/storm-maps/intelligence/exposure?workspaceId=${encodeURIComponent(workspaceId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventKey:selected.key}),signal:abort.signal});const count=await r.json();if(!r.ok)throw Error(count.error);if(!abort.signal.aborted){setCounts(count.counts??null);if(!count.available)setReason(count.reason);}}}).catch(e=>{if(!abort.signal.aborted)setReason(e instanceof Error?e.message:'Geometry unavailable.');});
  return()=>abort.abort();
 },[selected,workspaceId]);
 useEffect(()=>{
  const source='wolfgrid-historical-severity',fill=source+'-fill',line=source+'-line';
  const clear=()=>{try{if(!map.getStyle())return;for(const id of [line,fill])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(source))map.removeSource(source);}catch{/* map disposed */}};
  const show=()=>{clear();if(!map.isStyleLoaded()||!zones.length)return;map.addSource(source,{type:'geojson',data:{type:'FeatureCollection',features:zones.filter(z=>z.minimum_mm>=minimum).map(z=>({type:'Feature',properties:{minimum:z.minimum_mm},geometry:z.geometry}))}});map.addLayer({id:fill,type:'fill',source,paint:{'fill-color':['step',['get','minimum'],'#facc15',44.45,'#fb923c',63.5,'#dc2626',76.2,'#7f1d1d'],'fill-opacity':0.3}});map.addLayer({id:line,type:'line',source,paint:{'line-color':'#111111','line-width':1}});};show();map.on('style.load',show);return()=>{map.off('style.load',show);clear();};
 },[map,zones,minimum]);
 const qualifying=events.filter(e=>hazard==='hail'?minimum===0||(e.maxHailMM??-1)>=minimum:hazard==='wind'?windMinimum===0||(e.maxWindKPH??-1)>=windMinimum:true).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
 return <div className="space-y-3">
 {!selected?<>
 <StormLocationSearch map={map} inline />
 <label className="block text-xs">Area<select aria-label="Storm search area" className={input} value={area} onChange={e=>setArea(e.target.value)}><option value="map">Current map area</option><option value="all">All available coverage</option></select></label>
 <label className="block text-xs">Date range<select aria-label="Historical storm range" className={input} value={period} onChange={e=>{setPeriod(e.target.value);if(e.target.value!=='custom'){setFrom(daysAgo(Number(e.target.value)-1));setTo(daysAgo(0));}}}>{[['7','Past 7 Days'],['30','Past 30 Days'],['90','Past 90 Days'],['365','Past Year'],['custom','Custom Date Range']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
 {period==='custom'&&<div className="flex gap-2"><input aria-label="Start date" className={input} type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/><input aria-label="End date" className={input} type="date" value={to} max={daysAgo(0)} onChange={e=>setTo(e.target.value)}/></div>}
 <label className="block text-xs">Storm type<select className={input} value={hazard} onChange={e=>setHazard(e.target.value as StormHazard)}>{['hail','wind','tornado','hurricane'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
 <button type="button" disabled={busy} onClick={()=>void search()} className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground">{areaChanged&&area==='map'?'Search this area':'Find storms'}</button>
 {areaChanged&&area==='map'&&<p className="text-xs text-cyan-200">Map moved. Search this area to update the list.</p>}
 </>:<><button type="button" onClick={()=>select(null)} className="text-xs text-cyan-200">← Recent storms</button><h3 className="font-semibold">{selected.title}</h3><p className="text-xs">{selected.start.slice(0,10)} · {selected.source==='iem'?'IEM reported observations':'Xweather advisory data'}</p><p className="text-xs">{selected.maxHailMM!=null?`Maximum reported hail: ${(selected.maxHailMM/25.4).toFixed(2)}″ / ${selected.maxHailMM.toFixed(1)} mm`:selected.category??'Intensity unavailable'}</p></>}
 {hazard==='hail'&&<label className="block text-xs">{zones.length?'Minimum estimated hail':'Minimum reported hail'}<select aria-label="Hail severity threshold" className={input} value={minimum} onChange={e=>setMinimum(Number(e.target.value))}><option value={0}>All sizes</option>{HAIL_THRESHOLDS.map(v=><option key={v} value={v}>{(v/25.4).toFixed(2)}″+ / {v} mm+</option>)}</select></label>}
 {hazard==='wind'&&<label className="block text-xs">Minimum reported wind<select aria-label="Wind severity threshold" className={input} value={windMinimum} onChange={e=>setWindMinimum(Number(e.target.value))}><option value={0}>All reported speeds</option><option value={93}>93 km/h+ · 58 mph+</option><option value={120}>120 km/h+ · 75 mph+</option><option value={160}>160 km/h+ · 100 mph+</option></select></label>}
 {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
 {!selected&&<><p className="text-xs font-semibold">Recent storms · {qualifying.length}</p>{qualifying.map(event=><button type="button" key={event.key} onClick={()=>select(event)} className="block w-full rounded-md px-2 py-3 text-left text-xs hover:bg-muted">{event.title}<span className="mt-1 block text-foreground">{event.start.slice(0,10)} · {event.hazard}{event.maxHailMM!=null?` · ${(event.maxHailMM/25.4).toFixed(2)}″ hail`:event.maxWindKPH!=null?` · ${event.maxWindKPH.toFixed(0)} km/h wind`:event.category?` · ${event.category}`:''}</span><span className="mt-1 block text-muted-foreground">{event.reportCount} reported observations · Reports only</span></button>)}{busy&&<p role="status" className="text-xs">Loading historical storms…</p>}{!busy&&!qualifying.length&&!error&&<p className="text-xs">No reports returned for this interval. This does not establish no storms.</p>}{cursor&&<><p className="text-[11px] text-amber-200">Partial results. Older dates in your selected range have not been queried.</p><button type="button" disabled={busy} onClick={()=>void search(cursor)} className="w-full rounded-lg border border-white/20 py-2 text-xs">Load older storms</button></>}</>}
 {selected&&<><p className="rounded-lg bg-amber-200/10 p-3 text-xs text-amber-200">{zones.length?'Radar-estimated severity; not confirmed damage.':reason+' Report points and centre tracks do not define an affected-area boundary.'}</p>{counts?<div className="space-y-2"><p className="text-xs font-semibold">Address Pins Exposed</p>{counts.map(c=><p key={c.minimumMM} className="text-xs">{(c.minimumMM/25.4).toFixed(2)}″+: {c.count.toLocaleString()}</p>)}</div>:<p className="text-xs text-muted-foreground">Storm exposure counts unavailable. Custom territory counts include all mapped address pins in your boundary.</p>}<button type="button" disabled title={zones.length?'Generate from validated zone':'Requires validated historical geometry'} className="w-full rounded-lg border border-white/20 py-2 text-xs disabled:opacity-40">Generate from severity zone</button><button type="button" onClick={onTerritory} className="w-full rounded-lg bg-cyan-200 py-3 text-sm font-semibold text-slate-950">Draw custom storm territory</button></>}
 <p className="text-[10px] text-muted-foreground">U.S. report coverage is incomplete. Estimated exposure does not confirm property damage.</p>
 <StormEventMap map={map} event={selected} minimumHailMM={minimum} onLocation={()=>{}} />
 </div>;
}
