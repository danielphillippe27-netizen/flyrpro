// Campaign Roads — types for rpc_get_campaign_road_metadata, rpc_get_campaign_roads_v2, and p_roads payload

/** Preparation status from campaign_road_metadata / rpc_get_campaign_road_metadata */
export type CampaignRoadsStatus = 'pending' | 'fetching' | 'ready' | 'failed';

/** JSONB object returned by rpc_get_campaign_road_metadata */
export interface CampaignRoadMetadata {
  campaign_id: string;
  roads_status: CampaignRoadsStatus;
  road_count: number;
  cache_version: number;
  corridor_build_version: number;
  fetched_at: string | null;
  expires_at: string | null;
  last_refresh_at: string | null;
  age_days: number | null;
  is_stale: boolean;
  last_error_message: string | null;
  source: string;
}

/** Properties on each feature from rpc_get_campaign_roads_v2 */
export interface CampaignRoadFeatureProperties {
  id: string;
  name: string | null;
  class: string;
  cache_version?: number;
  corridor_build_version?: number;
}

/** GeoJSON Feature for one road (LineString) from rpc_get_campaign_roads_v2 */
export interface CampaignRoadFeature extends GeoJSON.Feature<GeoJSON.LineString, CampaignRoadFeatureProperties> {
  id?: string;
}

/** GeoJSON FeatureCollection returned by rpc_get_campaign_roads_v2 */
export interface CampaignRoadsFeatureCollection extends GeoJSON.FeatureCollection<GeoJSON.LineString, CampaignRoadFeatureProperties> {
  type: 'FeatureCollection';
  features: CampaignRoadFeature[];
}

/** One element of the p_roads array for rpc_upsert_campaign_roads */
export interface UpsertRoadPayload {
  road_id: string;
  road_name: string | null;
  road_class: string;
  geom: GeoJSON.LineString;
  bbox_min_lat: number;
  bbox_min_lon: number;
  bbox_max_lat: number;
  bbox_max_lon: number;
  source: string;
  source_version: string | null;
  properties: Record<string, unknown>;
}

/** Metadata object for rpc_upsert_campaign_roads p_metadata */
export interface UpsertRoadsMetadataPayload {
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  source: string;
  corridor_build_version: number;
}
