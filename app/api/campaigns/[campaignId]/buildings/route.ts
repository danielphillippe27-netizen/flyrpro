import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { getCampaignBuildingStatus } from '@/lib/campaignStats';
import { displayAddressText, resolveHouseNumberLabel } from '@/lib/map/addressPresentation';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import * as turf from '@turf/turf';
import {
  type CampaignSnapshotRow,
  resolveFallbackGeoJSONKey,
  resolveArtifactUrl,
  resolvePmtilesKey,
} from '@/lib/diamond/geometry';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { gunzipSync } from 'zlib';
import type { PostgrestError } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FeatureCollectionLike = {
  type?: unknown;
  features?: Array<{
    id?: unknown;
    geometry?: GeoJSON.Geometry | null;
    properties?: Record<string, unknown>;
  }>;
};
type FeatureLike = NonNullable<FeatureCollectionLike['features']>[number];

type PolygonalBuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
>;

type CampaignBuildingStatus = ReturnType<typeof getCampaignBuildingStatus>;
const PMTILES_TILE_RANGE_PADDING = 1;
const PMTILES_TILE_FETCH_CONCURRENCY = 12;
const PMTILES_SCOPED_TILE_LIMIT = Math.max(
  64,
  Number.isFinite(Number(process.env.PMTILES_SCOPED_TILE_LIMIT))
    ? Number(process.env.PMTILES_SCOPED_TILE_LIMIT)
    : 2048
);
const PMTILES_EXPANDED_BBOX_RETRY_METERS = Math.max(
  0,
  Number.isFinite(Number(process.env.PMTILES_EXPANDED_BBOX_RETRY_METERS))
    ? Number(process.env.PMTILES_EXPANDED_BBOX_RETRY_METERS)
    : 75
);
const PMTILES_BUILDING_DISPLAY_BUFFER_METERS = Math.max(
  0,
  Number.isFinite(Number(process.env.PMTILES_BUILDING_DISPLAY_BUFFER_METERS))
    ? Number(process.env.PMTILES_BUILDING_DISPLAY_BUFFER_METERS)
    : 0
);
const PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS = Math.max(
  0,
  Number.isFinite(Number(process.env.PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS))
    ? Number(process.env.PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS)
    : 0
);
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const BUILDINGS_RESPONSE_CACHE_TTL_MS = 30_000;
const BUILDINGS_RESPONSE_CACHE_MAX_ENTRIES = 64;
const CAMPAIGN_BUILDING_STATUS_RANK: Record<CampaignBuildingStatus, number> = {
  not_visited: 0,
  visited: 1,
  no_answer: 2,
  do_not_knock: 3,
  hot: 4,
  lead: 5,
  hot_lead: 6,
};

const buildingsResponseCache = new Map<string, { expiresAt: number; value: FeatureCollectionLike }>();
const buildingsResponseInflight = new Map<string, Promise<FeatureCollectionLike | null>>();

function getFeatureCount(featureCollection: FeatureCollectionLike | null | undefined): number {
  return Array.isArray(featureCollection?.features) ? featureCollection.features.length : 0;
}

