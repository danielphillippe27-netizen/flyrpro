import { createHash } from 'node:crypto';
import type { StormEvent, StormHazard, StormMapFeature } from './model';

const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0,20);
export function reportEvents(collection: GeoJSON.FeatureCollection, bbox: number[], start: string, end: string, hazard: StormHazard): StormEvent[] {
  const groups = new Map<string, StormEvent>();
  for (const f of collection.features || []) {
    if (f.geometry?.type !== 'Point') continue;
    const p = f.properties || {}, [lon,lat] = f.geometry.coordinates;
    const time=String(p.valid || ''), timestamp=Date.parse(time);
    if (!Number.isFinite(timestamp) || timestamp < Date.parse(start) || timestamp >= Date.parse(end) || lon<bbox[0]||lon>bbox[2]||lat<bbox[1]||lat>bbox[3]) continue;
    const type=String(p.typetext || '').toUpperCase();
    const kind: StormHazard | null = type.includes('HAIL') ? 'hail' : type.includes('TORNADO') ? 'tornado' : type.includes('WND') || type.includes('WIND') ? 'wind' : null;
    if (!kind || kind !== hazard) continue;
    const day=new Date(timestamp).toISOString().slice(0,10), state=String(p.state || p.st || 'US').slice(0,12);
    const key=`iem:${kind}:${day}:${state}`;
    let event=groups.get(key);
    if (!event) {
      event={key,title:`${state} ${kind} reports · ${day}`,hazard:kind,source:'iem',sourceId:`${day}:${state}`,start:`${day}T00:00:00Z`,end:new Date(Date.parse(`${day}T00:00:00Z`)+86400000-1000).toISOString(),features:[],reportCount:0,maxHailMM:null,maxWindKPH:null,category:null,active:false,footprintStatus:'unavailable'};
      groups.set(key,event);
    }
    const magnitude=Number(p.magnitude ?? p.magf), validMagnitude=(p.magnitude ?? p.magf) != null && Number.isFinite(magnitude) && magnitude >= 0;
    const hailMM=kind==='hail'&&validMagnitude ? magnitude*25.4 : null;
    const windUnit=String(p.unit||'').toLowerCase();
    const windKPH=kind==='wind'&&validMagnitude&&(type.includes('GUST')||type.includes('GST')) ? windUnit.includes('knot')?magnitude*1.852:windUnit.includes('mph')?magnitude*1.609344:null : null;
    const id=hash(JSON.stringify([p.product_id,time,lon,lat,type,p.remark,magnitude]));
    if (event.features.some(x=>x.properties.id===id)) continue;
    event.features.push({type:'Feature',geometry:f.geometry,properties:{id,label:`${type} · ${String(p.city || state)}`,time,kind:'report',hailMM,windKPH,description:String(p.remark||'').slice(0,1500)}});
    event.reportCount++;
    if(hailMM!=null)event.maxHailMM=Math.max(event.maxHailMM||0,hailMM);
    if(windKPH!=null)event.maxWindKPH=Math.max(event.maxWindKPH||0,windKPH);
  }
  return [...groups.values()].sort((a,b)=>b.start.localeCompare(a.start));
}

type CyclonePoint = {loc?:{long:number;lat:number};location?:GeoJSON.Point;dateTimeISO:string;details?:{stormCat?:string;windSpeedKPH?:number;gustSpeedKPH?:number|null;pressureMB?:number|null;windRadii?:Array<{windField?:GeoJSON.Polygon|GeoJSON.MultiPolygon;windSpeedKTS:number}>|null}};
export type CycloneResponse = {id:string;profile:{name:string;year:number;isActive:boolean;maxStormCat:string;windSpeed?:{maxKPH:number};lifespan:{startDateTimeISO:string;endDateTimeISO:string|null}};track?:CyclonePoint[];forecast?:CyclonePoint[];position?:CyclonePoint|null;errorCone?:GeoJSON.Polygon|GeoJSON.MultiPolygon|null};
export function cycloneEvent(row: CycloneResponse): StormEvent {
  const features:StormMapFeature[]=[];
  for(const [kind,values] of [['track',row.track||[]],['forecast',row.forecast||[]]] as const){
    const points=values.flatMap((p)=>{
      const coordinates=p.location?.coordinates||(p.loc?[p.loc.long,p.loc.lat]:null);
      if(!coordinates || coordinates.some(v=>!Number.isFinite(v)))return [];
      return [{p,coordinates}];
    });
    // Split at the date line instead of drawing a line across the whole world.
    let segment:number[][]=[];
    const flush=()=>{if(segment.length>1)features.push({type:'Feature',geometry:{type:'LineString',coordinates:segment},properties:{id:`${row.id}:${kind}:${features.length}`,label:row.profile.name,time:points[0]?.p.dateTimeISO||row.profile.lifespan.startDateTimeISO,kind}});segment=[];};
    for(const {p,coordinates} of points){
      if(segment.length && Math.abs(coordinates[0]-segment[segment.length-1][0])>180)flush();
      segment.push(coordinates);
      if(kind==='track')for(const field of p.details?.windRadii??[]){if(field.windField&&['Polygon','MultiPolygon'].includes(field.windField.type))features.push({type:'Feature',geometry:field.windField,properties:{id:`${row.id}:wind:${p.dateTimeISO}:${field.windSpeedKTS}`,label:`${row.profile.name} · ${field.windSpeedKTS} kt+ wind`,time:p.dateTimeISO,kind:'wind-field',minimumKTS:field.windSpeedKTS}});}
      features.push({type:'Feature',geometry:{type:'Point',coordinates},properties:{id:`${row.id}:${kind}:${p.dateTimeISO}`,label:`${row.profile.name} · ${p.details?.stormCat||''}`,time:p.dateTimeISO,kind:kind==='forecast'?'forecast':'position',windKPH:p.details?.windSpeedKPH??null,gustKPH:p.details?.gustSpeedKPH??null,pressureMB:p.details?.pressureMB??null,category:p.details?.stormCat}});
    }
    flush();
  }
  if(row.errorCone&&['Polygon','MultiPolygon'].includes(row.errorCone.type))features.push({type:'Feature',geometry:row.errorCone,properties:{id:`${row.id}:forecast-cone`,label:'Forecast centre uncertainty',time:row.position?.dateTimeISO??row.profile.lifespan.startDateTimeISO,kind:'cone'}});
  return {key:`xweather:${row.id}`,sourceId:row.id,title:`${row.profile.name} · ${row.profile.year}`,source:'xweather',hazard:'hurricane',start:row.profile.lifespan.startDateTimeISO,end:row.profile.lifespan.endDateTimeISO||new Date().toISOString(),features,reportCount:0,maxHailMM:null,maxWindKPH:row.profile.windSpeed?.maxKPH??null,category:row.profile.maxStormCat,active:row.profile.isActive,footprintStatus:'unavailable'};
}
