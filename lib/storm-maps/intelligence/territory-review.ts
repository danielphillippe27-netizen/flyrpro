import { z } from 'zod';
import { area, booleanPointInPolygon, feature, featureCollection, intersect, kinks } from '@turf/turf';
import type { Polygon, MultiPolygon } from 'geojson';

const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-85).max(85)]);
function polygonSchema(maxAreaKM2: number) { return z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(position).min(4).max(500)).min(1).max(20),
}).strict().superRefine((polygon, ctx) => {
  const rings = polygon.coordinates;
  if (rings.reduce((sum, ring) => sum + ring.length, 0) > 1000 || rings.some(ring => {
    const first = ring[0], last = ring[ring.length - 1];
    return first[0] !== last[0] || first[1] !== last[1] || ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
  })) ctx.addIssue({code:'custom', message:'Use a closed local boundary with at most 1,000 vertices.'});
  try {
    const size = area(polygon);
    if (size <= 0 || size > maxAreaKM2 * 1_000_000 || kinks(polygon).features.length) ctx.addIssue({code:'custom',message:`Use a non-crossing boundary smaller than ${maxAreaKM2.toLocaleString()} km².`});
  } catch { ctx.addIssue({code:'custom',message:'Invalid territory boundary.'}); }
}); }
export const reviewPolygonSchema = polygonSchema(500);
export const stormTerritoryPolygonSchema = polygonSchema(5_000);

export type InspectionRecord = {
  id: string; event_key: string; longitude: number; latitude: number;
  property_label: string; outcome: string; notes: string; observed_at: string;
};
// Exact recorded point and label, not a claim that neighboring pins identify
// one parcel. Preserve separate units sharing a building coordinate.
export function latestInspectionRecords(records: InspectionRecord[]) {
  const latest = new Map<string, InspectionRecord>();
  for (const row of records) {
    const key = JSON.stringify([row.longitude, row.latitude, row.property_label.trim().toLowerCase()]);
    const prior = latest.get(key);
    if (!prior || row.observed_at > prior.observed_at || (row.observed_at === prior.observed_at && row.id > prior.id)) latest.set(key, row);
  }
  return [...latest.values()].sort((a,b) => b.observed_at.localeCompare(a.observed_at) || b.id.localeCompare(a.id));
}
export function inspectionsWithin(records: InspectionRecord[], polygon: Polygon) {
  return latestInspectionRecords(records).filter(row => booleanPointInPolygon([row.longitude,row.latitude], polygon));
}
export function overlapSquareMeters(polygon: Polygon, other: Polygon | MultiPolygon): number {
  const intersection = intersect(featureCollection([feature(polygon), feature(other)]));
  return intersection ? area(intersection) : 0;
}
export type TerritoryReview = {
  areaKM2: number;
  campaigns: Array<{id:string;name:string;overlapKM2:number;selectedAreaPercent:number;status:string}>;
  inspections: InspectionRecord[];
  scope: string;
  complete: boolean;
  warnings: string[];
};
