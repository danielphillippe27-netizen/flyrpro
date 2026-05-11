import { NextRequest, NextResponse } from 'next/server';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ensureCachedCampaignAccess,
  getCachedCampaignSnapshot,
  getCachedPmtilesArchive,
  resolveCachedTileUser,
} from '@/app/api/campaigns/_utils/tile-cache';
import {
  type CampaignSnapshotRow,
  type ParcelPmtilesResolution,
  resolveArtifactUrl,
  resolvePmtilesKey,
} from '@/lib/diamond/geometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARCEL_SEAM_SAFE_MAX_ZOOM = 13;
const PARCEL_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const parcelFailureCache = new Map<string, number>();
const NON_RESIDENTIAL_PARCEL_TERMS = [
  'road',
  'street',
  'motorway',
  'highway',
  'rail',
  'railway',
  'sidewalk',
  'footpath',
  'walkway',
  'accessway',
  'right of way',
  'right-of-way',
  'drain',
  'drainage',
  'stormwater',
  'wastewater',
  'watercourse',
  'river',
  'stream',
  'creek',
  'esplanade',
  'reserve',
  'recreation',
  'park',
  'domain',
  'local purpose',
  'utility',
  'substation',
  'school',
];

type CampaignParcelResponse = {
  id: string;
  campaign_id: string;
  external_id: string;
  geom: string;
  properties: Record<string, unknown>;
  created_at: string;
};

type CampaignScopeRow = {
  bbox: unknown;
  territory_boundary: GeoJSON.Polygon | string | null;
};

function getParcelFailureCacheKey(campaignId: string, pmtilesKey: string) {
  return `${campaignId}:${pmtilesKey}`;
}

function hasCachedParcelFailure(cacheKey: string) {
  const expiresAt = parcelFailureCache.get(cacheKey);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    parcelFailureCache.delete(cacheKey);
    return false;
  }
  return true;
}

function cacheParcelFailure(cacheKey: string) {
  parcelFailureCache.set(cacheKey, Date.now() + PARCEL_FAILURE_CACHE_TTL_MS);
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parcelTilesFromSnapshot(snapshot: CampaignSnapshotRow | null): ParcelPmtilesResolution | null {
  const pmtilesKey = stringMetric(snapshot?.tile_metrics, 'parcels_pmtiles_key');
  if (!snapshot) return null;

  if (!pmtilesKey) {
    const buildingPmtilesKey = resolvePmtilesKey(snapshot);
    const isBedrockNzSnapshot =
      snapshot.tile_metrics?.bedrock_mode === true &&
      stringMetric(snapshot.tile_metrics, 'bedrock_country_code') === 'NZ' &&
      buildingPmtilesKey?.endsWith('/buildings/buildings.pmtiles');

    if (!isBedrockNzSnapshot || !buildingPmtilesKey) return null;

    const derivedPmtilesKey = buildingPmtilesKey.replace(/\/buildings\/buildings\.pmtiles$/i, '/parcels/parcels.pmtiles');
    return {
      bucket: snapshot.bucket,
      pmtilesKey: derivedPmtilesKey,
      tilejsonKey: derivedPmtilesKey.replace(/\.pmtiles$/i, '.json'),
      datePart: 'snapshot',
      sourceLayer: 'parcels',
      promoteId: 'parcel_id',
      minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
      maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
    };
  }

  return {
    bucket: snapshot.bucket,
    pmtilesKey,
    tilejsonKey:
      stringMetric(snapshot.tile_metrics, 'parcels_tilejson_key') ??
      pmtilesKey.replace(/\.pmtiles$/i, '.json'),
    datePart: 'snapshot',
    sourceLayer: 'parcels',
    promoteId: 'parcel_id',
    minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
    maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
  };
}

function parseBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every((entry) => Number.isFinite(entry))) return null;
  return bbox as [number, number, number, number];
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

