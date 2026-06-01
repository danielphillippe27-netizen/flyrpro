import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchScopedPmtilesBuildingFeatures,
  type ScopedBuildingFeatureCollection,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-buildings';
import {
  bboxFromPositions,
  fetchScopedPmtilesParcels,
  flattenPositions,
  isDisplayableParcelFeature,
  normalizeParcelGeoJsonPolygon,
  parcelTilesFromSnapshot,
  parseParcelBbox,
  type CampaignParcelResponse,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import * as turf from '@turf/turf';

type FeatureCollection = GeoJSON.FeatureCollection;
type JsonRecord = Record<string, unknown>;
type TimingRecorder = (name: string, durationMs: number) => void;

const WEB_MERCATOR_MAX_LAT = 85.05112878;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const PMTILES_BUILDING_DISPLAY_BUFFER_METERS = Math.max(
  0,
  Number.isFinite(Number(process.env.PMTILES_BUILDING_DISPLAY_BUFFER_METERS))
    ? Number(process.env.PMTILES_BUILDING_DISPLAY_BUFFER_METERS)
    : 150
);
const PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS = Math.max(
  0,
  Number.isFinite(Number(process.env.PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS))
    ? Number(process.env.PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS)
    : 0
);

export type CurrentCampaignMapBundleRow = {
  campaign_id: string;
  asset_signature: string;
  source_version: string;
  buildings_geojson?: unknown;
  addresses_geojson?: unknown;
  parcels_geojson?: unknown;
  roads_geojson?: unknown;
  links?: unknown;
  address_orphans?: unknown;
  building_orphans?: unknown;
  display_mode_hint?: unknown;
  counts?: unknown;
  layer_fetched_at?: unknown;
  links_status?: unknown;
  built_at?: string | null;
  expires_at?: string | null;
  updated_at?: string | null;
};

export type CampaignMapBundleMetadataRow = Pick<
  CurrentCampaignMapBundleRow,
  'campaign_id' | 'asset_signature' | 'source_version' | 'expires_at' | 'updated_at'
>;

export type PrehydratedScopedMapGeometry = {
  buildings?: FeatureCollection | null;
  parcels?: FeatureCollection | null;
};

const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export const MAP_BUNDLE_RENDER_VERSION = '2026-06-01-bedrock-us-pmtiles-truth-v1';
const MIN_RENDERABLE_BUILDING_AREA_SQM = 30;
const PARCEL_LABEL_OFFSET_METERS = 4;
const SCOPED_GEOMETRY_CACHE_TTL_MS = 30_000;
const SCOPED_GEOMETRY_CACHE_MAX_ENTRIES = 64;
const scopedGeometryCache = new Map<string, { expiresAt: number; value: PrehydratedScopedMapGeometry }>();
const scopedGeometryInflight = new Map<string, Promise<PrehydratedScopedMapGeometry>>();

function elapsedMs(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

async function measure<T>(
  name: string,
  recordTiming: TimingRecorder | undefined,
  operation: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    recordTiming?.(name, elapsedMs(started));
  }
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function normalizePolygon(value: unknown): GeoJSON.Polygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizePolygon(JSON.parse(value) as unknown);
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

function bufferCampaignBoundaryMeters(
  boundary: GeoJSON.Polygon | null,
  meters: number
): GeoJSON.Polygon | null {
  if (!boundary || meters <= 0) return boundary;

  try {
    const buffered = turf.buffer(turf.feature(boundary), meters, { units: 'meters' });
    const geometry = buffered?.geometry;
    return geometry?.type === 'Polygon' ? geometry : boundary;
  } catch (error) {
    console.warn('[CampaignMapBundlePrebuilder] Failed to buffer campaign building display boundary; using strict boundary', {
      meters,
      error: error instanceof Error ? error.message : String(error),
    });
    return boundary;
  }
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

function parseGeometry(value: unknown): GeoJSON.Geometry | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return parseGeometry(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object') return null;
  const geometry = value as GeoJSON.Geometry;
  return typeof geometry.type === 'string' ? geometry : null;
}

function featureCollectionCount(value: unknown): number {
  const features = (value as { features?: unknown } | null | undefined)?.features;
  return Array.isArray(features) ? features.length : 0;
}

function asFeatureCollection(value: unknown): FeatureCollection {
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'FeatureCollection' &&
    Array.isArray((value as { features?: unknown }).features)
  ) {
    return value as FeatureCollection;
  }
  return { ...EMPTY_FEATURE_COLLECTION };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function bundleRenderVersion(row: CurrentCampaignMapBundleRow | null): string | null {
  const counts = row?.counts && typeof row.counts === 'object' ? row.counts as JsonRecord : null;
  const value = counts?.render_version;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function campaignMapBundleNeedsRebuild(row: CurrentCampaignMapBundleRow | null): boolean {
  return !row || bundleRenderVersion(row) !== MAP_BUNDLE_RENDER_VERSION;
}

function normalizedWorkflowStatus(value: unknown): string {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!status) return 'ready';
  if (status === 'ok' || status === 'fresh' || status === 'linked' || status === 'complete') {
    return 'ready';
  }
  return status;
}

function parcelRowsToFeatureCollection(rows: CampaignParcelResponse[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.flatMap((row) => {
      const geometry = parseGeometry(row.geom);
      if (!geometry) return [];
      const properties = row.properties ?? {};
      const externalId = row.external_id || row.id;
      return [{
        id: externalId,
        type: 'Feature' as const,
        geometry,
        properties: {
          ...properties,
          id: row.id,
          parcel_id: (properties.parcel_id as string | undefined) ?? externalId,
          external_id: externalId,
          source: (properties.source as string | undefined) ?? 'campaign_parcels',
        },
      }];
    }),
  };
}

function parcelFeatureExternalId(feature: GeoJSON.Feature): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidates = [
    properties.external_id,
    properties.parcel_id,
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

async function filterBundleParcelsForDisplay(
  supabase: SupabaseClient,
  campaignId: string,
  collection: FeatureCollection
): Promise<FeatureCollection> {
  if (collection.features.length === 0) return collection;

  const { data, error } = await supabase
    .from('campaign_parcels')
    .select('id, external_id, properties')
    .eq('campaign_id', campaignId)
    .limit(5000);

  if (error) {
    console.warn('[CampaignMapBundlePrebuilder] Parcel display filter metadata skipped:', {
      campaignId,
      message: error.message,
    });
    return collection;
  }

  const metadataById = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) {
    const typed = row as { id?: unknown; external_id?: unknown; properties?: unknown };
    const properties = typed.properties && typeof typed.properties === 'object'
      ? typed.properties as Record<string, unknown>
      : {};
    for (const candidate of [
      typed.external_id,
      typed.id,
      properties.external_id,
      properties.parcel_id,
      properties.id,
    ]) {
      if (typeof candidate === 'string' || typeof candidate === 'number') {
        const key = String(candidate).trim();
        if (key) metadataById.set(key, properties);
      }
    }
  }

  if (metadataById.size === 0) return collection;

  const features = collection.features.filter((feature) => {
    const externalId = parcelFeatureExternalId(feature);
    const metadata = externalId ? metadataById.get(externalId) : null;
    const filterProperties = {
      ...(feature.properties ?? {}),
      ...(metadata ?? {}),
    };
    return isDisplayableParcelFeature({
      ...feature,
      properties: filterProperties,
    });
  });

  const removed = collection.features.length - features.length;
  if (removed > 0) {
    console.log('[CampaignMapBundlePrebuilder] Filtered non-doorable parcel polygons:', {
      campaignId,
      removed,
      kept: features.length,
    });
  }

  return features.length === collection.features.length
    ? collection
    : { ...collection, features };
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const normalized = stringValue(entry);
    return normalized ? [normalized] : [];
  });
}

function uniqueStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = stringValue(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function polygonRingAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += Number(ring[index]?.[0] ?? 0) * Number(ring[index + 1]?.[1] ?? 0);
    area -= Number(ring[index + 1]?.[0] ?? 0) * Number(ring[index]?.[1] ?? 0);
  }
  const avgLat = ring.reduce((sum, point) => sum + Number(point[1] ?? 0), 0) / ring.length;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((avgLat * Math.PI) / 180);
  return Math.abs(area) / 2 * metersPerDegreeLat * metersPerDegreeLon;
}

