import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import { getCampaignBuildingStatus } from '@/lib/campaignStats';
import { displayAddressText, resolveHouseNumberLabel } from '@/lib/map/addressPresentation';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
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

type CampaignBuildingStatus = ReturnType<typeof getCampaignBuildingStatus>;
const CAMPAIGN_BUILDING_STATUS_RANK: Record<CampaignBuildingStatus, number> = {
  not_visited: 0,
  visited: 1,
  no_answer: 2,
  do_not_knock: 3,
  hot: 4,
  lead: 5,
  hot_lead: 6,
};

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
  return bbox as [number, number, number, number];
}

function lonLatToTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileRangesForBbox(bbox: [number, number, number, number], maxZoom: number) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (let z = Math.min(maxZoom, 18); z >= 12; z -= 1) {
    const nw = lonLatToTile(minLon, maxLat, z);
    const se = lonLatToTile(maxLon, minLat, z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= 64 || z === 12) {
      return { z, minX, maxX, minY, maxY };
    }
  }
  return null;
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

function featureInCampaignBoundary(feature: unknown, boundary: GeoJSON.Polygon): boolean {
  const geometry = (feature as { geometry?: GeoJSON.Geometry | null } | null)?.geometry;
  const center = geometryCenter(geometry);
  if (center && pointInPolygon(center, boundary)) return true;
  return flattenPositions(geometry).some((position) => pointInPolygon(position, boundary));
}

function filterCampaignBoundaryFeatures<T extends FeatureCollectionLike | null | undefined>(
  featureCollection: T,
  boundary: GeoJSON.Polygon | null
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

async function fetchScopedPmtilesBuildingFeatures(
  snapshot: CampaignSnapshotRow,
  bbox: [number, number, number, number],
  hiddenBuildingIds: Set<string>,
  boundary: GeoJSON.Polygon | null
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
  const range = tileRangesForBbox(bbox, header.maxZoom);
  if (!range) return null;

  const byBuildingId = new Map<string, NonNullable<FeatureCollectionLike['features']>[number]>();
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const tile = await archive.getZxy(range.z, x, y);
      if (!tile) continue;

      const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
      const layer = vectorTile.layers[sourceLayer] ?? vectorTile.layers.buildings;
      if (!layer) continue;

      for (let index = 0; index < layer.length; index += 1) {
        const vectorFeature = layer.feature(index);
        const feature = vectorFeature.toGeoJSON(x, y, range.z) as GeoJSON.Feature;
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingId = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
        if (!buildingId || hiddenBuildingIds.has(buildingId) || byBuildingId.has(buildingId)) continue;

        if (!geometryIntersectsBbox(feature.geometry, bbox)) continue;
        if (boundary && !featureInCampaignBoundary(feature, boundary)) continue;

        byBuildingId.set(buildingId, {
          ...feature,
          id: buildingId,
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
        });
      }
    }
  }

  const features = Array.from(byBuildingId.values());
  if (features.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features,
  };
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

const MIN_LINKABLE_BUILDING_AREA_SQM = 40;
const NON_LINKABLE_BUILDING_TYPES = new Set([
  'shed',
  'garage',
  'garages',
  'carport',
  'parking',
  'parking_garage',
  'outbuilding',
  'accessory',
  'ancillary',
]);

function getFeatureNumericProperty(feature: unknown, key: string): number | null {
  if (!feature || typeof feature !== 'object') return null;
  const value = (feature as { properties?: Record<string, unknown> }).properties?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getFeatureStringProperty(feature: unknown, key: string): string | null {
  if (!feature || typeof feature !== 'object') return null;
  const value = (feature as { properties?: Record<string, unknown> }).properties?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ringAreaSqm(ring: unknown): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;

  const points = ring
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { lon, lat };
    })
    .filter((point): point is { lon: number; lat: number } => Boolean(point));

  if (points.length < 4) return 0;

  const avgLatRad = points.reduce((sum, point) => sum + point.lat, 0) / points.length * Math.PI / 180;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(Math.cos(avgLatRad), 0.01) * 111_320;
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (current.lon * metersPerDegreeLon) * (next.lat * metersPerDegreeLat);
    area -= (next.lon * metersPerDegreeLon) * (current.lat * metersPerDegreeLat);
  }

  return Math.abs(area) / 2;
}

function polygonAreaSqm(coordinates: unknown): number {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return 0;
  const [outer, ...holes] = coordinates;
  const outerArea = ringAreaSqm(outer);
  const holeArea = holes.reduce((sum, hole) => sum + ringAreaSqm(hole), 0);
  return Math.max(outerArea - holeArea, 0);
}

function featureGeometryAreaSqm(feature: unknown): number | null {
  if (!feature || typeof feature !== 'object') return null;
  const geometry = (feature as { geometry?: { type?: unknown; coordinates?: unknown } }).geometry;
  if (!geometry) return null;

  if (geometry.type === 'Polygon') {
    return polygonAreaSqm(geometry.coordinates);
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaSqm(polygon), 0);
  }

  return null;
}

function isLinkableBuildingFeature(feature: unknown): boolean {
  if (!isPolygonFeature(feature)) return true;

  const source = getFeatureStringProperty(feature, 'source')?.toLowerCase();
  if (source === 'manual') return true;

  const buildingType = getFeatureStringProperty(feature, 'building_type')?.toLowerCase();
  if (buildingType && NON_LINKABLE_BUILDING_TYPES.has(buildingType)) return false;

  const area = getFeatureNumericProperty(feature, 'area_sqm') ?? featureGeometryAreaSqm(feature);
  return area == null || area >= MIN_LINKABLE_BUILDING_AREA_SQM;
}

