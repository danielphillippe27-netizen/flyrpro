import { z } from 'zod';
import { area, difference, feature, featureCollection, intersect, kinks } from '@turf/turf';
import { reviewPolygonSchema } from './territory-review';
export type StormGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export const stormGeometrySchema = z.union([reviewPolygonSchema, z.object({type:z.literal('MultiPolygon'),coordinates:z.array(reviewPolygonSchema.shape.coordinates).min(1).max(50)}).strict()]).superRefine((geometry,ctx)=>{
  const parts=geometry.type==='Polygon'?[geometry]:geometry.coordinates.map(coordinates=>({type:'Polygon' as const,coordinates}));
  if(parts.some(p=>!reviewPolygonSchema.safeParse(p).success)||area(geometry)>500_000_000)ctx.addIssue({code:'custom',message:'Invalid or oversized territory.'});
  try {if(kinks(geometry).features.length)ctx.addIssue({code:'custom',message:'Crossing boundary.'});}catch{ctx.addIssue({code:'custom',message:'Invalid geometry.'});}
});
export const HAIL_THRESHOLDS = [25.4,44.45,63.5] as const;
export function effectiveStormArea(boundary:StormGeometry,zone:StormGeometry|null,includeOutside=false):StormGeometry|null{
  if(includeOutside)return boundary;
  if(!zone)return null;
  return intersect(featureCollection([feature(boundary),feature(zone)]))?.geometry??null;
}
export function containedStormArea(child:StormGeometry,parent:StormGeometry){
  try {const outside=difference(featureCollection([feature(child),feature(parent)]));return !outside||area(outside)<=1;}catch{return false;}
}