function bboxFromPositions(positions: Array<[number, number]>): [number, number, number, number] | null {
  const validPositions = positions.filter(
    (position) => Number.isFinite(position[0]) && Number.isFinite(position[1])
  );
  if (validPositions.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of validPositions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}

function geometryCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const bbox = bboxFromPositions(flattenPositions(geometry));
  if (!bbox) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function normalizeGeoJsonPolygon(value: GeoJSON.Polygon | string | null | undefined): GeoJSON.Polygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizeGeoJsonPolygon(JSON.parse(value) as GeoJSON.Polygon);
    } catch {
      return null;
    }
  }
  return value.type === 'Polygon' && Array.isArray(value.coordinates) ? value : null;
}

function pointInBbox(point: [number, number], bbox: [number, number, number, number]) {
  const [lon, lat] = point;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function geometryIntersectsBbox(
  geometry: GeoJSON.Geometry | null | undefined,
  bbox: [number, number, number, number]
): boolean {
  return flattenPositions(geometry).some((position) => pointInBbox(position, bbox));
}

function pointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): boolean {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-12) return false;

  return (
    px >= Math.min(x1, x2) - 1e-12 &&
    px <= Math.max(x1, x2) + 1e-12 &&
    py >= Math.min(y1, y2) - 1e-12 &&
    py <= Math.max(y1, y2) + 1e-12
  );
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i];
    const previous = ring[j];
    if (!Array.isArray(current) || !Array.isArray(previous)) continue;

    const xi = Number(current[0]);
    const yi = Number(current[1]);
    const xj = Number(previous[0]);
    const yj = Number(previous[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

    if (pointOnSegment(point, [xi, yi], [xj, yj])) return true;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point: [number, number], polygon: GeoJSON.Polygon): boolean {
  const [outerRing, ...holes] = polygon.coordinates;
  if (!pointInRing(point, outerRing)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

function tileRangesForBbox(bbox: [number, number, number, number], maxZoom: number) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (let z = Math.min(maxZoom, PARCEL_SEAM_SAFE_MAX_ZOOM); z >= 10; z -= 1) {
    const nw = lonLatToTile(minLon, maxLat, z);
    const se = lonLatToTile(maxLon, minLat, z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= 64 || z === 10) {
      return { z, minX, maxX, minY, maxY };
    }
  }
  return null;
}

function getFeatureExternalId(feature: GeoJSON.Feature): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidates = [
    properties.parcel_id,
    properties.external_id,
    properties.PARCELID,
    properties.gisid,
    properties.roll_number,
    properties.id,
    feature.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).trim();
      if (normalized) return normalized;
    }
  }

  return null;
}

function normalizedParcelText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasNonResidentialParcelTerm(value: unknown): boolean {
  const text = normalizedParcelText(value);
  if (!text) return false;
  return NON_RESIDENTIAL_PARCEL_TERMS.some((term) => text.includes(term));
}

function isResidentialParcelFeature(feature: GeoJSON.Feature): boolean {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const topologyType = normalizedParcelText(properties.topology_type);
  if (topologyType && topologyType !== 'primary') return false;

  if (
    hasNonResidentialParcelTerm(properties.parcel_intent) ||
    hasNonResidentialParcelTerm(properties.appellation) ||
    hasNonResidentialParcelTerm(properties.statutory_actions) ||
    hasNonResidentialParcelTerm(properties.zoning) ||
    hasNonResidentialParcelTerm(properties.land_use) ||
    hasNonResidentialParcelTerm(properties.use)
  ) {
    return false;
  }

  const intent = normalizedParcelText(properties.parcel_intent);
  if (!intent) return true;
  return intent === 'fee simple title' || intent === 'dcdb' || intent.includes('residential');
}

function featureWithinCampaignScope(
  feature: GeoJSON.Feature,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null
): boolean {
  const center = geometryCenter(feature.geometry);
  const inBbox = (center && pointInBbox(center, bbox)) || geometryIntersectsBbox(feature.geometry, bbox);
  if (!inBbox) return false;
  if (!boundary) return true;
  if (center && pointInPolygon(center, boundary)) return true;

  return flattenPositions(feature.geometry).some((position) => pointInPolygon(position, boundary));
}