function featureAreaSqm(feature: GeoJSON.Feature): number {
  const properties = (feature.properties ?? {}) as JsonRecord;
  const explicit = numberValue(properties.area_sqm) ??
    numberValue(properties.areaSqm) ??
    numberValue(properties.area) ??
    numberValue(properties.Shape_Area) ??
    numberValue(properties.shape_area);
  if (explicit != null) return explicit;
  const geometry = feature.geometry;
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return polygonRingAreaSqm(geometry.coordinates[0] ?? []);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonRingAreaSqm(polygon[0] ?? []), 0);
  }
  return 0;
}

function addressFeatureIdentifier(feature: GeoJSON.Feature): string | null {
  const properties = (feature.properties ?? {}) as JsonRecord;
  return stringValue(properties.id) ??
    stringValue(properties.address_id) ??
    stringValue(properties.addressId) ??
    stringValue(feature.id);
}

function pointCoordinate(feature: GeoJSON.Feature): [number, number] | null {
  const geometry = feature.geometry;
  if (geometry?.type !== 'Point') return null;
  const lon = Number(geometry.coordinates[0]);
  const lat = Number(geometry.coordinates[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function ringsForGeometry(geometry: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as number[][][];
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon as number[][][]);
  }
  return [];
}

function coordinatesForGeometry(geometry: GeoJSON.Geometry | null | undefined): number[][] {
  return ringsForGeometry(geometry).flatMap((ring) =>
    ring.flatMap((point) => {
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) ? [[lon, lat]] : [];
    })
  );
}

function bboxForGeometry(geometry: GeoJSON.Geometry | null | undefined): [number, number, number, number] | null {
  const coordinates = coordinatesForGeometry(geometry);
  if (coordinates.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}

function pointInBbox(point: [number, number], bbox: [number, number, number, number]): boolean {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  if (ring.length < 4) return false;
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = Number(ring[index]?.[0]);
    const yi = Number(ring[index]?.[1]);
    const xj = Number(ring[previous]?.[0]);
    const yj = Number(ring[previous]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: [number, number], polygon: number[][][]): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRing(point, outer)) return false;
  const holes = polygon.slice(1);
  return !holes.some((hole) => pointInRing(point, hole));
}

function parcelContainsPoint(feature: GeoJSON.Feature, point: [number, number]): boolean {
  const geometry = feature.geometry;
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates as number[][][]);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon as number[][][]));
  }
  return false;
}

function centroidForFeature(feature: GeoJSON.Feature): [number, number] | null {
  const coordinates = coordinatesForGeometry(feature.geometry);
  if (coordinates.length === 0) return null;
  const sum = coordinates.reduce(
    (acc, point) => ({ lon: acc.lon + point[0], lat: acc.lat + point[1] }),
    { lon: 0, lat: 0 }
  );
  return [sum.lon / coordinates.length, sum.lat / coordinates.length];
}

function distanceMeters(lhs: [number, number], rhs: [number, number]): number {
  const earthRadiusMeters = 6_371_000;
  const lhsLat = lhs[1] * Math.PI / 180;
  const rhsLat = rhs[1] * Math.PI / 180;
  const deltaLat = (rhs[1] - lhs[1]) * Math.PI / 180;
  const deltaLon = (rhs[0] - lhs[0]) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lhsLat) * Math.cos(rhsLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function offsetCoordinateMeters(point: [number, number], eastMeters: number, northMeters: number): [number, number] {
  const latDelta = northMeters / METERS_PER_DEGREE_LATITUDE;
  const lonScale = Math.max(Math.cos((point[1] * Math.PI) / 180), 0.01);
  const lonDelta = eastMeters / (METERS_PER_DEGREE_LATITUDE * lonScale);
  return [point[0] + lonDelta, point[1] + latDelta];
}

function parcelResidentialScore(feature: GeoJSON.Feature): number {
  const properties = (feature.properties ?? {}) as JsonRecord;
  const searchable = [
    properties.land_use,
    properties.landuse,
    properties.use,
    properties.zoning,
    properties.property_type,
    properties.type,
    properties.class,
    properties.category,
  ].map(normalizedText).join(' ');

  let score = isDisplayableParcelFeature(feature) ? 100 : 0;
  if (/residential|single|multi|town|house|dwelling/.test(searchable)) score += 25;
  if (/commercial|retail|industrial|office/.test(searchable)) score -= 10;
  if (/road|highway|rail|water|park|school|utility|hydro|right.?of.?way/.test(searchable)) score -= 50;
  return score;
}

type AddressParcelOwnership = {
  addressId: string;
  parcelId: string;
  campaignParcelId: string | null;
  matchType: 'contains';
  confidence: number;
  parcelAreaSqm: number;
  distanceMeters: number;
};

function isUuid(value: string | null | undefined): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function selectCanonicalAddressParcelOwnershipForBundle(
  addresses: FeatureCollection,
  parcels: FeatureCollection
): AddressParcelOwnership[] {
  const parcelCandidates = parcels.features.flatMap((feature) => {
    const parcelId = parcelFeatureExternalId(feature);
    if (!parcelId) return [];
    const bbox = bboxForGeometry(feature.geometry);
    if (!bbox) return [];
    const properties = (feature.properties ?? {}) as JsonRecord;
    const campaignParcelId = stringValue(properties.id);
    const centroid = centroidForFeature(feature);
    return [{
      feature,
      parcelId,
      campaignParcelId: isUuid(campaignParcelId) ? campaignParcelId : null,
      areaSqm: featureAreaSqm(feature) || Number.POSITIVE_INFINITY,
      score: parcelResidentialScore(feature),
      centroid,
      bbox,
      valid: isDisplayableParcelFeature(feature),
    }];
  });

  return addresses.features.flatMap((address) => {
    const addressId = addressFeatureIdentifier(address);
    const coordinate = pointCoordinate(address);
    if (!addressId || !coordinate) return [];

    const containing = parcelCandidates.filter((candidate) =>
      pointInBbox(coordinate, candidate.bbox) && parcelContainsPoint(candidate.feature, coordinate)
    );
    if (containing.length === 0) return [];

    const hasValid = containing.some((candidate) => candidate.valid);
    const winner = containing
      .filter((candidate) => !hasValid || candidate.valid)
      .sort((lhs, rhs) => {
        if (lhs.areaSqm !== rhs.areaSqm) return lhs.areaSqm - rhs.areaSqm;
        if (lhs.score !== rhs.score) return rhs.score - lhs.score;
        const lhsDistance = lhs.centroid ? distanceMeters(coordinate, lhs.centroid) : Number.POSITIVE_INFINITY;
        const rhsDistance = rhs.centroid ? distanceMeters(coordinate, rhs.centroid) : Number.POSITIVE_INFINITY;
        if (lhsDistance !== rhsDistance) return lhsDistance - rhsDistance;
        return lhs.parcelId.localeCompare(rhs.parcelId);
      })[0];

    if (!winner) return [];
    return [{
      addressId,
      parcelId: winner.parcelId,
      campaignParcelId: winner.campaignParcelId,
      matchType: 'contains' as const,
      confidence: 1,
      parcelAreaSqm: Number.isFinite(winner.areaSqm) ? winner.areaSqm : 0,
      distanceMeters: winner.centroid ? distanceMeters(coordinate, winner.centroid) : 0,
    }];
  });
}

function isAddressProxyBuildingFeature(feature: GeoJSON.Feature): boolean {
  const properties = (feature.properties ?? {}) as JsonRecord;
  const identifiers = [
    feature.id,
    properties.id,
    properties.gers_id,
    properties.building_id,
    properties.public_building_id,
    properties.canonical_building_id,
  ].map(normalizedText);

  return normalizedText(properties.source) === 'address_proxy' ||
    normalizedText(properties.feature_type) === 'address_proxy' ||
    normalizedText(properties.feature_status) === 'missing_footprint_proxy' ||
    normalizedText(properties.building_identifier_source) === 'address_proxy' ||
    identifiers.some((id) => id.startsWith('address-proxy-'));
}

function isRenderableBuildingFeature(feature: GeoJSON.Feature): boolean {
  if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') {
    return false;
  }
  if (isAddressProxyBuildingFeature(feature)) return false;

  const properties = (feature.properties ?? {}) as JsonRecord;
  const source = normalizedText(properties.source);
  if (source === 'manual' || source === 'manual_fallback') return true;

  return featureAreaSqm(feature) >= MIN_RENDERABLE_BUILDING_AREA_SQM;
}

