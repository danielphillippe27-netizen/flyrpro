// Map Buildings Types for Fill-Extrusion Visualization
// These types correspond to the map_buildings schema tables

export interface MapBuilding {
  id: string; // UUID
  source: string; // 'overture', 'manual', etc.
  gers_id: string | null; // Overture GERS ID or other source identifier - UUID v4 format (128-bit)
  geom: string; // PostGIS Polygon geometry (GeoJSON string)
  centroid: string; // PostGIS Point geometry (GeoJSON string) - generated column
  height_m: number | null;
  levels: number | null;
  is_townhome_row: boolean;
  units_count: number;
  divider_lines: string | null; // PostGIS MultiLineString (GeoJSON string)
  unit_points: string | null; // PostGIS MultiPoint (GeoJSON string)
  address_id: string | null; // FK to campaign_addresses
  campaign_id: string | null; // FK to campaigns
  house_number: string | null; // House number from Overture address data
  street_name: string | null; // Street name from Overture address data
  created_at: string;
  updated_at: string;
}

export interface BuildingStats {
  building_id: string; // UUID, FK to map_buildings.id
  campaign_id: string | null; // FK to campaigns
  status: 'not_visited' | 'visited' | 'hot';
  scans_total: number;
  scans_today: number;
  last_scan_at: string | null; // ISO timestamp
  updated_at: string;
}

export interface ScanEvent {
  id: string; // UUID
  building_id: string; // FK to map_buildings.id
  campaign_id: string | null; // FK to campaigns
  scanned_at: string; // ISO timestamp
  qr_id: string | null; // Optional QR code identifier
  qr_code_id: string | null; // FK to qr_codes
  address_id: string | null; // FK to campaign_addresses
}

// Properties that will be attached to GeoJSON features from RPC
export interface BuildingProperties {
  id: string;
  /** Building UUID (always present). For slices, use this for building-level operations. */
  building_id?: string;
  /** Address UUID (present when feature has an address link). For slices, this identifies the specific unit. */
  address_id?: string;
  gers_id?: string | null; // Overture GERS ID for linking to contacts
  height_m: number; // Building height in meters from map_buildings table
  min_height: number;
  is_townhome: boolean;
  units_count: number;
  status: 'not_visited' | 'visited' | 'hot';
  scans_today: number;
  scans_total: number;
  qr_scanned?: boolean; // True when scans_total > 0, used for yellow color
  last_scan_seconds_ago: number | null;
  unit_points?: GeoJSON.MultiPoint | null; // Parsed GeoJSON geometry
  divider_lines?: GeoJSON.MultiLineString | null; // Parsed GeoJSON geometry
  /** Stable linker: matched (has link) vs orphan_building (no link). From rpc_get_campaign_map_features. */
  feature_status?: 'matched' | 'orphan_building';
  /** Voronoi slicer: unit_slice (multi-unit building slice), matched_house (single-unit), orphan (no address). */
  feature_type?: 'unit_slice' | 'matched_house' | 'orphan';
  /** Stable linker: how address was linked (COVERS, NEAREST). From rpc_get_campaign_map_features. */
  match_method?: string | null;
  /** Formatted address from linked campaign_addresses. From rpc_get_campaign_map_features. */
  address_text?: string | null;
  /** Unique id for Mapbox promoteId (unit id for slices, gers_id for detached). Used for setFeatureState. */
  feature_id?: string;
}

// GeoJSON Feature with BuildingProperties
export interface BuildingFeature extends GeoJSON.Feature<GeoJSON.Polygon, BuildingProperties> {
  id: string;
  geometry: GeoJSON.Polygon;
  properties: BuildingProperties;
}

// GeoJSON FeatureCollection response from RPC
export interface BuildingFeatureCollection extends GeoJSON.FeatureCollection<GeoJSON.Polygon, BuildingProperties> {
  type: 'FeatureCollection';
  features: BuildingFeature[];
}

// RPC function parameters
export interface GetBuildingsInBboxParams {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
  p_campaign_id?: string | null; // Optional campaign_id filter
}
