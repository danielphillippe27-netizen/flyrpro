/**
 * Campaign roads: bbox computation and mapping from tiledecode_roads response to rpc_upsert_campaign_roads payload.
 * Coordinates are [lon, lat] throughout (GeoJSON / Mapbox convention).
 */

import type { UpsertRoadPayload, UpsertRoadsMetadataPayload } from '@/types/campaign-roads';

/** Feature shape returned by tiledecode_roads edge function */
export interface TiledecodeRoadFeature {
  type: 'Feature';
  geometry: GeoJSON.LineString;
  properties: {
    id?: string;
    name?: string | null;
    class?: string;
    [key: string]: unknown;
  };
}

/** Response shape from POST /functions/v1/tiledecode_roads */
export interface TiledecodeRoadsResponse {
  features: TiledecodeRoadFeature[];
}

/**
 * Compute bounding box from a LineString's coordinates array.
 * Coordinates are [lon, lat]. Returns min/max lat and lon.
 */
export function bboxFromLineString(coordinates: number[][]): {
  bbox_min_lon: number;
  bbox_min_lat: number;
  bbox_max_lon: number;
  bbox_max_lat: number;
} {
  if (!coordinates.length) {
    return { bbox_min_lon: 0, bbox_min_lat: 0, bbox_max_lon: 0, bbox_max_lat: 0 };
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const c of coordinates) {
    const lon = c[0];
    const lat = c[1];
    if (typeof lon === 'number' && !Number.isNaN(lon)) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    if (typeof lat === 'number' && !Number.isNaN(lat)) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return {
    bbox_min_lon: Number.isFinite(minLon) ? minLon : 0,
    bbox_min_lat: Number.isFinite(minLat) ? minLat : 0,
    bbox_max_lon: Number.isFinite(maxLon) ? maxLon : 0,
    bbox_max_lat: Number.isFinite(maxLat) ? maxLat : 0,
  };
}

const DEFAULT_SOURCE = 'mapbox';
const DEFAULT_CORRIDOR_BUILD_VERSION = 1;

/**
 * Map a single feature from tiledecode_roads to the shape required by rpc_upsert_campaign_roads p_roads array.
 */
export function mapTiledecodeFeatureToUpsertPayload(
  feature: TiledecodeRoadFeature,
  source: string = DEFAULT_SOURCE
): UpsertRoadPayload {
  const geom = feature.geometry;
  const coords = geom?.type === 'LineString' ? geom.coordinates ?? [] : [];
  const bbox = bboxFromLineString(coords);
  const props = feature.properties ?? {};
  const roadId = typeof props.id === 'string' ? props.id : `road_${Math.random().toString(36).slice(2, 11)}`;
  const roadName = props.name != null ? String(props.name) : null;
  const roadClass = typeof props.class === 'string' ? props.class : 'street';

  return {
    road_id: roadId,
    road_name: roadName || null,
    road_class: roadClass,
    geom: { type: 'LineString', coordinates: coords },
    bbox_min_lat: bbox.bbox_min_lat,
    bbox_min_lon: bbox.bbox_min_lon,
    bbox_max_lat: bbox.bbox_max_lat,
    bbox_max_lon: bbox.bbox_max_lon,
    source,
    source_version: null,
    properties: { ...props },
  };
}

/**
 * Build p_metadata for rpc_upsert_campaign_roads from the full list of road payloads.
 */
export function buildUpsertMetadataFromPayloads(
  payloads: UpsertRoadPayload[],
  corridorBuildVersion: number = DEFAULT_CORRIDOR_BUILD_VERSION
): UpsertRoadsMetadataPayload {
  if (payloads.length === 0) {
    return {
      bounds: { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 },
      source: DEFAULT_SOURCE,
      corridor_build_version: corridorBuildVersion,
    };
  }
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of payloads) {
    minLat = Math.min(minLat, p.bbox_min_lat);
    minLon = Math.min(minLon, p.bbox_min_lon);
    maxLat = Math.max(maxLat, p.bbox_max_lat);
    maxLon = Math.max(maxLon, p.bbox_max_lon);
  }
  return {
    bounds: {
      minLat: Number.isFinite(minLat) ? minLat : 0,
      minLon: Number.isFinite(minLon) ? minLon : 0,
      maxLat: Number.isFinite(maxLat) ? maxLat : 0,
      maxLon: Number.isFinite(maxLon) ? maxLon : 0,
    },
    source: payloads[0]?.source ?? DEFAULT_SOURCE,
    corridor_build_version: corridorBuildVersion,
  };
}