function snapshotStringMetric(snapshot: CampaignSnapshotRow, key: string): string | null {
  const value = snapshot.tile_metrics?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isBedrockUsSnapshot(snapshot: CampaignSnapshotRow): boolean {
  const countryCode = snapshotStringMetric(snapshot, 'bedrock_country_code')?.toUpperCase();
  const prefix = String(snapshot.prefix ?? '').toLowerCase();
  const buildingsKey = String(snapshot.buildings_key ?? '').toLowerCase();

  return (
    snapshot.tile_metrics?.bedrock_mode === true &&
    countryCode === 'US' &&
    (prefix.startsWith('bedrock/usa/') || buildingsKey.startsWith('bedrock/usa/'))
  );
}

function getCachedBuildingsResponse(cacheKey: string): FeatureCollectionLike | null {
  const cached = buildingsResponseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    buildingsResponseCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedBuildingsResponse(cacheKey: string, value: FeatureCollectionLike) {
  buildingsResponseCache.set(cacheKey, {
    expiresAt: Date.now() + BUILDINGS_RESPONSE_CACHE_TTL_MS,
    value,
  });

  if (buildingsResponseCache.size > BUILDINGS_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = buildingsResponseCache.keys().next().value as string | undefined;
    if (oldestKey) buildingsResponseCache.delete(oldestKey);
  }
}

async function loadCachedBuildingsResponse(
  cacheKey: string,
  loader: () => Promise<FeatureCollectionLike | null>
): Promise<FeatureCollectionLike | null> {
  const cached = getCachedBuildingsResponse(cacheKey);
  if (cached) return cached;

  const existing = buildingsResponseInflight.get(cacheKey);
  if (existing) return existing;

  const promise = loader()
    .then((value) => {
      if (getFeatureCount(value) > 0) {
        setCachedBuildingsResponse(cacheKey, value as FeatureCollectionLike);
      }
      return value;
    })
    .finally(() => {
      buildingsResponseInflight.delete(cacheKey);
    });

  buildingsResponseInflight.set(cacheKey, promise);
  return promise;
}

function stableCachePart(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function snapshotBuildingsCacheKey(params: {
  campaignId: string;
  snapshot: CampaignSnapshotRow;
  bbox: [number, number, number, number] | null;
  hiddenBuildingIds: Set<string>;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}) {
  const hiddenIds = Array.from(params.hiddenBuildingIds).sort().join(',');
  return [
    'buildings',
    params.campaignId,
    params.snapshot.bucket,
    params.snapshot.buildings_key ?? '',
    params.snapshot.buildings_url ?? '',
    params.snapshot.metadata_key ?? '',
    params.snapshot.created_at ?? '',
    stableCachePart(params.snapshot.tile_metrics),
    stableCachePart(params.bbox),
    stableCachePart(params.boundary),
    hiddenIds,
  ].join('|');
}

function buildingTimingHeaders(startedAt: number, source: string) {
  const total = Date.now() - startedAt;
  return {
    'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
    'Server-Timing': `source;desc="${source}", total;dur=${total}`,
    'X-FLYR-Server-Timing': `source;desc="${source}", total;dur=${total}`,
  };
}

function buildingsJsonResponse(value: FeatureCollectionLike, startedAt: number, source: string) {
  return NextResponse.json(value, {
    headers: buildingTimingHeaders(startedAt, source),
  });
}

function asPagePromise<T>(
  query: unknown
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  return query as Promise<{ data: T[] | null; error: PostgrestError | null }>;
}

function getBuildingStatusForCampaignAddress(address: CampaignAddressRow): CampaignBuildingStatus {
  return getCampaignBuildingStatus({
    address_status: address.address_status ?? undefined,
    visited: Boolean(address.visited),
  });
}

function hasPolygonFeatures(featureCollection: unknown): boolean {
  if (!featureCollection || typeof featureCollection !== 'object') return false;
  const features = (featureCollection as { features?: unknown }).features;
  if (!Array.isArray(features)) return false;

  return features.some((feature) => {
    if (!feature || typeof feature !== 'object') return false;
    const geometry = (feature as { geometry?: { type?: unknown } }).geometry;
    const type = geometry?.type;
    return type === 'Polygon' || type === 'MultiPolygon';
  });
}

function isAddressPointFallbackFeature(feature: unknown): boolean {
  if (!feature || typeof feature !== 'object') return false;
  const properties = (feature as {
    properties?: { source?: unknown; feature_type?: unknown; feature_status?: unknown };
  }).properties;

  return (
    properties?.source === 'address_point' ||
    properties?.feature_type === 'address_point' ||
    properties?.feature_status === 'address_point'
  );
}

function hasAddressPointFallbackFeatures(featureCollection: unknown): boolean {
  if (!featureCollection || typeof featureCollection !== 'object') return false;
  const features = (featureCollection as { features?: unknown }).features;
  if (!Array.isArray(features)) return false;

  return features.some(isAddressPointFallbackFeature);
}

function filterAddressPointFallbackFeatures(
  featureCollection: FeatureCollectionLike | null | undefined
): FeatureCollectionLike | null {
  if (!featureCollection || !Array.isArray(featureCollection.features)) {
    return null;
  }

  return {
    ...featureCollection,
    features: featureCollection.features.filter(isAddressPointFallbackFeature),
  };
}

function normalizeGeoJSONArtifact(value: unknown, key: string): FeatureCollectionLike {
  if (value && typeof value === 'object') {
    const candidate = value as { type?: unknown; features?: unknown };
    if (candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
      return candidate as FeatureCollectionLike;
    }
    if (candidate.type === 'Feature') {
      return { type: 'FeatureCollection', features: [candidate as NonNullable<FeatureCollectionLike['features']>[number]] };
    }
  }

  if (Array.isArray(value)) {
    const features = value.filter(
      (entry): entry is NonNullable<FeatureCollectionLike['features']>[number] =>
        Boolean(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'Feature')
    );
    return { type: 'FeatureCollection', features };
  }

  throw new Error(`Unsupported GeoJSON artifact shape for ${key}`);
}

function parseGeoJSONArtifactText(text: string, key: string): FeatureCollectionLike {
  const trimmed = text.trim();
  if (!trimmed) return { type: 'FeatureCollection', features: [] };

  try {
    return normalizeGeoJSONArtifact(JSON.parse(trimmed), key);
  } catch (jsonError) {
    const features = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(
        (entry): entry is NonNullable<FeatureCollectionLike['features']>[number] =>
          Boolean(entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'Feature')
      );

    if (features.length > 0) {
      return { type: 'FeatureCollection', features };
    }

    throw jsonError;
  }
}

async function fetchSnapshotGeoJSONArtifact(snapshot: CampaignSnapshotRow, key: string): Promise<FeatureCollectionLike> {
  const artifactUrl = await resolveArtifactUrl(snapshot, key);
  const response = await fetch(artifactUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot GeoJSON artifact: ${response.status}`);
  }

  const bodyBuffer = Buffer.from(await response.arrayBuffer());
  const isGzip = bodyBuffer[0] === 0x1f && bodyBuffer[1] === 0x8b;
  const geojsonBuffer = isGzip ? gunzipSync(bodyBuffer) : bodyBuffer;
  return parseGeoJSONArtifactText(geojsonBuffer.toString('utf-8'), key);
}

function allowDirectDbPolygonFallback(): boolean {
  return false;
}

function parseBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every((entry) => Number.isFinite(entry))) return null;
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function expandBboxMeters(
  bbox: [number, number, number, number],
  meters: number
): [number, number, number, number] {
  if (meters <= 0) return bbox;

  const midLat = (bbox[1] + bbox[3]) / 2;
  const latDelta = meters / METERS_PER_DEGREE_LATITUDE;
  const lonScale = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);
  const lonDelta = meters / (METERS_PER_DEGREE_LATITUDE * lonScale);

  return [
    Math.max(-180, bbox[0] - lonDelta),
    Math.max(-WEB_MERCATOR_MAX_LAT, bbox[1] - latDelta),
    Math.min(180, bbox[2] + lonDelta),
    Math.min(WEB_MERCATOR_MAX_LAT, bbox[3] + latDelta),
  ];
}

function bboxFromPolygon(polygon: GeoJSON.Polygon | null): [number, number, number, number] | null {
  if (!polygon?.coordinates?.length) return null;
  const points = polygon.coordinates.flatMap((ring) => ring);
  const lons = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const lats = points.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (lons.length === 0 || lats.length === 0) return null;
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const clampedLat = Math.max(Math.min(lat, WEB_MERCATOR_MAX_LAT), -WEB_MERCATOR_MAX_LAT);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

type TileRange = {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function tileRangeCandidatesForBbox(
  bbox: [number, number, number, number],
  maxZoom: number,
  minZoom: number
): TileRange[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const highestZoom = Math.min(maxZoom, 18);
  const lowestZoom = Math.min(highestZoom, Math.max(12, minZoom));
  const candidates: TileRange[] = [];

  for (let z = highestZoom; z >= lowestZoom; z -= 1) {
    const nw = lonLatToTile(minLon, maxLat, z);
    const se = lonLatToTile(maxLon, minLat, z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= PMTILES_SCOPED_TILE_LIMIT || z === lowestZoom) {
      const maxTile = 2 ** z - 1;
      candidates.push({
        z,
        minX: Math.max(0, minX - PMTILES_TILE_RANGE_PADDING),
        maxX: Math.min(maxTile, maxX + PMTILES_TILE_RANGE_PADDING),
        minY: Math.max(0, minY - PMTILES_TILE_RANGE_PADDING),
        maxY: Math.min(maxTile, maxY + PMTILES_TILE_RANGE_PADDING),
      });
    }
  }

  return candidates;
}

function tileCoordsForRange(range: TileRange): Array<{ x: number; y: number }> {
  const tileCoords: Array<{ x: number; y: number }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tileCoords.push({ x, y });
    }
  }
  return tileCoords;
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
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
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function geometryBounds(geometry: GeoJSON.Geometry | null | undefined): [number, number, number, number] | null {
  const positions = flattenPositions(geometry).filter(
    (position) => Number.isFinite(position[0]) && Number.isFinite(position[1])
  );
  if (positions.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}

function normalizeLongitudeNearBbox(lon: number, bbox: [number, number, number, number]): number {
  if (!Number.isFinite(lon)) return lon;
  const bboxCenter = (bbox[0] + bbox[2]) / 2;
  let normalized = lon;

  while (normalized - bboxCenter > 180) normalized -= 360;
  while (bboxCenter - normalized > 180) normalized += 360;

  return normalized;
}

function normalizeGeometryLongitudes<T extends GeoJSON.Polygon | GeoJSON.MultiPolygon>(
  geometry: T,
  bbox: [number, number, number, number]
): T {
  const normalizePosition = (position: number[]) => [
    normalizeLongitudeNearBbox(Number(position[0]), bbox),
    Number(position[1]),
    ...position.slice(2),
  ];

  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) => ring.map(normalizePosition)),
    } as T;
  }

  return {
    ...geometry,
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(normalizePosition))
    ),
  } as T;
}

function bboxesIntersect(
  a: [number, number, number, number],
  b: [number, number, number, number]
) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function geometryIntersectsBbox(
  geometry: GeoJSON.Geometry | null | undefined,
  bbox: [number, number, number, number]
): boolean {
  const bounds = geometryBounds(geometry);
  return Boolean(bounds && bboxesIntersect(bounds, bbox));
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

function pointInBoundary(point: [number, number], boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  if (boundary.type === 'Polygon') return pointInPolygon(point, boundary);
  return boundary.coordinates.some((coordinates) =>
    pointInPolygon(point, { type: 'Polygon', coordinates })
  );
}

function featureInCampaignBoundary(feature: unknown, boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const geometry = (feature as { geometry?: GeoJSON.Geometry | null } | null)?.geometry;
  try {
    return turf.booleanIntersects(
      feature as GeoJSON.Feature<GeoJSON.Geometry>,
      turf.feature(boundary)
    );
  } catch {
    // Fall back to cheap checks if a malformed municipal feature cannot be
    // evaluated by Turf.
  }

  const center = geometryCenter(geometry);
  if (center && pointInBoundary(center, boundary)) return true;
  return flattenPositions(geometry).some((position) => pointInBoundary(position, boundary));
}

function filterCampaignBoundaryFeatures<T extends FeatureCollectionLike | null | undefined>(
  featureCollection: T,
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): T {
  if (!featureCollection || !boundary || !Array.isArray(featureCollection.features)) {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features: featureCollection.features.filter((feature) =>
      featureInCampaignBoundary(feature, boundary)
    ),
  } as T;
}

function mergeBuildingFragments(buildingId: string, fragments: PolygonalBuildingFeature[]): PolygonalBuildingFeature {
  const [first] = fragments;
  if (!first) throw new Error(`Cannot merge empty building fragment set for ${buildingId}`);
  if (fragments.length === 1) return first;

  try {
    const merged = turf.union(
      turf.featureCollection(fragments.map((fragment) => turf.feature(fragment.geometry)))
    );
    if (merged?.geometry) {
      return {
        ...first,
        id: buildingId,
        geometry: merged.geometry,
        properties: first.properties,
      };
    }
  } catch (error) {
    console.warn('[API] Failed to merge clipped building tile fragments:', {
      buildingId,
      fragments: fragments.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const polygons = fragments.flatMap((fragment) =>
    fragment.geometry.type === 'Polygon'
      ? [fragment.geometry.coordinates]
      : fragment.geometry.coordinates
  );

  return {
    ...first,
    id: buildingId,
    geometry: polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons },
    properties: first.properties,
  };
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

function bufferCampaignBoundaryMeters(
  boundary: GeoJSON.Polygon | null,
  meters: number
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!boundary || meters <= 0) return boundary;

  try {
    const buffered = turf.buffer(turf.feature(boundary), meters, { units: 'meters' });
    const geometry = buffered?.geometry;
    return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon' ? geometry : boundary;
  } catch (error) {
    console.warn('[API] Failed to buffer campaign building display boundary; using strict boundary', {
      meters,
      error: error instanceof Error ? error.message : String(error),
    });
    return boundary;
  }
}

async function fetchScopedPmtilesBuildingFeatures(
  snapshot: CampaignSnapshotRow,
  bbox: [number, number, number, number],
  hiddenBuildingIds: Set<string>,
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): Promise<FeatureCollectionLike | null> {
  const scoped = await extractScopedPmtilesBuildingFeatures(snapshot, bbox, hiddenBuildingIds, boundary);
  if (scoped) return scoped;

  const fallbackSnapshot = bedrockFallbackSnapshotForBuildings(snapshot);
  if (!fallbackSnapshot) return null;

  return extractScopedPmtilesBuildingFeatures(fallbackSnapshot, bbox, hiddenBuildingIds, boundary);
}

function bedrockFallbackSnapshotForBuildings(snapshot: CampaignSnapshotRow): CampaignSnapshotRow | null {
  const pmtilesKey = resolvePmtilesKey(snapshot);
  if (!pmtilesKey || pmtilesKey.startsWith('bedrock/')) return null;

  const usStateMatch = pmtilesKey.match(/^diamond\/buildings\/usa\/([a-z]{2})\//i);
  if (!usStateMatch) return null;

  const state = usStateMatch[1].toUpperCase();
  const prefix = 'bedrock/usa/current';
  const fallbackKey = `${prefix}/buildings/pmtiles_by_state/state=${state}/buildings.pmtiles`;
  const sourceLayers =
    snapshot.tile_metrics?.source_layers &&
    typeof snapshot.tile_metrics.source_layers === 'object'
      ? snapshot.tile_metrics.source_layers as Record<string, unknown>
      : {};

  return {
    ...snapshot,
    prefix,
    buildings_key: fallbackKey,
    buildings_url: null,
    metadata_key: `${prefix}/bedrock-usa.json`,
    tile_metrics: {
      ...(snapshot.tile_metrics ?? {}),
      pmtiles_key: fallbackKey,
      source_layers: {
        ...sourceLayers,
        buildings: 'buildings',
      },
      fallback_from_pmtiles_key: pmtilesKey,
      fallback_reason: 'empty_diamond_building_scope',
    },
  };
}

async function extractScopedPmtilesBuildingFeatures(
  snapshot: CampaignSnapshotRow,
  bbox: [number, number, number, number],
  hiddenBuildingIds: Set<string>,
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): Promise<FeatureCollectionLike | null> {
  const pmtilesKey = resolvePmtilesKey(snapshot);
  if (!pmtilesKey) return null;
  const sourceLayers = snapshot.tile_metrics?.source_layers;
  const sourceLayer =
    sourceLayers && typeof sourceLayers === 'object' && 'buildings' in sourceLayers
      ? String((sourceLayers as Record<string, unknown>).buildings || 'buildings')
      : 'buildings';

  const pmtilesUrl = await resolveArtifactUrl(snapshot, pmtilesKey);
  const archive = getCachedPmtilesArchive(pmtilesUrl);
  const header = await archive.getHeader();
  const ranges = tileRangeCandidatesForBbox(bbox, header.maxZoom, header.minZoom);
  if (ranges.length === 0) return null;

  let bestCollection: FeatureCollectionLike | null = null;
  let bestRange: TileRange | null = null;

  for (const range of ranges) {
    const byBuildingId = new Map<string, PolygonalBuildingFeature[]>();
    const tileCoords = tileCoordsForRange(range);

    await forEachWithConcurrency(tileCoords, PMTILES_TILE_FETCH_CONCURRENCY, async ({ x, y }) => {
      const tile = await archive.getZxy(range.z, x, y);
      if (!tile) return;

      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layer = vectorTile.layers[sourceLayer] ?? vectorTile.layers.buildings;
      if (!layer) return;

      for (let index = 0; index < layer.length; index += 1) {
        const vectorFeature = layer.feature(index);
        const feature = vectorFeature.toGeoJSON(x, y, range.z) as GeoJSON.Feature;
        if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
        const geometry = normalizeGeometryLongitudes(feature.geometry, bbox);
        const boundaryFeature = { ...feature, geometry };
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingId = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
        if (!buildingId || hiddenBuildingIds.has(buildingId)) continue;

        if (!geometryIntersectsBbox(geometry, bbox)) continue;
        if (boundary && !featureInCampaignBoundary(boundaryFeature, boundary)) continue;

        const normalizedFeature: PolygonalBuildingFeature = {
          ...feature,
          id: buildingId,
          geometry,
          properties: {
            ...properties,
            id: buildingId,
            building_id: buildingId,
            gers_id: buildingId,
            height: Math.max(Number(properties.height ?? properties.height_m ?? 10), 10),
            height_m: Math.max(Number(properties.height_m ?? properties.height ?? 10), 10),
            min_height: Number(properties.min_height ?? 0),
            source: properties.source ?? 'bedrock_pmtiles',
            feature_type: 'matched_house',
            feature_status: 'matched',
            status: 'not_visited',
            scans_total: 0,
            qr_scanned: false,
          },
        };
        const fragments = byBuildingId.get(buildingId);
        if (fragments) {
          fragments.push(normalizedFeature);
        } else {
          byBuildingId.set(buildingId, [normalizedFeature]);
        }
      }
    });

    const features = Array.from(byBuildingId.entries()).map(([buildingId, fragments]) =>
      mergeBuildingFragments(buildingId, fragments)
    );
    if (features.length > 0) {
      const collection = {
        type: 'FeatureCollection',
        features,
      } satisfies FeatureCollectionLike;
      if (!bestCollection || features.length > getFeatureCount(bestCollection)) {
        bestCollection = collection;
        bestRange = range;
      }
    }
  }

  if (bestCollection && bestRange) {
    console.log('[API] Selected richest building PMTiles zoom', {
      z: bestRange.z,
      features: getFeatureCount(bestCollection),
      candidates: ranges.length,
    });
  }

  return bestCollection;
}

async function fetchVisibleScopedPmtilesBuildings(params: {
  snapshot: CampaignSnapshotRow;
  bbox: [number, number, number, number];
  hiddenBuildingIds: Set<string>;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  attempt: string;
}): Promise<FeatureCollectionLike | null> {
  const scoped = await fetchScopedPmtilesBuildingFeatures(
    params.snapshot,
    params.bbox,
    params.hiddenBuildingIds,
    params.boundary
  );
  const visibleCount = getFeatureCount(scoped);
  console.log('[API] Scoped PMTiles extraction result', {
    attempt: params.attempt,
    visible: visibleCount,
    raw: visibleCount,
    hasBoundary: Boolean(params.boundary),
    displayBufferMeters: PMTILES_BUILDING_DISPLAY_BUFFER_METERS,
    linkableFilterApplied: false,
  });

  return visibleCount > 0 ? scoped : null;
}

function isPolygonFeature(feature: unknown): boolean {
  if (!feature || typeof feature !== 'object') return false;
  const geometry = (feature as { geometry?: { type?: unknown } }).geometry;
  const type = geometry?.type;
  return type === 'Polygon' || type === 'MultiPolygon';
}

function getFeatureBuildingIdentifiers(feature: unknown): string[] {
  if (!feature || typeof feature !== 'object') return [];
  const properties = (feature as {
    id?: unknown;
    properties?: { id?: unknown; building_id?: unknown; gers_id?: unknown };
  }).properties;
  const identifiers = [
    properties?.building_id,
    properties?.gers_id,
    properties?.id,
    (feature as { id?: unknown }).id,
  ];

  return Array.from(
    new Set(
      identifiers
        .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0)
    )
  );
}

function filterHiddenBuildingFeatures(
  featureCollection: FeatureCollectionLike | null | undefined,
  hiddenBuildingIds: Set<string>
) : FeatureCollectionLike | null | undefined {
  if (!featureCollection) {
    return featureCollection;
  }

  const features = featureCollection.features;
  if (!Array.isArray(features) || hiddenBuildingIds.size === 0) {
    return featureCollection;
  }

  const visibleFeatures = features.filter((feature) => {
    if (!isPolygonFeature(feature)) return true;
    const buildingIdentifiers = getFeatureBuildingIdentifiers(feature);
    return !buildingIdentifiers.some((identifier) => hiddenBuildingIds.has(identifier));
  });

  return {
    ...featureCollection,
    features: visibleFeatures,
  };
}

async function loadVisibleSnapshotGeojsonBuildings(params: {
  snapshot: CampaignSnapshotRow;
  geojsonKey: string | null;
  hiddenBuildingIds: Set<string>;
  campaignBoundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}): Promise<FeatureCollectionLike | null> {
  const { snapshot, geojsonKey, hiddenBuildingIds, campaignBoundary } = params;
  if (!geojsonKey || geojsonKey.endsWith('.pmtiles')) return null;

  console.log(`[API] Fetching snapshot GeoJSON artifact fallback: ${snapshot.bucket}/${geojsonKey}`);

  const geojson = await fetchSnapshotGeoJSONArtifact(snapshot, geojsonKey);
  return filterCampaignBoundaryFeatures(
    filterHiddenBuildingFeatures(geojson, hiddenBuildingIds),
    campaignBoundary
  ) as FeatureCollectionLike;
}

interface CampaignAccessRow {
  owner_id: string;
  workspace_id: string | null;
  bbox?: unknown;
  territory_boundary: GeoJSON.Polygon | string | null;
  provision_source: string | null;
}

interface GoldBuildingRow {
  id: string;
  area_sqm?: number | null;
  building_type?: string | null;
  geom_geojson?: string | null;
  geom?: unknown;
}

interface CampaignAddressRow {
  id: string;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  building_id: string | null;
  building_gers_id?: string | null;
  address_status?: string | null;
  visited: boolean | null;
  scans: number | null;
}

interface CampaignBuildingRow {
  id: string;
  gers_id: string | null;
  source?: string | null;
  geom?: unknown;
  height_m?: number | null;
  height?: number | null;
  latest_status?: string | null;
  house_name?: string | null;
  addr_street?: string | null;
}

interface BuildingAddressLinkRow {
  building_id: string;
  address_id: string;
  match_type: string | null;
  confidence: number | null;
}

interface CampaignBuildingIdentityRow {
  id: string;
  gers_id: string | null;
}

function normalizedFeatureKey(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function featureBuildingKeys(feature: FeatureLike): string[] {
  const properties = feature.properties ?? {};
  return Array.from(
    new Set(
      [
        feature.id,
        properties.id,
        properties.gers_id,
        properties.building_id,
        properties.building_gers_id,
      ]
        .map(normalizedFeatureKey)
        .filter((value): value is string => Boolean(value))
    )
  );
}

async function decorateBuildingFeaturesWithPersistedLinks(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  featureCollection: FeatureCollectionLike
): Promise<FeatureCollectionLike> {
  if (!Array.isArray(featureCollection.features) || featureCollection.features.length === 0) {
    return featureCollection;
  }

  const [campaignAddresses, buildingLinks, buildingIdentities] = await Promise.all([
    fetchAllInPages((from, to) =>
      asPagePromise<CampaignAddressRow & {
        address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
      }>(
        supabase
          .from('campaign_addresses')
          .select(
            'id, formatted, house_number, street_name, building_id, building_gers_id, visited, scans, address_statuses(status)'
          )
          .eq('campaign_id', campaignId)
          .order('id', { ascending: true })
          .range(from, to)
      )
    ),
    fetchAllInPages((from, to) =>
      asPagePromise<BuildingAddressLinkRow>(
        supabase
          .from('building_address_links')
          .select('building_id, address_id, match_type, confidence')
          .eq('campaign_id', campaignId)
          .order('address_id', { ascending: true })
          .range(from, to)
      )
    ),
    fetchAllInPages((from, to) =>
      asPagePromise<CampaignBuildingIdentityRow>(
        supabase
          .from('buildings')
          .select('id, gers_id')
          .eq('campaign_id', campaignId)
          .range(from, to)
      )
    ),
  ]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[API] Failed to decorate snapshot buildings with persisted links:', message);
    return [null, null, null] as const;
  });

  if (!campaignAddresses || !buildingLinks || !buildingIdentities) {
    return featureCollection;
  }

  const normalizedAddresses = (campaignAddresses as Array<CampaignAddressRow & {
    address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
  }>).map((address) => ({
    ...address,
    address_status: Array.isArray(address.address_statuses)
      ? address.address_statuses[0]?.status ?? null
      : address.address_statuses?.status ?? null,
  }));

  const addressById = new Map(normalizedAddresses.map((address) => [address.id, address]));
  const buildingIdentityKeys = new Map<string, Set<string>>();
  const linkedAddressesByBuildingKey = new Map<
    string,
    Map<string, { address: CampaignAddressRow; link?: BuildingAddressLinkRow | null }>
  >();

  const addIdentityAlias = (key: unknown, alias: unknown) => {
    const normalizedKey = normalizedFeatureKey(key);
    const normalizedAlias = normalizedFeatureKey(alias);
    if (!normalizedKey || !normalizedAlias) return;
    const group = buildingIdentityKeys.get(normalizedKey) ?? new Set<string>();
    group.add(normalizedKey);
    group.add(normalizedAlias);
    buildingIdentityKeys.set(normalizedKey, group);
  };

  for (const building of buildingIdentities) {
    addIdentityAlias(building.id, building.gers_id);
    addIdentityAlias(building.gers_id, building.id);
  }

  const addLinkedAddress = (
    key: unknown,
    address: CampaignAddressRow | undefined,
    link?: BuildingAddressLinkRow | null
  ) => {
    if (!address) return;
    const normalizedKey = normalizedFeatureKey(key);
    if (!normalizedKey) return;
    const aliases = buildingIdentityKeys.get(normalizedKey) ?? new Set([normalizedKey]);
    aliases.add(normalizedKey);
    for (const alias of aliases) {
      const group = linkedAddressesByBuildingKey.get(alias) ?? new Map();
      const existing = group.get(address.id);
      group.set(address.id, {
        address,
        link: existing?.link ?? link ?? null,
      });
      linkedAddressesByBuildingKey.set(alias, group);
    }
  };

  for (const address of normalizedAddresses) {
    addLinkedAddress(address.building_id, address, null);
    addLinkedAddress(address.building_gers_id, address, null);
  }

  for (const link of buildingLinks) {
    addLinkedAddress(link.building_id, addressById.get(link.address_id), link);
  }

  let decoratedCount = 0;
  const features = featureCollection.features.map((feature) => {
    const linkedEntryMap = new Map<
      string,
      { address: CampaignAddressRow; link?: BuildingAddressLinkRow | null }
    >();
    for (const key of featureBuildingKeys(feature)) {
      const entries = linkedAddressesByBuildingKey.get(key);
      if (!entries) continue;
      for (const [addressId, entry] of entries) {
        const existing = linkedEntryMap.get(addressId);
        linkedEntryMap.set(addressId, {
          address: entry.address,
          link: existing?.link ?? entry.link ?? null,
        });
      }
    }

    const linkedEntries = Array.from(linkedEntryMap.values());
    if (linkedEntries.length === 0) {
      return feature;
    }

    decoratedCount += 1;
    const linkedAddresses = linkedEntries.map((entry) => entry.address);
    const firstAddress = linkedAddresses[0] ?? null;
    const firstLinkedEntry = linkedEntries.find((entry) => entry.link) ?? linkedEntries[0] ?? null;
    const scansTotal = linkedAddresses.reduce((sum, address) => sum + (address.scans ?? 0), 0);
    const buildingStatus = linkedAddresses.reduce<CampaignBuildingStatus>(
      (current, address) => {
        const next = getBuildingStatusForCampaignAddress(address);
        return CAMPAIGN_BUILDING_STATUS_RANK[next] > CAMPAIGN_BUILDING_STATUS_RANK[current] ? next : current;
      },
      'not_visited'
    );

    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        is_linked: true,
        address_count: linkedAddresses.length,
        address_id: linkedAddresses.length === 1 ? firstAddress?.id ?? null : null,
        address_ids: linkedAddresses.map((address) => address.id),
        address_text: linkedAddresses.length === 1 ? displayAddressText(firstAddress ?? {}) : null,
        house_number: linkedAddresses.length === 1 ? resolveHouseNumberLabel(firstAddress ?? {}) : null,
        street_name: linkedAddresses.length === 1 ? firstAddress?.street_name ?? null : null,
        address_status: linkedAddresses.length === 1 ? firstAddress?.address_status ?? null : null,
        units_count: Math.max(linkedAddresses.length, Number(feature.properties?.units_count ?? 1), 1),
        feature_type: linkedAddresses.length > 0 ? 'matched_house' : feature.properties?.feature_type,
        feature_status: linkedAddresses.length > 0 ? 'matched' : feature.properties?.feature_status,
        match_method: firstLinkedEntry?.link?.match_type ?? feature.properties?.match_method ?? null,
        confidence: firstLinkedEntry?.link?.confidence ?? feature.properties?.confidence ?? null,
        status: buildingStatus,
        scans_total: scansTotal,
        qr_scanned: scansTotal > 0,
      },
    };
  });

  if (decoratedCount > 0) {
    console.log(`[API] Decorated ${decoratedCount} building snapshot features with persisted address links`);
  }

  return {
    ...featureCollection,
    features,
  };
}

async function fetchHiddenBuildingIds(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<Set<string>> {
  const hiddenIds = new Set<string>();

  const [{ data: campaignHiddenRows, error: campaignHiddenError }, hiddenBuildingRowsResult] =
    await Promise.all([
      supabase
        .from('campaign_hidden_buildings')
        .select('public_building_id')
        .eq('campaign_id', campaignId),
      supabase
        .from('buildings')
        .select('id, gers_id')
        .eq('campaign_id', campaignId)
        .eq('is_hidden', true),
    ]);

  if (campaignHiddenError) {
    console.warn('[API] Failed to load campaign_hidden_buildings:', campaignHiddenError.message);
  } else {
    for (const row of campaignHiddenRows ?? []) {
      const publicBuildingId = String(
        (row as { public_building_id?: string | null }).public_building_id ?? ''
      ).trim();
      if (publicBuildingId) {
        hiddenIds.add(publicBuildingId);
      }
    }
  }

  if (hiddenBuildingRowsResult.error) {
    console.warn('[API] Failed to load hidden buildings:', hiddenBuildingRowsResult.error.message);
  } else {
    for (const row of hiddenBuildingRowsResult.data ?? []) {
      const building = row as { id?: string | null; gers_id?: string | null };
      for (const identifier of [building.id, building.gers_id]) {
        const normalized = String(identifier ?? '').trim();
        if (normalized) {
          hiddenIds.add(normalized);
        }
      }
    }
  }

  return hiddenIds;
}

const GOLD_BUILDING_LOOKUP_BATCH_SIZE = 200;

function parseGoldBuildingRows(raw: unknown): GoldBuildingRow[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    const first = raw[0] as Record<string, unknown>;
    if ('geom_geojson' in first) {
      return raw as GoldBuildingRow[];
    }
    if (first?.type === 'Feature') {
      return raw
        .map((feature) => featureToGoldBuildingRow(feature as Record<string, unknown>))
        .filter((feature): feature is GoldBuildingRow => Boolean(feature));
    }
    return raw as GoldBuildingRow[];
  }

  if (typeof raw === 'string') {
    try {
      return parseGoldBuildingRows(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('get_gold_buildings_in_polygon_geojson' in obj) {
      return parseGoldBuildingRows(obj.get_gold_buildings_in_polygon_geojson);
    }
    if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
      return obj.features
        .map((feature) => featureToGoldBuildingRow(feature as Record<string, unknown>))
        .filter((feature): feature is GoldBuildingRow => Boolean(feature));
    }
    if (obj.type === 'Feature') {
      const feature = featureToGoldBuildingRow(obj);
      return feature ? [feature] : [];
    }
  }

  return [];
}

function featureToGoldBuildingRow(feature: Record<string, unknown>): GoldBuildingRow | null {
  const geometry = feature.geometry as Record<string, unknown> | undefined;
  if (!geometry) return null;
  const properties = (feature.properties as Record<string, unknown> | undefined) ?? {};
  const id = properties.id ?? feature.id;
  if (!id) return null;

  return {
    id: String(id),
    area_sqm: typeof properties.area_sqm === 'number' ? properties.area_sqm : null,
    building_type: typeof properties.building_type === 'string' ? properties.building_type : null,
    geom_geojson: JSON.stringify(geometry),
    geom: geometry,
  };
}

function toGoldBuildingGeometry(building: GoldBuildingRow): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (typeof building.geom_geojson === 'string' && building.geom_geojson.trim()) {
    try {
      return JSON.parse(building.geom_geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } catch {
      return null;
    }
  }

  if (typeof building.geom === 'string' && building.geom.trim()) {
    try {
      return JSON.parse(building.geom) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } catch {
      return null;
    }
  }

  if (building.geom && typeof building.geom === 'object') {
    const candidate = building.geom as { type?: unknown; coordinates?: unknown };
    if (
      (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
      Array.isArray(candidate.coordinates)
    ) {
      return candidate as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }
  }

  return null;
}

function toCampaignBuildingGeometry(
  building: Pick<CampaignBuildingRow, 'geom'>
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (typeof building.geom === 'string' && building.geom.trim()) {
    try {
      return JSON.parse(building.geom) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } catch {
      return null;
    }
  }

  if (building.geom && typeof building.geom === 'object') {
    const candidate = building.geom as { type?: unknown; coordinates?: unknown };
    if (
      (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
      Array.isArray(candidate.coordinates)
    ) {
      return candidate as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }
  }

  return null;
}

function getCampaignBuildingSource(building: Pick<CampaignBuildingRow, 'source'>): 'manual' | 'silver' {
  return String(building.source ?? '').toLowerCase() === 'manual' ? 'manual' : 'silver';
}

function buildCampaignBuildingFallbackFeatureCollection(
  buildings: CampaignBuildingRow[],
  campaignAddresses: CampaignAddressRow[],
  buildingLinks: BuildingAddressLinkRow[]
) {
  const addressById = new Map(campaignAddresses.map((address) => [address.id, address]));
  const buildingLinksById = new Map<string, BuildingAddressLinkRow[]>();
  const addressesByBuildingKey = new Map<string, CampaignAddressRow[]>();

  for (const link of buildingLinks) {
    const group = buildingLinksById.get(link.building_id) ?? [];
    group.push(link);
    buildingLinksById.set(link.building_id, group);
  }

  for (const address of campaignAddresses) {
    const keys = new Set(
      [address.building_id, address.building_gers_id].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    );

    for (const key of keys) {
      const group = addressesByBuildingKey.get(key) ?? [];
      group.push(address);
      addressesByBuildingKey.set(key, group);
    }
  }

  const features = buildings.flatMap((building) => {
    const geometry = toCampaignBuildingGeometry(building);
    if (!geometry) return [];

    const publicBuildingId = building.gers_id ?? building.id;
    const linkedAddressMap = new Map<
      string,
      { address: CampaignAddressRow; link?: BuildingAddressLinkRow | null }
    >();

    const candidateKeys = Array.from(
      new Set([building.id, publicBuildingId].filter((value): value is string => value.length > 0))
    );

    for (const key of candidateKeys) {
      const linksForKey = buildingLinksById.get(key) ?? [];
      for (const link of linksForKey) {
        const address = addressById.get(link.address_id);
        if (address) {
          linkedAddressMap.set(address.id, { address, link });
        }
      }

      const directAddresses = addressesByBuildingKey.get(key) ?? [];
      for (const address of directAddresses) {
        const existing = linkedAddressMap.get(address.id);
        linkedAddressMap.set(address.id, {
          address,
          link: existing?.link ?? null,
        });
      }
    }

    const linkedEntries = Array.from(linkedAddressMap.values());
    const linkedAddresses = linkedEntries.map((entry) => entry.address);
    const firstAddress = linkedAddresses[0] ?? null;
    const firstLinkedEntry = linkedEntries.find((entry) => entry.link) ?? linkedEntries[0] ?? null;
    const scansTotal = linkedAddresses.reduce((sum, address) => sum + (address.scans ?? 0), 0);
    const source = getCampaignBuildingSource(building);
    const buildingStatus = linkedAddresses.reduce<CampaignBuildingStatus>(
      (current, address) => {
        const next = getBuildingStatusForCampaignAddress(address);
        return CAMPAIGN_BUILDING_STATUS_RANK[next] > CAMPAIGN_BUILDING_STATUS_RANK[current] ? next : current;
      },
      building.latest_status === 'interested' ? 'visited' : 'not_visited'
    );

    return [{
      type: 'Feature',
      id: publicBuildingId,
      geometry,
      properties: {
        id: publicBuildingId,
        building_id: publicBuildingId,
        gers_id: publicBuildingId,
        source,
        address_count: linkedAddresses.length,
        address_id: linkedAddresses.length === 1 ? firstAddress?.id ?? null : null,
        address_text: linkedAddresses.length === 1 ? displayAddressText(firstAddress ?? {}) : null,
        house_number: linkedAddresses.length === 1 ? resolveHouseNumberLabel(firstAddress ?? {}) : null,
        street_name: linkedAddresses.length === 1 ? firstAddress?.street_name ?? null : null,
        height: Math.max(building.height_m ?? building.height ?? 10, 10),
        height_m: Math.max(building.height_m ?? building.height ?? 10, 10),
        min_height: 0,
        is_townhome: false,
        units_count: Math.max(linkedAddresses.length, 1),
        is_linked: linkedAddresses.length > 0,
        feature_type: source === 'manual' ? 'manual_building' : linkedAddresses.length > 0 ? 'matched_house' : 'orphan',
        feature_status: linkedAddresses.length > 0 ? 'matched' : source === 'manual' ? 'manual' : 'unlinked',
        match_method: firstLinkedEntry?.link?.match_type ?? (linkedAddresses.length > 0 ? source : null),
        confidence: firstLinkedEntry?.link?.confidence ?? (linkedAddresses.length > 0 ? 0.8 : null),
        status: buildingStatus,
        scans_today: 0,
        scans_total: scansTotal,
        qr_scanned: scansTotal > 0,
      },
    }];
  });

  return {
    type: 'FeatureCollection',
    features,
  } as const;
}

function buildGoldFallbackFeatureCollection(
  goldBuildings: GoldBuildingRow[],
  campaignAddresses: CampaignAddressRow[]
) {
  const addressGroups = new Map<string, CampaignAddressRow[]>();

  for (const address of campaignAddresses) {
    if (address.building_id) {
      const group = addressGroups.get(address.building_id) ?? [];
      group.push(address);
      addressGroups.set(address.building_id, group);
    }
  }

  const features = goldBuildings.flatMap((building) => {
    const geometry = toGoldBuildingGeometry(building);
    if (!geometry) return [];

    const linkedAddresses = addressGroups.get(building.id) ?? [];
    const firstAddress = linkedAddresses[0] ?? null;
    const scansTotal = linkedAddresses.reduce((sum, address) => sum + (address.scans ?? 0), 0);
    const isMatched = linkedAddresses.length > 0;
    const buildingStatus = linkedAddresses.reduce<CampaignBuildingStatus>(
      (current, address) => {
        const next = getBuildingStatusForCampaignAddress(address);
        return CAMPAIGN_BUILDING_STATUS_RANK[next] > CAMPAIGN_BUILDING_STATUS_RANK[current] ? next : current;
      },
      'not_visited'
    );

    return [{
      type: 'Feature',
      id: building.id,
      geometry,
      properties: {
        id: building.id,
        building_id: building.id,
        gers_id: building.id,
        source: 'gold',
        address_count: linkedAddresses.length,
        address_id: linkedAddresses.length === 1 ? firstAddress?.id ?? null : null,
        address_text: linkedAddresses.length === 1 ? displayAddressText(firstAddress ?? {}) : null,
        house_number: linkedAddresses.length === 1 ? resolveHouseNumberLabel(firstAddress ?? {}) : null,
        street_name: linkedAddresses.length === 1 ? firstAddress?.street_name ?? null : null,
        address_status: linkedAddresses.length === 1 ? firstAddress?.address_status ?? null : null,
        height: 10,
        height_m: 10,
        min_height: 0,
        area_sqm: building.area_sqm ?? null,
        building_type: building.building_type ?? null,
        feature_type: isMatched ? 'matched_house' : 'orphan',
        feature_status: isMatched ? 'matched' : 'orphan_building',
        is_linked: isMatched,
        status: buildingStatus,
        scans_today: 0,
        scans_total: scansTotal,
      },
    }];
  });

  return {
    type: 'FeatureCollection',
    features,
  } as const;
}

function isMissingBuildingsSourceColumnError(message: string): boolean {
  return /column .*source does not exist/i.test(message) && /\bbuildings?\b/i.test(message);
}

async function fetchCampaignBuildingRows(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<CampaignBuildingRow[]> {
  const selectClauses = [
    'id, gers_id, source, geom, height_m, height, latest_status, house_name, addr_street, is_hidden',
    'id, gers_id, geom, height, latest_status, house_name, addr_street, is_hidden',
  ];
  let lastError: string | null = null;

  for (const selectClause of selectClauses) {
    const { data, error } = await supabase
      .from('buildings')
      .select(selectClause)
      .eq('campaign_id', campaignId)
      .order('id', { ascending: true });

    if (error) {
      lastError = error.message;
      continue;
    }

    return ((data ?? []) as unknown as Array<CampaignBuildingRow & { is_hidden?: boolean | null }>)
      .filter((building) => !building.is_hidden)
      .map((building) => {
        const normalized = { ...building };
        delete (normalized as { is_hidden?: boolean | null }).is_hidden;
        if (!('source' in normalized)) normalized.source = null;
        if (!('height_m' in normalized)) normalized.height_m = null;
        return normalized;
      });
  }

  if (lastError && isMissingBuildingsSourceColumnError(lastError)) {
    console.warn('[API] Campaign building fallback retrying without buildings.source column');
  }

  throw new Error(lastError ?? 'Unknown buildings query error');
}

async function fetchCampaignBuildingFallbackFeatures(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string
) {
  let buildings: CampaignBuildingRow[] = [];

  try {
    buildings = await fetchCampaignBuildingRows(supabase, campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[API] Campaign building fallback query failed:', message);
    return null;
  }

  if (buildings.length === 0) {
    console.log('[API] Campaign building fallback found 0 campaign-scoped buildings');
    return null;
  }

  const [campaignAddresses, buildingLinks] = await Promise.all([
    fetchAllInPages((from, to) =>
      asPagePromise<CampaignAddressRow & {
        address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
      }>(
        supabase
        .from('campaign_addresses')
        .select(
          'id, formatted, house_number, street_name, building_id, building_gers_id, visited, scans, address_statuses(status)'
        )
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
      )
    ),
    fetchAllInPages((from, to) =>
      asPagePromise<BuildingAddressLinkRow>(
        supabase
        .from('building_address_links')
        .select('building_id, address_id, match_type, confidence')
        .eq('campaign_id', campaignId)
        .order('address_id', { ascending: true })
        .range(from, to)
      )
    ),
  ]).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[API] Campaign building fallback link query failed:', message);
    return [null, null] as const;
  });

  if (!campaignAddresses || !buildingLinks) {
    return null;
  }

  const normalizedAddresses = (campaignAddresses as Array<CampaignAddressRow & {
    address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
  }>).map((address) => ({
    ...address,
    address_status: Array.isArray(address.address_statuses)
      ? address.address_statuses[0]?.status ?? null
      : address.address_statuses?.status ?? null,
  }));

  const fallback = buildCampaignBuildingFallbackFeatureCollection(
    buildings,
    normalizedAddresses,
    buildingLinks as BuildingAddressLinkRow[]
  );

  if (fallback.features.length === 0) {
    console.warn('[API] Campaign building fallback found rows but no renderable geometries');
    return null;
  }

  console.log(`[API] Campaign building fallback loaded ${fallback.features.length} campaign-scoped polygon buildings`);
  return fallback;
}

async function fetchGoldFallbackFeatures(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  territoryBoundary: GeoJSON.Polygon | null
) {
  if (!territoryBoundary) {
    console.warn('[API] Gold fallback skipped: campaign has no territory_boundary');
    return null;
  }

  let campaignAddresses: Array<
    CampaignAddressRow & {
      address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
    }
  > = [];

  try {
    campaignAddresses = await fetchAllInPages((from, to) =>
      asPagePromise<CampaignAddressRow & {
        address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
      }>(
        supabase
        .from('campaign_addresses')
        .select('id, formatted, house_number, street_name, building_id, visited, scans, address_statuses(status)')
        .eq('campaign_id', campaignId)
        .order('id', { ascending: true })
        .range(from, to)
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[API] Gold fallback address query failed:', message);
    return null;
  }

  if (!Array.isArray(campaignAddresses)) {
    console.warn('[API] Gold fallback skipped: campaign addresses payload was not an array');
    return null;
  }

  const normalizedAddresses = (campaignAddresses as Array<CampaignAddressRow & {
    address_statuses?: { status?: string | null } | Array<{ status?: string | null }> | null;
  }>).map((address) => ({
    ...address,
    address_status: Array.isArray(address.address_statuses)
      ? address.address_statuses[0]?.status ?? null
      : address.address_statuses?.status ?? null,
  }));

  const linkedBuildingIds = Array.from(
    new Set(
      normalizedAddresses
        .map((address) => address.building_id)
        .filter((buildingId): buildingId is string => typeof buildingId === 'string' && buildingId.length > 0)
    )
  );
  console.log(`[API] Gold fallback found ${linkedBuildingIds.length} linked building ids on campaign addresses`);

  if (linkedBuildingIds.length > 0) {
    const linkedBuildings: GoldBuildingRow[] = [];
    let linkedBuildingsFailed = false;

    for (let index = 0; index < linkedBuildingIds.length; index += GOLD_BUILDING_LOOKUP_BATCH_SIZE) {
      const idBatch = linkedBuildingIds.slice(index, index + GOLD_BUILDING_LOOKUP_BATCH_SIZE);
      const { data: buildingBatch, error: linkedBuildingsError } = await supabase
        .from('ref_buildings_gold')
        .select('id, area_sqm, building_type, geom')
        .in('id', idBatch);

      if (linkedBuildingsError) {
        console.warn('[API] Gold fallback direct linked-building query failed:', linkedBuildingsError.message);
        linkedBuildingsFailed = true;
        break;
      }

      if (Array.isArray(buildingBatch) && buildingBatch.length > 0) {
        linkedBuildings.push(...(buildingBatch as GoldBuildingRow[]));
      }
    }

    if (!linkedBuildingsFailed && linkedBuildings.length > 0) {
      console.log(`[API] Gold fallback loaded ${linkedBuildings.length} buildings directly by linked ids`);
      const fallback = buildGoldFallbackFeatureCollection(
        linkedBuildings,
        normalizedAddresses
      );
      if (fallback.features.length > 0) {
        return fallback;
      }
      console.warn('[API] Gold fallback direct linked-building query returned rows but no renderable geometries');
    }
  }

  const { data: polygonBuildings, error: polygonBuildingsError } = await supabase.rpc(
    'get_gold_buildings_in_polygon_geojson',
    { p_polygon_geojson: JSON.stringify(territoryBoundary) }
  );

  if (polygonBuildingsError) {
    console.warn('[API] Gold fallback polygon building query failed:', polygonBuildingsError.message);
    return null;
  }

  let goldBuildings = parseGoldBuildingRows(polygonBuildings);
  const polygonBuildingCount = goldBuildings.length;
  if (linkedBuildingIds.length > 0) {
    const linkedBuildingSet = new Set(linkedBuildingIds);
    const matchedBuildings = goldBuildings.filter((building) => linkedBuildingSet.has(building.id));
    console.log(
      `[API] Gold fallback matched ${matchedBuildings.length} linked buildings from polygon query (polygon returned ${polygonBuildingCount})`
    );
    goldBuildings = matchedBuildings.length > 0 ? matchedBuildings : goldBuildings;
    if (matchedBuildings.length === 0 && polygonBuildingCount > 0) {
      console.warn('[API] Gold fallback could not reconcile linked building ids with polygon rows; returning polygon buildings for visibility');
    }
  } else {
    console.log(`[API] Gold fallback loaded ${goldBuildings.length} polygon buildings`);
  }

  if (goldBuildings.length === 0) {
    console.warn('[API] Gold fallback found no linked polygon buildings');
    return null;
  }

  const fallback = buildGoldFallbackFeatureCollection(
    goldBuildings,
    normalizedAddresses
  );

  if (fallback.features.length === 0) {
    return null;
  }

  return fallback;
}

/**
 * GET /api/campaigns/[campaignId]/buildings
 * 
 * Returns building GeoJSON for a campaign.
 * - Gold: Direct spatial query of ref_buildings_gold (no linking required)
 * - Silver: Fetch from S3 snapshot
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  const requestStartedAt = Date.now();
  
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const hiddenBuildingIdsPromise = fetchHiddenBuildingIds(supabase, campaignId);

    const { data: campaignAccess, error: campaignAccessError } = await supabase
      .from('campaigns')
      .select('owner_id, workspace_id, territory_boundary, bbox, provision_source')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignAccessError || !campaignAccess) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let allowed = campaignAccess.owner_id === requestUser.id;
    if (!allowed && campaignAccess.workspace_id) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', campaignAccess.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();
      allowed = !!member?.user_id;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const hiddenBuildingIds = await hiddenBuildingIdsPromise;
    const campaignBoundary = normalizeGeoJsonPolygon((campaignAccess as CampaignAccessRow).territory_boundary);

    console.log('[API] Trying buildings from S3 snapshot');

    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (!snapshotError && snapshot?.bucket) {
      const snapshotRow = snapshot as CampaignSnapshotRow;
      const geojsonKey = resolveFallbackGeoJSONKey(snapshotRow);
      const buildingDisplayBufferMeters = isBedrockUsSnapshot(snapshotRow)
        ? PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS
        : PMTILES_BUILDING_DISPLAY_BUFFER_METERS;
      const bbox = parseBbox((campaignAccess as CampaignAccessRow).bbox) ?? bboxFromPolygon(campaignBoundary);
      const displayBbox = bbox
        ? expandBboxMeters(bbox, buildingDisplayBufferMeters)
        : null;
      const displayBoundary = bufferCampaignBoundaryMeters(
        campaignBoundary,
        buildingDisplayBufferMeters
      );
      const cacheKey = snapshotBuildingsCacheKey({
        campaignId,
        snapshot: snapshotRow,
        bbox: displayBbox,
        hiddenBuildingIds,
        boundary: displayBoundary,
      });

      const snapshotBuildings = await loadCachedBuildingsResponse(cacheKey, async () => {
        const pmtilesKey = resolvePmtilesKey(snapshotRow);

        let pmtilesCandidate: FeatureCollectionLike | null = null;
        if (pmtilesKey) {
          if (displayBbox) {
            console.log('[API] Building scoped features from PMTiles display window', {
              pmtilesKey,
              displayBufferMeters: buildingDisplayBufferMeters,
              provider: isBedrockUsSnapshot(snapshotRow) ? 'bedrock_us' : 'default',
            });
            try {
              pmtilesCandidate = await fetchVisibleScopedPmtilesBuildings({
                snapshot: snapshotRow,
                bbox: displayBbox,
                hiddenBuildingIds,
                boundary: displayBoundary,
                attempt: 'display_buffer_boundary',
              });

              if (!pmtilesCandidate && displayBoundary) {
                console.warn('[API] Buffered PMTiles boundary scope returned no buildings; retrying display bbox-only extraction');
                pmtilesCandidate = await fetchVisibleScopedPmtilesBuildings({
                  snapshot: snapshotRow,
                  bbox: displayBbox,
                  hiddenBuildingIds,
                  boundary: null,
                  attempt: 'display_bbox_only',
                });
              }

              if (!pmtilesCandidate && PMTILES_EXPANDED_BBOX_RETRY_METERS > 0) {
                console.warn('[API] PMTiles bbox extraction returned no buildings; retrying expanded bbox', {
                  meters: PMTILES_EXPANDED_BBOX_RETRY_METERS,
                });
                pmtilesCandidate = await fetchVisibleScopedPmtilesBuildings({
                  snapshot: snapshotRow,
                  bbox: expandBboxMeters(displayBbox, PMTILES_EXPANDED_BBOX_RETRY_METERS),
                  hiddenBuildingIds,
                  boundary: null,
                  attempt: 'expanded_bbox',
                });
              }
            } catch (pmtilesError) {
              console.warn(
                '[API] Scoped PMTiles building fallback failed; continuing to campaign feature fallback:',
                pmtilesError instanceof Error ? pmtilesError.message : pmtilesError
              );
            }
          } else {
            console.log('[API] Snapshot has PMTiles but campaign bbox is unavailable');
          }
        }

        const hasScopedPmtilesSource = Boolean(pmtilesKey && displayBbox);
        const pmtilesCount = getFeatureCount(pmtilesCandidate);
        const expectedSnapshotCount = Number(snapshotRow.buildings_count ?? 0);
        const shouldCheckGeojson = !pmtilesCandidate && !hasScopedPmtilesSource;

        if (pmtilesCandidate && expectedSnapshotCount > pmtilesCount) {
          console.log('[API] Using scoped PMTiles buildings without city artifact comparison', {
            pmtiles: pmtilesCount,
            snapshotCount: expectedSnapshotCount,
          });
        } else if (!pmtilesCandidate && hasScopedPmtilesSource) {
          console.warn('[API] Scoped PMTiles produced no buildings; skipping city-wide GeoJSON fallback');
        }

        if (shouldCheckGeojson) {
          try {
            const visibleGeojson = await loadVisibleSnapshotGeojsonBuildings({
              snapshot: snapshotRow,
              geojsonKey,
              hiddenBuildingIds,
              campaignBoundary: displayBoundary,
            });
            const visibleSnapshotFeatures = (visibleGeojson as { features?: unknown[] } | null)?.features ?? [];

            if (visibleSnapshotFeatures.length > pmtilesCount) {
              if (pmtilesCount > 0) {
                console.warn('[API] PMTiles scoped extraction returned fewer buildings than GeoJSON artifact', {
                  pmtiles: pmtilesCount,
                  geojson: visibleSnapshotFeatures.length,
                  expected: expectedSnapshotCount || null,
                });
              }
              return visibleGeojson as FeatureCollectionLike;
            }
          } catch (snapshotFetchError) {
            console.warn(
              '[API] Snapshot GeoJSON fallback fetch failed; continuing to direct DB fallbacks:',
              snapshotFetchError instanceof Error ? snapshotFetchError.message : snapshotFetchError
            );
          }
        }

        if (pmtilesCandidate) {
          return pmtilesCandidate;
        }

        return null;
      });

      const snapshotBuildingCount = getFeatureCount(snapshotBuildings);
      if (snapshotBuildingCount > 0 && snapshotBuildings) {
        const decoratedSnapshotBuildings = await decorateBuildingFeaturesWithPersistedLinks(
          supabase,
          campaignId,
          snapshotBuildings
        );
        console.log(
          `[API] Returning ${snapshotBuildingCount} campaign-scoped snapshot buildings in ${Date.now() - requestStartedAt}ms`
        );
        return buildingsJsonResponse(decoratedSnapshotBuildings, requestStartedAt, 'pmtiles');
      }
    } else if (snapshotError) {
      console.warn('[API] Snapshot lookup failed:', snapshotError.message);
    } else {
      console.log('[API] No Diamond snapshot found; returning address points while buildings load');
    }

    const BEDROCK_DIAMOND_SOURCES = [
      'diamond','bedrock_ca','bedrock_us','bedrock_au',
      'bedrock_nz','bedrock_za','bedrock_uk'
    ];
    let visibleFallbackFeatures: FeatureCollectionLike | null = null;

    if (BEDROCK_DIAMOND_SOURCES.includes(campaignAccess.provision_source ?? '')) {
      console.log('[API] Skipping Gold RPC fallback for Bedrock/Diamond campaign');
    } else {
      // Use the RPC for immediate address points only while Diamond builds.
      // Building polygons are served from the Diamond snapshot, not direct Gold/Silver DB fallbacks.
      console.log('[API] Fetching campaign features via rpc_get_campaign_full_features');

      const { data: campaignFeatures, error: featuresError } = await supabase.rpc(
        'rpc_get_campaign_full_features',
        { p_campaign_id: campaignId }
      );
      const normalizedCampaignFeatures = (campaignFeatures ?? null) as FeatureCollectionLike | null;
      const visibleCampaignFeatures = filterCampaignBoundaryFeatures(
        filterHiddenBuildingFeatures(normalizedCampaignFeatures, hiddenBuildingIds),
        campaignBoundary
      );
      visibleFallbackFeatures = filterAddressPointFallbackFeatures(visibleCampaignFeatures);

      if (!featuresError && (visibleCampaignFeatures?.features?.length ?? 0) > 0) {
        const hasPolygons = hasPolygonFeatures(visibleCampaignFeatures);
        const hasAddressPointFallbacks = hasAddressPointFallbackFeatures(visibleCampaignFeatures);

        if (hasPolygons) {
          console.log(
            hasAddressPointFallbacks
              ? '[API] RPC returned mixed polygons + address points; holding polygons for Diamond snapshot path'
              : '[API] RPC returned polygons; holding polygons for Diamond snapshot path'
          );
        } else {
          console.log('[API] RPC returned point-only features; showing addresses while buildings load');
        }
      } else if (featuresError) {
        console.error('[API] Feature RPC error:', featuresError.message);
      } else {
        console.log('[API] No linked features from RPC');
      }

      const visibleCampaignFeatureCount = visibleCampaignFeatures?.features?.length ?? 0;
      if (visibleCampaignFeatureCount > 0 && hasPolygonFeatures(visibleCampaignFeatures)) {
        console.log(`[API] Returning ${visibleCampaignFeatureCount} campaign-scoped RPC features after artifact fallback failed`);
        return NextResponse.json(visibleCampaignFeatures, { headers: buildingTimingHeaders(requestStartedAt, 'rpc') });
      }

    }

    if (allowDirectDbPolygonFallback()) {
      const campaignRow = campaignAccess as CampaignAccessRow;
      const goldFallback = campaignRow?.provision_source === 'gold'
        ? await fetchGoldFallbackFeatures(
            supabase,
            campaignId,
            normalizeGeoJsonPolygon(campaignRow?.territory_boundary)
        )
        : null;

      if (goldFallback) {
        const visibleGoldFallback = filterCampaignBoundaryFeatures(
          filterHiddenBuildingFeatures(goldFallback, hiddenBuildingIds),
          normalizeGeoJsonPolygon(campaignRow?.territory_boundary)
        );
        const visibleGoldFeatures = (visibleGoldFallback as { features?: unknown[] }).features ?? [];
        if (visibleGoldFeatures.length > 0) {
          console.log(`[API] Returning ${visibleGoldFeatures.length} Gold polygon features via direct fallback`);
          return NextResponse.json({
            type: 'FeatureCollection',
            features: visibleGoldFeatures,
          });
        }
      }

      const campaignBuildingFallback = await fetchCampaignBuildingFallbackFeatures(
        supabase,
        campaignId
      );

      if (campaignBuildingFallback) {
        const visibleCampaignBuildingFallback = filterCampaignBoundaryFeatures(
          filterHiddenBuildingFeatures(campaignBuildingFallback, hiddenBuildingIds),
          campaignBoundary
        );
        const visibleCampaignBuildingFeatures =
          (visibleCampaignBuildingFallback as { features?: unknown[] }).features ?? [];
        if (visibleCampaignBuildingFeatures.length > 0) {
          console.log(
            `[API] Returning ${visibleCampaignBuildingFeatures.length} campaign-scoped polygon features via direct fallback`
          );
          return NextResponse.json({
            type: 'FeatureCollection',
            features: visibleCampaignBuildingFeatures,
          }, { headers: buildingTimingHeaders(requestStartedAt, 'direct-db') });
        }
      }
    }

    const visibleFallbackFeatureCount = visibleFallbackFeatures?.features?.length ?? 0;
    if (visibleFallbackFeatureCount > 0) {
      console.log(`[API] Returning ${visibleFallbackFeatureCount} address point features while buildings load`);
      return NextResponse.json(visibleFallbackFeatures, { headers: buildingTimingHeaders(requestStartedAt, 'address-fallback') });
    }

    console.log('[API] No buildings found after all fallbacks, returning empty FeatureCollection');
    return NextResponse.json({ type: 'FeatureCollection', features: [] }, { headers: buildingTimingHeaders(requestStartedAt, 'empty') });
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