function filterNonLinkableBuildingFeatures(
  featureCollection: FeatureCollectionLike | null | undefined
): FeatureCollectionLike | null | undefined {
  if (!featureCollection || !Array.isArray(featureCollection.features)) {
    return featureCollection;
  }

  return {
    ...featureCollection,
    features: featureCollection.features.filter(isLinkableBuildingFeature),
  };
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
    
    // Use the RPC for immediate address points only while Diamond builds.
    // Building polygons are served from the Diamond snapshot, not direct Gold/Silver DB fallbacks.
    console.log('[API] Fetching campaign features via rpc_get_campaign_full_features');
    
    const { data: campaignFeatures, error: featuresError } = await supabase.rpc(
      'rpc_get_campaign_full_features',
      { p_campaign_id: campaignId }
    );
    const normalizedCampaignFeatures = (campaignFeatures ?? null) as FeatureCollectionLike | null;
    const hiddenBuildingIds = await hiddenBuildingIdsPromise;
    const campaignBoundary = normalizeGeoJsonPolygon((campaignAccess as CampaignAccessRow).territory_boundary);
    const visibleCampaignFeatures = filterCampaignBoundaryFeatures(
      filterNonLinkableBuildingFeatures(
        filterHiddenBuildingFeatures(normalizedCampaignFeatures, hiddenBuildingIds)
      ),
      campaignBoundary
    );
    const visibleFallbackFeatures = filterAddressPointFallbackFeatures(visibleCampaignFeatures);

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

    console.log('[API] Trying buildings from S3 snapshot');
    
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    
    if (!snapshotError && snapshot?.bucket) {
      const snapshotRow = snapshot as CampaignSnapshotRow;
      const geojsonKey = resolveFallbackGeoJSONKey(snapshotRow);

      const pmtilesKey = resolvePmtilesKey(snapshotRow);
      if (pmtilesKey) {
        const bbox = parseBbox((campaignAccess as CampaignAccessRow).bbox);
        if (bbox) {
          console.log('[API] Building scoped features from PMTiles bbox window', { pmtilesKey });
          try {
            const pmtilesFallback = await fetchScopedPmtilesBuildingFeatures(
              snapshotRow,
              bbox,
              hiddenBuildingIds,
              campaignBoundary
            );
            const visiblePmtilesFallback = filterNonLinkableBuildingFeatures(pmtilesFallback);
            const visiblePmtilesFeatures = (visiblePmtilesFallback as { features?: unknown[] } | null)?.features ?? [];
            if (visiblePmtilesFeatures.length > 0) {
              console.log(`[API] Returning ${visiblePmtilesFeatures.length} campaign-scoped PMTiles buildings`);
              return NextResponse.json(visiblePmtilesFallback);
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

      if (geojsonKey && !geojsonKey.endsWith('.pmtiles')) {
        console.log(`[API] Fetching snapshot GeoJSON artifact fallback: ${snapshot.bucket}/${geojsonKey}`);

        try {
          const geojson = await fetchSnapshotGeoJSONArtifact(snapshotRow, geojsonKey);
          const visibleGeojson = filterCampaignBoundaryFeatures(
            filterNonLinkableBuildingFeatures(
              filterHiddenBuildingFeatures(geojson, hiddenBuildingIds)
            ),
            campaignBoundary
          );
          const visibleSnapshotFeatures = (visibleGeojson as { features?: unknown[] }).features ?? [];

          if (visibleSnapshotFeatures.length > 0) {
            console.log(`[API] Returning ${visibleSnapshotFeatures.length} snapshot GeoJSON fallback buildings`);
            return NextResponse.json(visibleGeojson);
          }

          if (visibleFallbackFeatures?.features?.length) {
            console.log(
              `[API] Snapshot GeoJSON fallback buildings all filtered out; returning ${visibleFallbackFeatures.features.length} point features`
            );
            return NextResponse.json(visibleFallbackFeatures);
          }
        } catch (snapshotFetchError) {
          console.warn(
            '[API] Snapshot GeoJSON fallback fetch failed; continuing to direct DB fallbacks:',
            snapshotFetchError instanceof Error ? snapshotFetchError.message : snapshotFetchError
          );
        }
      }
    } else if (snapshotError) {
      console.warn('[API] Snapshot lookup failed:', snapshotError.message);
    } else {
      console.log('[API] No Diamond snapshot found; returning address points while buildings load');
    }

    const visibleCampaignFeatureCount = visibleCampaignFeatures?.features?.length ?? 0;
    if (visibleCampaignFeatureCount > 0 && hasPolygonFeatures(visibleCampaignFeatures)) {
      console.log(`[API] Returning ${visibleCampaignFeatureCount} campaign-scoped RPC features after artifact fallback failed`);
      return NextResponse.json(visibleCampaignFeatures);
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
          filterNonLinkableBuildingFeatures(
            filterHiddenBuildingFeatures(goldFallback, hiddenBuildingIds)
          ),
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
          filterNonLinkableBuildingFeatures(
            filterHiddenBuildingFeatures(campaignBuildingFallback, hiddenBuildingIds)
          ),
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
          });
        }
      }
    }

    const visibleFallbackFeatureCount = visibleFallbackFeatures?.features?.length ?? 0;
    if (visibleFallbackFeatureCount > 0) {
      console.log(`[API] Returning ${visibleFallbackFeatureCount} address point features while buildings load`);
      return NextResponse.json(visibleFallbackFeatures);
    }

    console.log('[API] No buildings found after all fallbacks, returning empty FeatureCollection');
    return NextResponse.json({ type: 'FeatureCollection', features: [] });
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