function filterRenderableBuildingCollection(campaignId: string, collection: FeatureCollection): FeatureCollection {
  const features = collection.features.filter(isRenderableBuildingFeature);
  const removed = collection.features.length - features.length;
  if (removed > 0) {
    console.log('[CampaignMapBundlePrebuilder] Filtered non-renderable buildings:', {
      campaignId,
      removed,
      kept: features.length,
      minAreaSqm: MIN_RENDERABLE_BUILDING_AREA_SQM,
    });
  }
  return removed === 0 ? collection : { ...collection, features };
}

type CanonicalLinkRow = {
  id?: string | null;
  building_id: string | null;
  address_id: string | null;
  match_type: string | null;
  confidence: number | null;
  distance_meters?: number | null;
  street_match_score?: number | null;
  is_multi_unit?: boolean | null;
  unit_count?: number | null;
  unit_arrangement?: string | null;
  linker_version?: number | null;
};

function canonicalLinkPriority(matchType: unknown): number {
  const normalized = normalizedText(matchType);
  if (normalized === 'manual' || normalized === 'user_manual') return 400;
  if (
    normalized === 'exact' ||
    normalized === 'exact_match' ||
    normalized === 'contained' ||
    normalized === 'containment' ||
    normalized === 'containment_verified'
  ) {
    return 300;
  }
  if (normalized === 'parcel_bridge' || normalized === 'parcel_verified') return 200;
  if (
    normalized === 'nearest' ||
    normalized === 'nearby' ||
    normalized === 'proximity' ||
    normalized === 'proximity_verified'
  ) {
    return 100;
  }
  return 0;
}

function compareCanonicalLinks(lhs: JsonRecord, rhs: JsonRecord): number {
  const lhsPriority = canonicalLinkPriority(lhs.match_type ?? lhs.matchType);
  const rhsPriority = canonicalLinkPriority(rhs.match_type ?? rhs.matchType);
  if (lhsPriority !== rhsPriority) return rhsPriority - lhsPriority;

  const lhsConfidence = numberValue(lhs.confidence) ?? 0;
  const rhsConfidence = numberValue(rhs.confidence) ?? 0;
  if (lhsConfidence !== rhsConfidence) return rhsConfidence - lhsConfidence;

  const lhsDistance = numberValue(lhs.distance_meters ?? lhs.distanceMeters) ?? Number.POSITIVE_INFINITY;
  const rhsDistance = numberValue(rhs.distance_meters ?? rhs.distanceMeters) ?? Number.POSITIVE_INFINITY;
  if (lhsDistance !== rhsDistance) return lhsDistance - rhsDistance;

  const lhsBuilding = stringValue(lhs.building_id ?? lhs.buildingId) ?? '';
  const rhsBuilding = stringValue(rhs.building_id ?? rhs.buildingId) ?? '';
  if (lhsBuilding !== rhsBuilding) return lhsBuilding.localeCompare(rhsBuilding);

  const lhsId = stringValue(lhs.id) ?? '';
  const rhsId = stringValue(rhs.id) ?? '';
  return lhsId.localeCompare(rhsId);
}

export function dedupeCanonicalBuildingLinksForBundle(links: JsonRecord[]): JsonRecord[] {
  const bestByAddress = new Map<string, JsonRecord>();
  for (const link of links) {
    const addressId = stringValue(link.address_id ?? link.addressId);
    if (!addressId) continue;
    const key = addressId.toLowerCase();
    const existing = bestByAddress.get(key);
    if (!existing || compareCanonicalLinks(link, existing) < 0) {
      bestByAddress.set(key, link);
    }
  }

  return Array.from(bestByAddress.values()).sort((lhs, rhs) => {
    const lhsAddress = stringValue(lhs.address_id ?? lhs.addressId) ?? '';
    const rhsAddress = stringValue(rhs.address_id ?? rhs.addressId) ?? '';
    return lhsAddress.localeCompare(rhsAddress);
  });
}

async function fetchCanonicalLinks(supabase: SupabaseClient, campaignId: string): Promise<JsonRecord[]> {
  const rows = await fetchAllInPages<CanonicalLinkRow>(async (from, to) =>
    await supabase
      .from('building_address_links')
      .select('id, building_id, address_id, match_type, confidence, distance_meters, street_match_score, is_multi_unit, unit_count, unit_arrangement, linker_version')
      .eq('campaign_id', campaignId)
      .order('address_id', { ascending: true })
      .range(from, to)
  );

  const links = rows.flatMap((row) => {
    const buildingId = stringValue(row.building_id);
    const addressId = stringValue(row.address_id);
    if (!buildingId || !addressId) return [];
    return [{
      id: stringValue(row.id) ?? `${buildingId.toLowerCase()}:${addressId.toLowerCase()}`,
      building_id: buildingId,
      buildingId,
      address_id: addressId,
      addressId,
      match_type: stringValue(row.match_type) ?? 'auto',
      matchType: stringValue(row.match_type) ?? 'auto',
      confidence: numberValue(row.confidence) ?? 0.5,
      distance_meters: numberValue(row.distance_meters) ?? 0,
      distanceMeters: numberValue(row.distance_meters) ?? 0,
      street_match_score: numberValue(row.street_match_score) ?? null,
      is_multi_unit: row.is_multi_unit === true,
      unit_count: Math.max(1, Math.floor(numberValue(row.unit_count) ?? 1)),
      unit_arrangement: stringValue(row.unit_arrangement) ?? 'single',
      linker_version: numberValue(row.linker_version) ?? 1,
    }];
  });

  return dedupeCanonicalBuildingLinksForBundle(links);
}

async function fetchCanonicalAddressOrphans(supabase: SupabaseClient, campaignId: string): Promise<JsonRecord[]> {
  const rows = await fetchAllInPages<JsonRecord>(async (from, to) =>
    await supabase
      .from('address_orphans')
      .select('id, address_id, nearest_building_id, nearest_distance, nearest_building_street, address_street, street_match_score, suggested_buildings, status, suggested_street')
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'pending_review', 'ambiguous_match'])
      .range(from, to)
  );
  return rows;
}

