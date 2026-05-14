import { NextRequest, NextResponse } from 'next/server';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { createAdminClient } from '@/lib/supabase/server';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { type CampaignSnapshotRow, resolveArtifactUrl } from '@/lib/diamond/geometry';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as turf from '@turf/turf';

type PointGeometry = {
  type: 'Point';
  coordinates: [number, number];
};
type AddressGeoJsonFeature = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>> & { id?: string };

const WKT_POINT_PATTERNS = [
  /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
  /POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  /SRID=\d+;POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
];
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const PMTILES_ADDRESS_TILE_LIMIT = Math.max(
  64,
  Number.isFinite(Number(process.env.PMTILES_ADDRESS_TILE_LIMIT))
    ? Number(process.env.PMTILES_ADDRESS_TILE_LIMIT)
    : 2048
);

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function objectMetric(metrics: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = metrics?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pointFromGeometryObject(value: unknown): PointGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const geom = value as { type?: unknown; coordinates?: unknown; geometry?: { coordinates?: unknown } };
  if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    return { type: 'Point', coordinates: [Number(geom.coordinates[0]), Number(geom.coordinates[1])] };
  }
  if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    return { type: 'Point', coordinates: [Number(geom.coordinates[0]), Number(geom.coordinates[1])] };
  }
  const nestedCoordinates = geom.geometry?.coordinates;
  if (Array.isArray(nestedCoordinates) && nestedCoordinates.length >= 2) {
    return { type: 'Point', coordinates: [Number(nestedCoordinates[0]), Number(nestedCoordinates[1])] };
  }
  return null;
}

function parseBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  return bbox as [number, number, number, number];
}

function normalizePolygon(value: unknown): GeoJSON.Polygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizePolygon(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Polygon' &&
    Array.isArray((value as { coordinates?: unknown }).coordinates)
  ) {
    return value as GeoJSON.Polygon;
  }
  return null;
}

function bboxFromPolygon(polygon: GeoJSON.Polygon | null): [number, number, number, number] | null {
  if (!polygon) return null;
  const positions = polygon.coordinates.flat().filter(
    (position): position is [number, number] =>
      Array.isArray(position) &&
      position.length >= 2 &&
      Number.isFinite(Number(position[0])) &&
      Number.isFinite(Number(position[1]))
  );
  if (positions.length === 0) return null;
  return [
    Math.min(...positions.map((position) => Number(position[0]))),
    Math.min(...positions.map((position) => Number(position[1]))),
    Math.max(...positions.map((position) => Number(position[0]))),
    Math.max(...positions.map((position) => Number(position[1]))),
  ];
}

function flattenPositions(geometry: GeoJSON.Geometry | null | undefined): Array<[number, number]> {
  if (!geometry) return [];
  if (geometry.type === 'Point') return [geometry.coordinates as [number, number]];
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
    return geometry.coordinates as Array<[number, number]>;
  }
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    return geometry.coordinates.flat() as Array<[number, number]>;
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat(2) as Array<[number, number]>;
  }
  return [];
}

function geometryCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const positions = flattenPositions(geometry).filter(
    (position) => Number.isFinite(position[0]) && Number.isFinite(position[1])
  );
  if (positions.length === 0) return null;
  return [
    (Math.min(...positions.map((position) => position[0])) + Math.max(...positions.map((position) => position[0]))) / 2,
    (Math.min(...positions.map((position) => position[1])) + Math.max(...positions.map((position) => position[1]))) / 2,
  ];
}

function geometryIntersectsBbox(
  geometry: GeoJSON.Geometry | null | undefined,
  bbox: [number, number, number, number]
) {
  return flattenPositions(geometry).some(([lon, lat]) =>
    lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
  );
}

