import { z } from 'zod';
import { area, difference, feature, featureCollection } from '@turf/turf';
import { campaignStormSchema, type StormCampaignContext } from './model';
import { stormTerritoryPolygonSchema } from './territory-review';
export const stormTerritorySchema = z.object({
  name: z.string().trim().min(1).max(160), boundary: stormTerritoryPolygonSchema,
  context: campaignStormSchema,
}).strict();
export type SavedStormTerritory = {
  id: string; name: string; boundary: GeoJSON.Polygon; context: StormCampaignContext; created_at: string;
};
export function campaignWithinStormTerritory(child: GeoJSON.Polygon, parent: GeoJSON.Polygon) {
  try {
    const outside = difference(featureCollection([feature(child), feature(parent)]));
    return !outside || area(outside) <= 1; // one square metre for numeric roundoff only
  } catch { return false; }
}