function featureIdentifierCandidates(feature: GeoJSON.Feature): string[] {
  const properties = (feature.properties ?? {}) as JsonRecord;
  return uniqueStrings([
    ...stringArrayValue(properties.building_identifier_candidates),
    feature.id,
    properties.id,
    properties.gers_id,
    properties.building_id,
    properties.public_building_id,
    properties.canonical_building_id,
  ]);
}

function addressBuildingIdentifierCandidates(feature: GeoJSON.Feature): string[] {
  const properties = (feature.properties ?? {}) as JsonRecord;
  return uniqueStrings([
    ...stringArrayValue(properties.building_identifier_candidates),
    properties.building_gers_id,
    properties.building_id,
    properties.public_building_id,
    properties.canonical_building_id,
    properties.matched_building_id,
    properties.nearest_building_id,
  ]);
}

function addressSortParts(feature: GeoJSON.Feature | null | undefined): {
  street: string;
  houseText: string;
  houseNumber: number;
  formatted: string;
} {
  const properties = (feature?.properties ?? {}) as JsonRecord;
  const houseText = (
    stringValue(properties.house_number) ??
    stringValue(properties.house_number_label) ??
    stringValue(properties.street_number) ??
    stringValue(properties.number) ??
    ''
  ).toLowerCase();
  const houseNumber = Number(houseText.match(/\d+/)?.[0] ?? Number.NaN);
  return {
    street: (stringValue(properties.street_name) ?? '').toLowerCase(),
    houseText,
    houseNumber: Number.isFinite(houseNumber) ? houseNumber : Number.MAX_SAFE_INTEGER,
    formatted: (stringValue(properties.formatted) ?? '').toLowerCase(),
  };
}

function compareAddressIdsByDisplay(
  lhs: string,
  rhs: string,
  addressesById: Map<string, GeoJSON.Feature>
): number {
  const lhsParts = addressSortParts(addressesById.get(lhs.toLowerCase()));
  const rhsParts = addressSortParts(addressesById.get(rhs.toLowerCase()));
  if (lhsParts.street !== rhsParts.street) return lhsParts.street.localeCompare(rhsParts.street);
  if (lhsParts.houseNumber !== rhsParts.houseNumber) return lhsParts.houseNumber - rhsParts.houseNumber;
  if (lhsParts.houseText !== rhsParts.houseText) return lhsParts.houseText.localeCompare(rhsParts.houseText);
  if (lhsParts.formatted !== rhsParts.formatted) return lhsParts.formatted.localeCompare(rhsParts.formatted);
  return lhs.localeCompare(rhs);
}

function primaryBuildingIdentifier(feature: GeoJSON.Feature): string | null {
  const properties = (feature.properties ?? {}) as JsonRecord;
  return stringValue(properties.gers_id) ??
    stringValue(properties.building_id) ??
    stringValue(properties.public_building_id) ??
    stringValue(properties.canonical_building_id) ??
    stringValue(properties.id) ??
    stringValue(feature.id);
}

function houseNumberLabel(properties: JsonRecord): string | null {
  for (const key of ['house_number_label', 'house_number', 'houseNumber', 'street_number', 'street_no', 'address_number', 'number', 'addr:housenumber']) {
    const value = stringValue(properties[key]);
    if (value) return value;
  }
  const formatted = stringValue(properties.formatted);
  return formatted?.match(/^\s*([0-9]+[A-Za-z-]*)\b/)?.[1] ?? null;
}

