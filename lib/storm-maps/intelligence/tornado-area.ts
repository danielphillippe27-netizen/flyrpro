import { buffer, featureCollection, union } from '@turf/turf';
import type { StormEvent } from './model';
import type { StormGeometry } from './geometry';
/** User-selected proximity areas for prospecting, not tornado impact geometry. */
export function tornadoProspectingAreas(event:StormEvent,radiusKM:number){
 if(event.hazard!=='tornado'||!Number.isFinite(radiusKM)||radiusKM<0.5||radiusKM>5)return [];
 return event.features.flatMap(report=>{
  if(report.properties.kind!=='report'||report.geometry.type!=='Point')return [];
  const buffered=buffer(report,radiusKM,{units:'kilometers',steps:24});
  return buffered?[{...buffered,properties:{id:report.properties.id,label:`Nearby prospecting area · ${radiusKM} km radius`,time:report.properties.time}}]:[];
 });
}
export function selectedTornadoProspectingArea(event:StormEvent,radiusKM:number,ids:string[]):StormGeometry|null{
 const areas=tornadoProspectingAreas(event,radiusKM).filter(f=>ids.includes(f.properties.id));
 if(!areas.length)return null;
 return areas.length===1?areas[0].geometry:union(featureCollection(areas))?.geometry??null;
}