function uniqueSourceLayers(...values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const clampedLat = Math.max(Math.min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function tileRangeForBbox(bbox: [number, number, number, number], maxZoom: number) {
  for (let z = Math.min(maxZoom, 16); z >= 10; z -= 1) {
    const nw = lonLatToTile(bbox[0], bbox[3], z);
    const se = lonLatToTile(bbox[2], bbox[1], z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= PMTILES_ADDRESS_TILE_LIMIT || z === 10) {
      return { z, minX, maxX, minY, maxY };
    }
  }
  return null;
}

async function fetchPmtilesAddressFeatures(campaignId: string) {
  const supabase = createAdminClient();
  const [{ data: campaign }, { data: snapshot }] = await Promise.all([
    supabase
      .from('campaigns')
      .select('bbox, territory_boundary')
      .eq('id', campaignId)
      .maybeSingle(),
    supabase
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, addresses_key, buildings_url, addresses_url, metadata_key, buildings_count, created_at, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle(),
  ]);
  const snapshotRow = snapshot as CampaignSnapshotRow | null;
  const pmtilesKey =
    stringMetric(snapshotRow?.tile_metrics, 'addresses_pmtiles_key') ??
    (snapshotRow?.addresses_key?.endsWith('.pmtiles') ? snapshotRow.addresses_key : null);
  if (!snapshotRow || !pmtilesKey) return [];

  const boundary = normalizePolygon((campaign as { territory_boundary?: unknown } | null)?.territory_boundary);
  const bbox = bboxFromPolygon(boundary) ?? parseBbox((campaign as { bbox?: unknown } | null)?.bbox);
  if (!bbox) return [];

  const sourceLayers = objectMetric(snapshotRow.tile_metrics, 'source_layers');
  const sourceLayerNames = uniqueSourceLayers(
    stringMetric(sourceLayers, 'addresses'),
    stringMetric(sourceLayers, 'address_circles'),
    'addresses',
    'address_circles',
    'campaign_addresses'
  );
  const archive = getCachedPmtilesArchive(await resolveArtifactUrl(snapshotRow, pmtilesKey));
  const header = await archive.getHeader();
  const range = tileRangeForBbox(bbox, header.maxZoom);
  if (!range) return [];

  const byId = new Map<string, AddressGeoJsonFeature>();
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const tile = await archive.getZxy(range.z, x, y);
      if (!tile) continue;
      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layers = sourceLayerNames
        .map((sourceLayerName) => vectorTile.layers[sourceLayerName])
        .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
      if (layers.length === 0) continue;

      for (const layer of layers) {
        for (let index = 0; index < layer.length; index += 1) {
          const feature = layer.feature(index).toGeoJSON(x, y, range.z) as GeoJSON.Feature;
          const center = feature.geometry?.type === 'Point'
            ? feature.geometry.coordinates as [number, number]
            : geometryCenter(feature.geometry);
          if (!center) continue;
          const [lon, lat] = center;
          if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
          if (!geometryIntersectsBbox(feature.geometry, bbox)) continue;
          if (boundary && !turf.booleanPointInPolygon(turf.point([lon, lat]), boundary)) continue;
          const props = feature.properties ?? {};
          const id = String(props.address_id ?? props.address_detail_pid ?? props.id ?? feature.id ?? `${lon},${lat}`);
          byId.set(id, {
            type: 'Feature',
            id,
            geometry: {
              type: 'Point',
              coordinates: [lon, lat],
            },
            properties: {
              id,
              address_id: id,
              address_detail_pid: props.address_detail_pid ?? null,
              gers_id: props.gers_id ?? props.source_id ?? null,
              building_gers_id: props.building_gers_id ?? props.building_id ?? null,
              building_id: props.building_id ?? props.building_gers_id ?? null,
              house_number: props.house_number ?? props.number ?? props.street_number ?? null,
              street_name: props.street_name ?? props.street ?? null,
              postal_code: props.postal_code ?? props.postcode ?? null,
              locality: props.locality ?? props.city ?? null,
              region: props.region ?? props.state ?? null,
              formatted: props.formatted ?? props.full_address ?? props.address ?? '',
              source: props.source ?? 'pmtiles',
            },
          });
        }
      }
    }
  }

  return Array.from(byId.values());
}