function labelPriorityForHouseNumber(label: string | null): number {
  const numeric = label?.match(/\d+/)?.[0];
  return numeric ? Number(numeric) || 0 : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeAddressLabels(addresses: FeatureCollection): FeatureCollection {
  return {
    ...addresses,
    features: addresses.features.map((feature) => {
      const properties = { ...((feature.properties ?? {}) as JsonRecord) };
      const label = houseNumberLabel(properties);
      if (label) {
        properties.house_number_label = label;
        if (!properties.house_number) properties.house_number = label;
      }
      properties.label_priority = numberValue(properties.label_priority) ?? labelPriorityForHouseNumber(label);
      return { ...feature, properties };
    }),
  };
}

export function enrichFeatureCollectionsWithLinks(params: {
  addresses: FeatureCollection;
  buildings: FeatureCollection;
  links: JsonRecord[];
}): { addresses: FeatureCollection; buildings: FeatureCollection; buildingOrphans: JsonRecord[] } {
  const linksByAddress = new Map<string, JsonRecord>();
  for (const link of params.links) {
    const addressId = stringValue(link.address_id ?? link.addressId);
    if (!addressId) continue;
    linksByAddress.set(addressId.toLowerCase(), link);
  }

  const addressesById = new Map<string, GeoJSON.Feature>();
  const addressBuildingAliasesByAddressId = new Map<string, string[]>();
  const addresses = {
    ...params.addresses,
    features: params.addresses.features.map((feature) => {
      const properties = { ...((feature.properties ?? {}) as JsonRecord) };
      const id = stringValue(properties.id) ?? stringValue(feature.id);
      if (id) addressesById.set(id.toLowerCase(), feature);
      const link = id ? linksByAddress.get(id.toLowerCase()) : null;
      const aliases = addressBuildingIdentifierCandidates(feature);
	      if (link) {
	        const buildingId = stringValue(link.building_id ?? link.buildingId);
	        properties.building_gers_id = buildingId;
	        properties.building_id = buildingId;
	        properties.canonical_building_id = buildingId;
	        properties.linked_building_id = buildingId;
	        properties.has_building_link = true;
	        properties.match_source = stringValue(link.match_type ?? link.matchType) ?? properties.match_source;
	        properties.link_confidence = numberValue(link.confidence) ?? properties.link_confidence;
	        properties.confidence = Math.max(numberValue(properties.confidence) ?? 0, numberValue(link.confidence) ?? 0);
	        if (buildingId) aliases.push(buildingId);
	      } else {
          properties.has_building_link = false;
        }
      if (id) addressBuildingAliasesByAddressId.set(id.toLowerCase(), uniqueStrings(aliases));
      return { ...feature, properties };
    }),
  };

  const linksByBuilding = new Map<string, JsonRecord[]>();
  const addLinkForBuildingKey = (key: unknown, link: JsonRecord) => {
    const normalized = stringValue(key)?.toLowerCase();
    if (!normalized) return;
    const existing = linksByBuilding.get(normalized) ?? [];
    if (!existing.some((entry) => entry.id === link.id)) {
      existing.push(link);
      linksByBuilding.set(normalized, existing);
    }
  };

  for (const link of params.links) {
    const addressId = stringValue(link.address_id ?? link.addressId);
    const buildingId = stringValue(link.building_id ?? link.buildingId);
    if (buildingId) addLinkForBuildingKey(buildingId, link);
    if (addressId) {
      for (const alias of addressBuildingAliasesByAddressId.get(addressId.toLowerCase()) ?? []) {
        addLinkForBuildingKey(alias, link);
      }
    }
  }

  const buildingOrphans: JsonRecord[] = [];
  const buildings = {
    ...params.buildings,
    features: params.buildings.features.map((feature) => {
      const properties = { ...((feature.properties ?? {}) as JsonRecord) };
      const identifierCandidates = featureIdentifierCandidates(feature);
      const canonicalBuildingId = primaryBuildingIdentifier(feature);
      if (canonicalBuildingId) {
        properties.gers_id = properties.gers_id ?? canonicalBuildingId;
        properties.building_id = properties.building_id ?? canonicalBuildingId;
        properties.canonical_building_id = properties.canonical_building_id ?? canonicalBuildingId;
      }
      properties.building_identifier_candidates = uniqueStrings(identifierCandidates);

      const links = Array.from(new Set(identifierCandidates.map((id) => id.toLowerCase())))
        .flatMap((candidate) => linksByBuilding.get(candidate) ?? []);
      if (links.length === 0) {
        const id = stringValue(properties.gers_id) ?? stringValue(properties.building_id) ?? stringValue(feature.id);
        if (id) {
          buildingOrphans.push({ building_id: id, status: 'unlinked' });
        }
        properties.address_ids = [];
        properties.linked_address_ids = [];
        properties.address_count = 0;
        properties.is_linked = false;
        properties.feature_status = properties.feature_status ?? 'unlinked';
        return { ...feature, properties };
      }

      const addressIds = Array.from(new Set(links.flatMap((link) => {
        const addressId = stringValue(link.address_id ?? link.addressId);
        return addressId ? [addressId] : [];
      }))).sort((lhs, rhs) => compareAddressIdsByDisplay(lhs, rhs, addressesById));
      const best = links
        .slice()
        .sort((lhs, rhs) => (numberValue(rhs.confidence) ?? 0) - (numberValue(lhs.confidence) ?? 0))[0];
	      const firstAddress = addressIds[0] ? addressesById.get(addressIds[0].toLowerCase()) : null;
      const firstAddressProperties = (firstAddress?.properties ?? {}) as JsonRecord;
      const unitsCount = Math.max(
        addressIds.length,
        numberValue(properties.units_count) ?? 0,
        numberValue(best?.unit_count) ?? 0,
        1
      );

	      properties.address_ids = addressIds;
	      properties.linked_address_ids = addressIds;
	      properties.address_id = addressIds.length === 1 ? addressIds[0] : properties.address_id;
	      properties.primary_address_id = addressIds[0] ?? null;
	      properties.address_count = addressIds.length;
	      properties.linked_address_count = addressIds.length;
	      properties.is_linked = true;
      properties.feature_status = 'matched';
      properties.feature_type = 'matched_house';
      properties.match_method = properties.match_method ?? stringValue(best?.match_type ?? best?.matchType);
      properties.confidence = Math.max(numberValue(properties.confidence) ?? 0, numberValue(best?.confidence) ?? 0);
      properties.units_count = unitsCount;
      properties.unit_count = unitsCount;
      properties.is_multi_unit = unitsCount > 1 || links.some((link) => link.is_multi_unit === true);
      properties.unit_arrangement = stringValue(best?.unit_arrangement) ?? (unitsCount > 1 ? 'horizontal' : 'single');
      properties.is_townhome = properties.is_townhome === true || unitsCount > 1;
	      properties.primary_display_address = firstAddressProperties.formatted ?? properties.primary_display_address;
	      if (addressIds.length === 1) {
	        properties.address_text = properties.address_text ?? firstAddressProperties.formatted;
	        properties.house_number = properties.house_number ?? firstAddressProperties.house_number ?? firstAddressProperties.house_number_label;
	        properties.street_name = properties.street_name ?? firstAddressProperties.street_name;
	      }

      return { ...feature, properties };
    }),
  };

  return { addresses, buildings, buildingOrphans };
}

export function applyAddressParcelOwnership(params: {
  addresses: FeatureCollection;
  parcels: FeatureCollection;
  ownership: AddressParcelOwnership[];
}): { addresses: FeatureCollection; parcels: FeatureCollection } {
  const ownershipByAddressId = new Map<string, AddressParcelOwnership>();
  const addressIdsByParcelId = new Map<string, string[]>();

  for (const row of params.ownership) {
    ownershipByAddressId.set(row.addressId.toLowerCase(), row);
    const key = row.parcelId.toLowerCase();
    addressIdsByParcelId.set(key, [...(addressIdsByParcelId.get(key) ?? []), row.addressId]);
  }

  const addressesById = new Map<string, GeoJSON.Feature>();
  for (const address of params.addresses.features) {
    const id = addressFeatureIdentifier(address);
    if (id) addressesById.set(id.toLowerCase(), address);
  }

  const parcelFeatureById = new Map<string, GeoJSON.Feature>();
  for (const parcel of params.parcels.features) {
    const parcelId = parcelFeatureExternalId(parcel);
    if (parcelId) parcelFeatureById.set(parcelId.toLowerCase(), parcel);
  }

  const labelOrderByAddressId = new Map<string, { index: number; count: number }>();
  for (const [parcelId, addressIds] of addressIdsByParcelId) {
    const sortedAddressIds = Array.from(new Set(addressIds))
      .sort((lhs, rhs) => compareAddressIdsByDisplay(lhs, rhs, addressesById));
    sortedAddressIds.forEach((addressId, index) => {
      labelOrderByAddressId.set(addressId.toLowerCase(), {
        index,
        count: sortedAddressIds.length,
      });
    });
    addressIdsByParcelId.set(parcelId, sortedAddressIds);
  }

  const labelAnchorForAddress = (
    feature: GeoJSON.Feature,
    ownership: AddressParcelOwnership,
    group: { index: number; count: number } | null
  ): [number, number] | null => {
    const base = pointCoordinate(feature);
    if (!base) return null;
    const parcel = parcelFeatureById.get(ownership.parcelId.toLowerCase());
    if (!parcel || !group || group.count <= 1) return base;

    const ringPosition = group.index - ((group.count - 1) / 2);
    const eastMeters = ringPosition * PARCEL_LABEL_OFFSET_METERS;
    const northMeters = Math.abs(ringPosition % 2) * PARCEL_LABEL_OFFSET_METERS * 0.5;
    const candidate = offsetCoordinateMeters(base, eastMeters, northMeters);
    return parcelContainsPoint(parcel, candidate) ? candidate : base;
  };

  const addresses: FeatureCollection = {
    ...params.addresses,
    features: params.addresses.features.map((feature) => {
      const properties = { ...((feature.properties ?? {}) as JsonRecord) };
      const addressId = addressFeatureIdentifier(feature);
      const ownership = addressId ? ownershipByAddressId.get(addressId.toLowerCase()) : null;
      const hasBuildingLink = booleanValue(properties.has_building_link);
      const hasHouseLabel = !!houseNumberLabel(properties);
      if (ownership) {
        properties.parcel_id = ownership.parcelId;
        properties.campaign_parcel_id = ownership.campaignParcelId ?? properties.campaign_parcel_id;
        properties.parcel_match_type = ownership.matchType;
        properties.parcel_confidence = ownership.confidence;
        properties.has_parcel_link = true;
        const group = addressId ? labelOrderByAddressId.get(addressId.toLowerCase()) ?? null : null;
        const anchor = labelAnchorForAddress(feature, ownership, group);
        if (anchor) {
          properties.label_anchor_lon = anchor[0];
          properties.label_anchor_lat = anchor[1];
        }
        properties.label_group_key = `parcel:${ownership.parcelId}`;
        properties.label_group_index = group?.index ?? 0;
        properties.label_group_count = group?.count ?? 1;
      } else {
        delete properties.parcel_id;
        delete properties.campaign_parcel_id;
        delete properties.parcel_match_type;
        delete properties.parcel_confidence;
        delete properties.label_anchor_lon;
        delete properties.label_anchor_lat;
        delete properties.label_group_key;
        delete properties.label_group_index;
        delete properties.label_group_count;
        properties.has_parcel_link = false;
      }
      properties.label_visibility_mode = hasHouseLabel
        ? hasBuildingLink
          ? 'all_modes'
          : ownership
            ? 'address_mode_only'
            : 'hidden'
        : 'hidden';
      return { ...feature, properties };
    }),
  };

  const parcels: FeatureCollection = {
    ...params.parcels,
    features: params.parcels.features.map((feature) => {
      const properties = { ...((feature.properties ?? {}) as JsonRecord) };
      const parcelId = parcelFeatureExternalId(feature);
      const addressIds = parcelId
        ? Array.from(new Set(addressIdsByParcelId.get(parcelId.toLowerCase()) ?? []))
            .sort((lhs, rhs) => compareAddressIdsByDisplay(lhs, rhs, addressesById))
        : [];

      properties.linked_address_ids = addressIds;
      properties.address_ids = addressIds;
      properties.address_id = addressIds.length === 1 ? addressIds[0] : null;
      properties.address_count = addressIds.length;
      properties.is_linked = addressIds.length > 0;
      return { ...feature, properties };
    }),
  };

  return { addresses, parcels };
}

async function persistAddressParcelOwnership(params: {
  supabase: SupabaseClient;
  campaignId: string;
  ownership: AddressParcelOwnership[];
  sourceVersion: string;
}) {
  const deleteResult = await params.supabase
    .from('campaign_address_parcel_links')
    .delete()
    .eq('campaign_id', params.campaignId);

  if (deleteResult.error) {
    throw new Error(`Failed to clear campaign address-parcel links: ${deleteResult.error.message}`);
  }

  if (params.ownership.length === 0) return;

  const rows = params.ownership.map((row) => ({
    campaign_id: params.campaignId,
    address_id: row.addressId,
    campaign_parcel_id: row.campaignParcelId,
    parcel_id: row.parcelId,
    match_type: row.matchType,
    confidence: row.confidence,
    parcel_area_sqm: row.parcelAreaSqm,
    distance_meters: row.distanceMeters,
    source_version: params.sourceVersion,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await params.supabase
    .from('campaign_address_parcel_links')
    .upsert(rows, { onConflict: 'campaign_id,address_id' });

  if (error) {
    throw new Error(`Failed to persist campaign address-parcel links: ${error.message}`);
  }
}

function scopedGeometryCacheKey(params: {
  campaignId: string;
  snapshot: CampaignSnapshotRow;
  campaignRow: { bbox?: unknown; territory_boundary?: unknown } | null;
}) {
  return stableHash({
    campaign_id: params.campaignId,
    bucket: params.snapshot.bucket,
    buildings_key: params.snapshot.buildings_key,
    metadata_key: params.snapshot.metadata_key,
    buildings_count: params.snapshot.buildings_count,
    created_at: params.snapshot.created_at ?? null,
    tile_metrics: params.snapshot.tile_metrics ?? null,
    bbox: params.campaignRow?.bbox ?? null,
    territory_boundary: params.campaignRow?.territory_boundary ?? null,
  });
}

function getCachedScopedGeometry(cacheKey: string): PrehydratedScopedMapGeometry | null {
  const entry = scopedGeometryCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    scopedGeometryCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedScopedGeometry(cacheKey: string, value: PrehydratedScopedMapGeometry) {
  scopedGeometryCache.set(cacheKey, {
    expiresAt: Date.now() + SCOPED_GEOMETRY_CACHE_TTL_MS,
    value,
  });

  if (scopedGeometryCache.size > SCOPED_GEOMETRY_CACHE_MAX_ENTRIES) {
    const oldestKey = scopedGeometryCache.keys().next().value as string | undefined;
    if (oldestKey) scopedGeometryCache.delete(oldestKey);
  }
}

async function extractScopedMapGeometry(params: {
  campaignId: string;
  snapshot: CampaignSnapshotRow;
  campaignRow: { bbox?: unknown; territory_boundary?: unknown } | null;
  recordTiming?: TimingRecorder;
}): Promise<PrehydratedScopedMapGeometry> {
  const { campaignId, snapshot, campaignRow, recordTiming } = params;
  if (!snapshot.bucket) return {};

  const isBedrockUs = isBedrockUsSnapshot(snapshot);
  const buildingBufferMeters = isBedrockUs
    ? PMTILES_BEDROCK_US_BUILDING_DISPLAY_BUFFER_METERS
    : PMTILES_BUILDING_DISPLAY_BUFFER_METERS;
  const baseBuildingBbox = normalizeBbox(campaignRow?.bbox);
  const baseBuildingBoundary = normalizePolygon(campaignRow?.territory_boundary);
  const buildingBbox = baseBuildingBbox
    ? expandBboxMeters(baseBuildingBbox, buildingBufferMeters)
    : null;
  const buildingBoundary = bufferCampaignBoundaryMeters(
    baseBuildingBoundary,
    buildingBufferMeters
  );
  const parcelBoundary = normalizeParcelGeoJsonPolygon(campaignRow?.territory_boundary as GeoJSON.Polygon | string | null);
  const parcelBbox = parseParcelBbox(campaignRow?.bbox) ?? (parcelBoundary ? bboxFromPositions(flattenPositions(parcelBoundary)) : null);
  const parcelTiles = parcelTilesFromSnapshot(snapshot);

  const [buildings, parcels] = await Promise.all([
    buildingBbox
      ? measure('scoped_buildings', recordTiming, async () => {
          try {
            const scopedBuildings = await fetchScopedPmtilesBuildingFeatures(
              snapshot,
              buildingBbox,
              new Set(),
              buildingBoundary
            );
            console.log('[CampaignMapBundlePrebuilder] Scoped buildings hydrated', {
              campaignId,
              provider: isBedrockUs ? 'bedrock_us_pmtiles_truth' : 'default',
              bufferMeters: buildingBufferMeters,
              boundaryMode: buildingBoundary ? 'buffered_boundary' : 'bbox_only',
              buildings: scopedBuildings?.features.length ?? 0,
            });
            return scopedBuildings;
          } catch (error) {
            console.warn('[CampaignMapBundlePrebuilder] Failed to hydrate scoped buildings:', {
              campaignId,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        })
      : Promise.resolve(null),
    parcelBbox && parcelTiles
      ? measure('scoped_parcels', recordTiming, async () => {
          try {
            const scopedParcels = await fetchScopedPmtilesParcels(campaignId, snapshot, parcelTiles, parcelBbox, parcelBoundary);
            return scopedParcels.parcels.length
              ? parcelRowsToFeatureCollection(scopedParcels.parcels)
              : null;
          } catch (error) {
            console.warn('[CampaignMapBundlePrebuilder] Failed to hydrate scoped parcels:', {
              campaignId,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        })
      : Promise.resolve(null),
  ]);

  return {
    buildings: buildings?.features.length ? (buildings as ScopedBuildingFeatureCollection) : null,
    parcels: parcels?.features.length ? parcels : null,
  };
}

export async function resolveScopedCampaignMapGeometry(params: {
  campaignId: string;
  snapshot: CampaignSnapshotRow | null;
  campaignRow: { bbox?: unknown; territory_boundary?: unknown } | null;
  recordTiming?: TimingRecorder;
}): Promise<PrehydratedScopedMapGeometry> {
  const { campaignId, snapshot, campaignRow, recordTiming } = params;
  if (!snapshot?.bucket) return {};

  const cacheKey = scopedGeometryCacheKey({ campaignId, snapshot, campaignRow });
  const cacheStarted = performance.now();
  const cached = getCachedScopedGeometry(cacheKey);
  if (cached) {
    recordTiming?.('scoped_geometry_cache', elapsedMs(cacheStarted));
    return cached;
  }

  const existing = scopedGeometryInflight.get(cacheKey);
  if (existing) {
    const value = await existing;
    recordTiming?.('scoped_geometry_inflight', elapsedMs(cacheStarted));
    return value;
  }

  const promise = extractScopedMapGeometry({ campaignId, snapshot, campaignRow, recordTiming })
    .then((value) => {
      setCachedScopedGeometry(cacheKey, value);
      return value;
    })
    .finally(() => {
      scopedGeometryInflight.delete(cacheKey);
    });

  scopedGeometryInflight.set(cacheKey, promise);
  return promise;
}

function sourceVersionFromRpc(value: unknown): string | null {
  const source = value as { source_version?: unknown; link_source_version?: unknown } | null;
  if (typeof source?.source_version === 'string' && source.source_version.trim()) {
    return source.source_version;
  }
  if (typeof source?.link_source_version === 'string' && source.link_source_version.trim()) {
    return source.link_source_version;
  }
  return null;
}

async function getSourceVersion(
  supabase: SupabaseClient,
  campaignId: string,
  fallbackBundle?: JsonRecord
) {
  try {
    const { data, error } = await supabase.rpc('rpc_get_campaign_map_source_version', {
      p_campaign_id: campaignId,
    });
    if (!error) {
      const sourceVersion = sourceVersionFromRpc(data);
      if (sourceVersion) return sourceVersion;
    }
  } catch {
    // FLYR-PRO deployments can run before the canonical source-version RPC exists.
  }

  const counts = fallbackBundle?.counts && typeof fallbackBundle.counts === 'object'
    ? fallbackBundle.counts
    : {};
  return stableHash({
    campaign_id: campaignId,
    updated_at: fallbackBundle?.updated_at ?? null,
    counts,
  });
}

export async function readCurrentCampaignMapBundle(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CurrentCampaignMapBundleRow | null> {
  const { data, error } = await supabase
    .from('campaign_map_bundles')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_current', true)
    .maybeSingle();

  if (error) {
    console.warn('[CampaignMapBundle] Current bundle read skipped:', error.message);
    return null;
  }

  return (data as CurrentCampaignMapBundleRow | null) ?? null;
}

export async function readCurrentCampaignMapBundleMetadata(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CampaignMapBundleMetadataRow | null> {
  const { data, error } = await supabase
    .from('campaign_map_bundles')
    .select('campaign_id, asset_signature, source_version, expires_at, updated_at')
    .eq('campaign_id', campaignId)
    .eq('is_current', true)
    .maybeSingle();

  if (error) {
    console.warn('[CampaignMapBundle] Current bundle metadata read skipped:', error.message);
    return null;
  }

  return (data as CampaignMapBundleMetadataRow | null) ?? null;
}

export function responseFromCampaignMapBundleRow(row: CurrentCampaignMapBundleRow, recordTiming?: TimingRecorder) {
  const addressStarted = performance.now();
  const addresses = asFeatureCollection(row.addresses_geojson);
  recordTiming?.('addresses', elapsedMs(addressStarted));

  const buildingStarted = performance.now();
  const buildings = asFeatureCollection(row.buildings_geojson);
  recordTiming?.('buildings', elapsedMs(buildingStarted));

  const parcelStarted = performance.now();
  const parcels = asFeatureCollection(row.parcels_geojson);
  recordTiming?.('parcels', elapsedMs(parcelStarted));

  const linkStarted = performance.now();
  const links = asArray(row.links);
  recordTiming?.('links', elapsedMs(linkStarted));

  const roads = asFeatureCollection(row.roads_geojson);
  const counts = row.counts && typeof row.counts === 'object' ? row.counts as JsonRecord : {};
  const linksStatus = normalizedWorkflowStatus(counts.links_status ?? row.links_status);

  return {
    campaign_id: row.campaign_id,
    status: 'ready',
    phase: 'map_ready',
    map_ready: true,
    asset_signature: row.asset_signature,
    source_version: row.source_version,
    display_mode_hint: row.display_mode_hint === 'addresses' ? 'addresses' : 'buildings',
    links_status: linksStatus,
    addresses,
    buildings,
    parcels,
    roads,
    links,
    address_orphans: asArray(row.address_orphans),
    building_orphans: asArray(row.building_orphans),
    counts: {
      ...counts,
      addresses: Number(counts.addresses ?? addresses.features.length),
      buildings: Number(counts.buildings ?? buildings.features.length),
      parcels: Number(counts.parcels ?? parcels.features.length),
      roads: Number(counts.roads ?? roads.features.length),
      links: Number(counts.links ?? links.length),
      source_version: row.source_version,
      asset_signature: row.asset_signature,
      links_status: linksStatus,
    },
    layer_fetched_at: row.layer_fetched_at ?? {},
    built_at: row.built_at,
    expires_at: row.expires_at,
    updated_at: row.updated_at,
  };
}

export function pendingCampaignMapBundleResponse(campaignId: string) {
  return {
    campaign_id: campaignId,
    status: 'pending',
    phase: 'pending',
    map_ready: false,
    links_status: 'pending_provision',
    addresses: { ...EMPTY_FEATURE_COLLECTION },
    buildings: { ...EMPTY_FEATURE_COLLECTION },
    parcels: { ...EMPTY_FEATURE_COLLECTION },
    roads: { ...EMPTY_FEATURE_COLLECTION },
    links: [],
    address_orphans: [],
    building_orphans: [],
    counts: {
      addresses: 0,
      buildings: 0,
      parcels: 0,
      roads: 0,
      links: 0,
    },
  };
}

async function upsertCanonicalBundle(
  supabase: SupabaseClient,
  payload: {
    campaignId: string;
    assetSignature: string;
    sourceVersion: string;
    buildings: FeatureCollection;
    addresses: FeatureCollection;
    parcels: FeatureCollection;
    roads: FeatureCollection;
    links: unknown[];
    addressOrphans: unknown[];
    buildingOrphans: unknown[];
    linksStatus: string;
    displayModeHint: 'buildings' | 'addresses';
    counts: JsonRecord;
    layerFetchedAt: JsonRecord;
    builtAt: string;
    expiresAt: string;
  }
) {
  const latestArgs = {
    p_campaign_id: payload.campaignId,
    p_asset_signature: payload.assetSignature,
    p_source_version: payload.sourceVersion,
    p_buildings_geojson: payload.buildings,
    p_addresses_geojson: payload.addresses,
    p_parcels_geojson: payload.parcels,
    p_roads_geojson: payload.roads,
    p_links: payload.links,
    p_address_orphans: payload.addressOrphans,
    p_building_orphans: payload.buildingOrphans,
    p_display_mode_hint: payload.displayModeHint,
    p_counts: payload.counts,
    p_layer_fetched_at: payload.layerFetchedAt,
    p_links_status: payload.linksStatus,
    p_built_at: payload.builtAt,
    p_expires_at: payload.expiresAt,
  };
  const latest = await supabase.rpc('rpc_upsert_campaign_map_bundle', latestArgs);
  if (!latest.error) return;

  const legacyArgs = {
    p_campaign_id: payload.campaignId,
    p_asset_signature: payload.assetSignature,
    p_source_version: payload.sourceVersion,
    p_buildings_geojson: payload.buildings,
    p_addresses_geojson: payload.addresses,
    p_parcels_geojson: payload.parcels,
    p_roads_geojson: payload.roads,
    p_links: payload.links,
    p_display_mode_hint: payload.displayModeHint,
    p_counts: payload.counts,
    p_layer_fetched_at: payload.layerFetchedAt,
    p_links_status: payload.linksStatus,
    p_built_at: payload.builtAt,
    p_expires_at: payload.expiresAt,
  };
  const legacy = await supabase.rpc('rpc_upsert_campaign_map_bundle', legacyArgs);
  if (legacy.error) {
    throw new Error(`Failed to persist campaign map bundle: ${legacy.error.message}`);
  }
}

export async function prebuildCampaignMapBundle(
  supabase: SupabaseClient,
  campaignId: string,
  recordTiming?: TimingRecorder,
  options?: {
    scopedGeometry?: PrehydratedScopedMapGeometry | null;
    linksStatusOverride?: string | null;
    parcelDisplayMode?: 'filtered' | 'raw';
  }
) {
  const [{ data: snapshot }, { data: campaignRow }, currentBundle] = await Promise.all([
    measure('snapshot', recordTiming, async () =>
      await supabase
        .from('campaign_snapshots')
        .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
        .eq('campaign_id', campaignId)
        .maybeSingle()
    ),
    measure('campaign', recordTiming, async () =>
      await supabase
        .from('campaigns')
        .select('bbox, territory_boundary')
        .eq('id', campaignId)
        .maybeSingle()
    ),
    measure('current_bundle', recordTiming, () =>
      readCurrentCampaignMapBundle(supabase, campaignId)
    ),
  ]);

  const { data, error } = await measure('addresses', recordTiming, async () =>
    await supabase.rpc('rpc_get_campaign_map_bundle', { p_campaign_id: campaignId })
  );
  if (error) {
    throw new Error(`Failed to build campaign map bundle: ${error.message}`);
  }

  const bundle = (data ?? pendingCampaignMapBundleResponse(campaignId)) as JsonRecord;
  const sourceVersion = await measure('signature', recordTiming, () =>
    getSourceVersion(supabase, campaignId, bundle)
  );

  if (
    !options?.scopedGeometry &&
    currentBundle?.source_version === sourceVersion &&
    bundleRenderVersion(currentBundle) === MAP_BUNDLE_RENDER_VERSION
  ) {
    recordTiming?.('current_bundle_reused', 0);
    return responseFromCampaignMapBundleRow(currentBundle, recordTiming);
  }

  const rawAddresses = normalizeAddressLabels(asFeatureCollection(bundle.addresses));
  const baseBuildings = asFeatureCollection(bundle.buildings);
  const baseParcels = asFeatureCollection(bundle.parcels);
  const useRawScopedParcels = options?.parcelDisplayMode === 'raw';
  const filteredBaseParcels = !useRawScopedParcels && baseParcels.features.length > 0
    ? await measure('parcel_display_filter', recordTiming, () =>
        filterBundleParcelsForDisplay(supabase, campaignId, baseParcels)
      )
    : baseParcels;
  const roads = asFeatureCollection(bundle.roads);
  const snapshotRow = snapshot as CampaignSnapshotRow | null;
  const campaignScopeRow = campaignRow as { bbox?: unknown; territory_boundary?: unknown } | null;
  const needsScopedGeometry = Boolean(
    snapshotRow?.bucket &&
    (baseBuildings.features.length === 0 || baseParcels.features.length === 0)
  );
  if (options?.scopedGeometry) {
    recordTiming?.('scoped_geometry_reused', 0);
  }
  const scopedGeometry = options?.scopedGeometry ?? (needsScopedGeometry
    ? await resolveScopedCampaignMapGeometry({
        campaignId,
        snapshot: snapshotRow,
        campaignRow: campaignScopeRow,
        recordTiming,
      })
    : null);
  const rawBuildings = scopedGeometry?.buildings?.features.length
    ? scopedGeometry.buildings
    : baseBuildings;
  const parcels = useRawScopedParcels && scopedGeometry?.parcels?.features.length
    ? scopedGeometry.parcels
    : filteredBaseParcels.features.length > 0
    ? filteredBaseParcels
    : scopedGeometry?.parcels?.features.length
      ? scopedGeometry.parcels
      : filteredBaseParcels;
  const renderableBuildings = filterRenderableBuildingCollection(campaignId, rawBuildings);
  const links = await measure('links', recordTiming, () => fetchCanonicalLinks(supabase, campaignId));
  const addressOrphans = await measure('address_orphans', recordTiming, () =>
    fetchCanonicalAddressOrphans(supabase, campaignId)
  );
  const enriched = enrichFeatureCollectionsWithLinks({
    addresses: rawAddresses,
    buildings: renderableBuildings,
    links,
  });
  const isPendingProvisionBundle = normalizedWorkflowStatus(options?.linksStatusOverride) === 'pending_provision';
  const parcelOwnership = isPendingProvisionBundle
    ? []
    : selectCanonicalAddressParcelOwnershipForBundle(enriched.addresses, parcels);
  if (!isPendingProvisionBundle) {
    await measure('parcel_ownership_persist', recordTiming, () =>
      persistAddressParcelOwnership({
        supabase,
        campaignId,
        ownership: parcelOwnership,
        sourceVersion,
      })
    );
  }
  const ownershipApplied = applyAddressParcelOwnership({
    addresses: enriched.addresses,
    parcels,
    ownership: parcelOwnership,
  });
  const addresses = ownershipApplied.addresses;
  const buildings = enriched.buildings;
  const ownedParcels = ownershipApplied.parcels;
  const buildingOrphans = enriched.buildingOrphans;
  const computedLinksStatus = 'ready';
  const linksStatus = typeof options?.linksStatusOverride === 'string' && options.linksStatusOverride.trim()
    ? normalizedWorkflowStatus(options.linksStatusOverride)
    : computedLinksStatus;
	  const counts: JsonRecord = {
	    ...(bundle.counts && typeof bundle.counts === 'object' ? bundle.counts as JsonRecord : {}),
	    addresses: featureCollectionCount(addresses),
	    buildings: featureCollectionCount(buildings),
	    parcels: featureCollectionCount(ownedParcels),
	    roads: featureCollectionCount(roads),
	    links: links.length,
	    link_classification: links.length > 0 ? 'linked' : 'no_links_needed',
	    parcel_links: parcelOwnership.length,
    source_version: sourceVersion,
    render_version: MAP_BUNDLE_RENDER_VERSION,
    label_version: 'parcel-owned-house-number-label-v2',
  };
  const assetSignature = stableHash({
    campaign_id: campaignId,
    source_version: sourceVersion,
    render_version: MAP_BUNDLE_RENDER_VERSION,
    counts,
    address_orphans: addressOrphans.length,
    building_orphans: buildingOrphans.length,
    links_status: linksStatus,
    parcel_links: parcelOwnership.length,
  });
  counts.asset_signature = assetSignature;
  counts.links_status = linksStatus;

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const layerFetchedAt = {
    addresses: nowIso,
    buildings: nowIso,
    parcels: nowIso,
    roads: nowIso,
  };
  const displayModeHint = buildings.features.length > 0 ? 'buildings' : 'addresses';

  await measure('persist', recordTiming, () =>
    upsertCanonicalBundle(supabase, {
      campaignId,
      assetSignature,
      sourceVersion,
      buildings,
      addresses,
      parcels: ownedParcels,
      roads,
      links,
      addressOrphans,
      buildingOrphans,
      linksStatus,
      displayModeHint,
      counts,
      layerFetchedAt,
      builtAt: nowIso,
      expiresAt,
    })
  );

  return {
    campaign_id: campaignId,
    asset_signature: assetSignature,
    source_version: sourceVersion,
    links_status: linksStatus,
    addresses,
    buildings,
    parcels: ownedParcels,
    roads,
    links,
    address_orphans: addressOrphans,
    building_orphans: buildingOrphans,
    counts,
    layer_fetched_at: layerFetchedAt,
    built_at: nowIso,
    expires_at: expiresAt,
  };
}