async function fetchScopedPmtilesParcels(
  campaignId: string,
  snapshot: CampaignSnapshotRow,
  parcelTiles: ParcelPmtilesResolution,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null
): Promise<CampaignParcelResponse[]> {
  const pmtilesUrl = await resolveArtifactUrl(snapshot, parcelTiles.pmtilesKey);
  const archive = getCachedPmtilesArchive(pmtilesUrl);
  const header = await archive.getHeader();
  const range = tileRangesForBbox(bbox, Math.min(header.maxZoom, parcelTiles.maxzoom));
  if (!range) return [];

  const now = new Date().toISOString();
  const byParcelId = new Map<string, CampaignParcelResponse>();
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const tile = await archive.getZxy(range.z, x, y);
      if (!tile) continue;

      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layer = vectorTile.layers[parcelTiles.sourceLayer];
      if (!layer) continue;

      for (let index = 0; index < layer.length; index += 1) {
        const vectorFeature = layer.feature(index);
        const feature = vectorFeature.toGeoJSON(x, y, range.z) as GeoJSON.Feature;
        if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
        if (!featureWithinCampaignScope(feature, bbox, boundary)) continue;
        if (!isResidentialParcelFeature(feature)) continue;

        const externalId = getFeatureExternalId(feature);
        if (!externalId || byParcelId.has(externalId)) continue;

        byParcelId.set(externalId, {
          id: externalId,
          campaign_id: campaignId,
          external_id: externalId,
          geom: JSON.stringify(feature.geometry),
          properties: {
            ...((feature.properties ?? {}) as Record<string, unknown>),
            parcel_id: externalId,
            source: 'bedrock_pmtiles',
          },
          created_at: now,
        });
      }
    }
  }

  return Array.from(byParcelId.values());
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const requestUser = await resolveCachedTileUser(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCachedCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const [{ data: campaign, error: campaignError }, snapshot] = await Promise.all([
    supabase
      .from('campaigns')
      .select('bbox, territory_boundary')
      .eq('id', campaignId)
      .maybeSingle(),
    getCachedCampaignSnapshot(supabase, campaignId),
  ]);

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (!snapshot) {
    return NextResponse.json([]);
  }

  const campaignScope = campaign as CampaignScopeRow;
  const boundary = normalizeGeoJsonPolygon(campaignScope.territory_boundary);
  const bbox = parseBbox(campaignScope.bbox) ?? (boundary ? bboxFromPositions(flattenPositions(boundary)) : null);
  if (!bbox) {
    return NextResponse.json([]);
  }

  const parcelTiles = parcelTilesFromSnapshot(snapshot);
  if (!parcelTiles) {
    return NextResponse.json([]);
  }

  const failureCacheKey = getParcelFailureCacheKey(campaignId, parcelTiles.pmtilesKey);
  if (hasCachedParcelFailure(failureCacheKey)) {
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'X-FLYR-Parcels-Suppressed': 'cached-failure',
      },
    });
  }

  try {
    const parcels = await fetchScopedPmtilesParcels(campaignId, snapshot, parcelTiles, bbox, boundary);
    return NextResponse.json(parcels, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('403')) {
      cacheParcelFailure(failureCacheKey);
      console.warn('[CampaignParcels] Parcel PMTiles access denied; suppressing retries temporarily:', {
        campaignId,
        error: errorMessage,
      });
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'private, max-age=60',
          'X-FLYR-Parcels-Suppressed': 'access-denied',
        },
      });
    }

    console.error('[CampaignParcels] Failed to extract scoped parcels:', {
      campaignId,
      error: errorMessage,
    });
    return NextResponse.json({ error: 'Failed to extract campaign parcels' }, { status: 500 });
  }
}
