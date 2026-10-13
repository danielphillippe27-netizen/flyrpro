import { feature, featureCollection, union, intersect, bboxPolygon } from '@turf/turf';
import type { StormEvent } from './model';
import type { StormGeometry } from './geometry';
/** Union supplied historical advisory wind fields; never buffer centre tracks. */
export function hurricaneWindArea(event: StormEvent, minimumKTS: number, bounds?: [number,number,number,number]): StormGeometry | null {
  const fields=event.features.flatMap(f=>f.properties.kind==='wind-field'&&(f.properties.minimumKTS??0)>=minimumKTS&&(f.geometry.type==='Polygon'||f.geometry.type==='MultiPolygon')?[feature(f.geometry)]:[]);
  if(!fields.length)return null;
  const combined=fields.length===1?fields[0]:union(featureCollection(fields));
  if(!combined)return null;
  return bounds?intersect(featureCollection([combined,bboxPolygon(bounds)]))?.geometry??null:combined.geometry;
}