function parsePointGeometry(address: Record<string, unknown>): PointGeometry | null {
  // NEW: Check for 'geom_json' field first (from Supabase view with ST_AsGeoJSON conversion)
  if (address.geom_json) {
    const geomJson = address.geom_json;
    if (typeof geomJson === 'object' && geomJson !== null) {
      return pointFromGeometryObject(geomJson);
    } else if (typeof geomJson === 'string') {
      try {
        const parsed = JSON.parse(geomJson);
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
      } catch {
        // Ignore parsing errors
      }
    }
  }
  
  // Check for 'geometry' field (from updated Supabase view)
  if (address.geometry) {
    if (typeof address.geometry === 'string') {
      try {
        const parsed = JSON.parse(address.geometry);
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates)) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (Array.isArray(parsed?.coordinates) && parsed.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (parsed?.geometry?.coordinates && parsed.geometry.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.geometry.coordinates[0], parsed.geometry.coordinates[1]] };
        }
      } catch {
        // Try WKT parsing if JSON parse fails
        for (const pattern of WKT_POINT_PATTERNS) {
          const match = address.geometry.match(pattern);
          if (match) {
            const lon = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            if (!isNaN(lon) && !isNaN(lat)) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        }
      }
    } else if (typeof address.geometry === 'object') {
      return pointFromGeometryObject(address.geometry);
    }
  }

  // LEGACY: Check for 'geom' field (backward compatibility)
  if (address.geom) {
    if (typeof address.geom === 'string') {
      // Check if it's WKB hex format (PostGIS binary)
      const isWKBHex = /^[0-9A-Fa-f]{16,}$/.test(address.geom) && (address.geom.startsWith('01') || address.geom.startsWith('00'));
      
      if (isWKBHex && address.geom.length >= 50) {
        try {
          // Parse WKB hex Point format (EWKB with SRID)
          // Format: [endian][type][SRID flag][SRID][lon][lat]
          // Header: 1 + 4 + 1 + 4 = 10 bytes = 20 hex chars
          const headerLength = 20;
          if (address.geom.length >= headerLength + 32) {
            const lonHex = address.geom.substring(headerLength, headerLength + 16);
            const latHex = address.geom.substring(headerLength + 16, headerLength + 32);
            
            // Convert hex to Buffer and parse as little-endian double
            const lonBuffer = Buffer.from(lonHex, 'hex');
            const latBuffer = Buffer.from(latHex, 'hex');
            
            const lon = lonBuffer.readDoubleLE(0);
            const lat = latBuffer.readDoubleLE(0);
            
            if (!isNaN(lon) && !isNaN(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        } catch {
          // WKB parsing failed, continue to other formats
        }
      }
      
      try {
        const parsed = JSON.parse(address.geom);
        if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates)) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (Array.isArray(parsed?.coordinates) && parsed.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.coordinates[0], parsed.coordinates[1]] };
        }
        if (parsed?.geometry?.coordinates && parsed.geometry.coordinates.length >= 2) {
          return { type: 'Point', coordinates: [parsed.geometry.coordinates[0], parsed.geometry.coordinates[1]] };
        }
      } catch {
        for (const pattern of WKT_POINT_PATTERNS) {
          const match = address.geom.match(pattern);
          if (match) {
            const lon = parseFloat(match[1]);
            const lat = parseFloat(match[2]);
            if (!isNaN(lon) && !isNaN(lat)) {
              return { type: 'Point', coordinates: [lon, lat] };
            }
          }
        }
      }
    } else if (typeof address.geom === 'object') {
      return pointFromGeometryObject(address.geom);
    }
  }

  // FALLBACK: Check for coordinate object
  if (address.coordinate && typeof address.coordinate === 'object') {
    const coordinate = address.coordinate as { lon?: unknown; lat?: unknown };
    const lon = Number(coordinate.lon);
    const lat = Number(coordinate.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return {
      type: 'Point',
      coordinates: [lon, lat],
    };
  }

  return null;
}

export const runtime = 'nodejs';

/**
 * GET endpoint for fetching campaign addresses as GeoJSON
 * Returns addresses with Point geometry for the specified campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;

    // DEBUG: Log campaign ID
    console.log(`[API] Received request for campaign: ${campaignId}`);

    if (!campaignId) {
      console.error('[API] Missing campaignId parameter');
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    // Fetch addresses from the service
    const addresses = await CampaignsService.fetchAddresses(campaignId);

    // DEBUG: Log count and first row structure
    console.log(`[API] Fetched ${addresses.length} addresses from Supabase for campaign ${campaignId}`);
    if (addresses.length > 0) {
      console.log('[API] First address row structure:', {
        keys: Object.keys(addresses[0]),
        hasGeometry: 'geometry' in addresses[0],
        hasGeom: 'geom' in addresses[0],
        geometryType: typeof (addresses[0] as { geometry?: unknown }).geometry,
        geomType: typeof addresses[0].geom,
        geometrySample: (addresses[0] as { geometry?: unknown }).geometry ? JSON.stringify((addresses[0] as { geometry?: unknown }).geometry).substring(0, 200) : 'N/A',
        geomSample: addresses[0].geom ? JSON.stringify(addresses[0].geom).substring(0, 200) : 'N/A',
      });
    }

    if (addresses.length === 0) {
      const pmtilesFeatures = await fetchPmtilesAddressFeatures(campaignId);
      if (pmtilesFeatures.length > 0) {
        console.log(`[API] Returning ${pmtilesFeatures.length} address GeoJSON features extracted from PMTiles`);
        return NextResponse.json(pmtilesFeatures);
      }
    }

    // Transform to GeoJSON features with Point geometry
    // Handles GeoJSON objects, GeoJSON strings, and WKT POINT strings
    const features = addresses
      .map((address) => {
        const geometry = parsePointGeometry(address as unknown as Record<string, unknown>);
        if (!geometry) {
          return null;
        }

        return {
          type: 'Feature',
          geometry,
          properties: {
            id: address.id,
            formatted: address.formatted || address.address || '',
            visited: address.visited || false,
            house_bearing: address.house_bearing || 0,
            road_bearing: address.road_bearing || 0,
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    // DEBUG: Log how many features were successfully parsed
    console.log(`[API] Successfully parsed ${features.length} features from ${addresses.length} addresses`);
    if (features.length === 0 && addresses.length > 0) {
      console.warn('[API] WARNING: All addresses failed geometry parsing. Sample address:', addresses[0]);
    }

    return NextResponse.json(features);
  } catch (error) {
    console.error('Error fetching campaign addresses:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch address data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
