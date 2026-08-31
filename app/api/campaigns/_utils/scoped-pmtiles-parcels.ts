import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';
import Pbf from 'pbf';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import {
  type CampaignSnapshotRow,
  type ParcelPmtilesResolution,
  resolveArtifactUrl,
  resolvePmtilesKey,
} from '@/lib/diamond/geometry';

export type CampaignParcelResponse = {
  id: string;
  campaign_id: string;
  external_id: string;
  geom: string;
  properties: Record<string, unknown>;
  created_at: string;
};

export type ScopedParcelResult = {
  parcels: CampaignParcelResponse[];
  cacheStatus: 'hit' | 'miss' | 'inflight';
  timings: {
    cacheMs: number;
    artifactMs: number;
    headerMs: number;
    tileMs: number;
    filterMs: number;
    totalMs: number;
    tileCount: number;
    featureCount: number;
  };
};

export type ScopedParcelOptions = {
  residentialOnly?: boolean;
};

const PARCEL_MAX_TILE_SCAN_COUNT = 64;
const PARCEL_RESPONSE_CACHE_TTL_MS = 30_000;
const PARCEL_RESPONSE_CACHE_MAX_ENTRIES = 64;
const PARCEL_TILE_FETCH_CONCURRENCY = Math.max(
  1,
  Number.isFinite(Number(process.env.PMTILES_PARCEL_TILE_FETCH_CONCURRENCY))
    ? Number(process.env.PMTILES_PARCEL_TILE_FETCH_CONCURRENCY)
    : 12
);
const NON_RESIDENTIAL_PARCEL_TERMS = [
  'access',
  'access way',
  'access ways',
  'accessway',
  'accessways',
  'alley',
  'alleyway',
  'allowance',
  'arterial',
  'bike path',
  'bike paths',
  'bikeway',
  'bikeways',
  'bridge',
  'busway',
  'cemetery',
  'channel',
  'common area',
  'conservation',
  'corridor',
  'creek',
  'cycle path',
  'cycle paths',
  'cycleway',
  'cycleways',
  'ditch',
  'domain',
  'drain',
  'drainage',
  'drainage corridor',
  'drainage reserve',
  'easement',
  'environmental',
  'esplanade',
  'expressway',
  'fire route',
  'foot path',
  'foot paths',
  'footpath',
  'footpaths',
  'footway',
  'footways',
  'freeway',
  'freeways',
  'greenbelt',
  'greenspace',
  'highway',
  'highways',
  'hydro',
  'lane way',
  'laneway',
  'local purpose',
  'median',
  'motorway',
  'motorways',
  'multi use path',
  'multi use paths',
  'open space',
  'park',
  'parkette',
  'parkland',
  'path',
  'paths',
  'pathway',
  'pathways',
  'pedestrian',
  'pedestrian access',
  'pedestrian accessway',
  'pedestrian path',
  'pedestrian way',
  'pedestrian walkway',
  'pipeline',
  'pond',
  'public path',
  'public road',
  'public walkway',
  'rail',
  'rail corridor',
  'railway',
  'railroad',
  'ravine',
  'recreation',
  'reserve',
  'right of way',
  'right of way road',
  'right-of-way',
  'right-of-way road',
  'right_of_way',
  'rightofway',
  'road',
  'road allowance',
  'road corridor',
  'road parcel',
  'road reserve',
  'road right of way',
  'roadway',
  'roadways',
  'roads',
  'roundabout',
  'school',
  'service lane',
  'shared path',
  'shared paths',
  'shared use path',
  'shared use paths',
  'sidewalk',
  'sidewalk easement',
  'sidewalk parcel',
  'sidewalk reserve',
  'sidewalks',
  'storm sewer',
  'storm',
  'stormwater',
  'street',
  'streets',
  'substation',
  'trail',
  'transit',
  'transport',
  'transportation',
  'tunnel',
  'utility',
  'utility corridor',
  'verge',
  'walkway',
  'walkway easement',
  'walkway reserve',
  'walkways',
  'wastewater',
  'watercourse',
  'waterway',
  'river',
  'stream',
];

const PARCEL_CLASSIFICATION_PROPERTY_KEYS = [
  'agency',
  'appellation',
  'asset_type',
  'category',
  'class',
  'class_name',
  'description',
  'designation',
  'feature_class',
  'feature_type',
  'land_type',
  'land_use',
  'land_use_description',
  'landuse',
  'landuse_description',
  'legal_type',
  'lot_type',
  'maintainer',
  'municipal_use',
  'name',
  'owner',
  'owner_type',
  'ownership',
  'parcel_class',
  'parcel_intent',
  'parcel_purpose',
  'parcel_type',
  'property_class',
  'property_type',
  'property_use',
  'public_use',
  'purpose',
  'reserve_type',
  'site_type',
  'status',
  'statutory_actions',
  'sub_type',
  'subtype',
  'title_type',
  'transport',
  'transportation',
  'type',
  'use',
  'use_code',
  'use_description',
  'use_type',
  'zone',
  'zoning',
  'zoning_code',
  'zoning_description',
];

const ROAD_INDICATOR_PROPERTY_KEYS = [
  'highway',
  'highway_type',
  'access_way',
  'accessway',
  'bikeway',
  'corridor',
  'cycleway',
  'easement',
  'footpath',
  'footway',
  'linear_feature',
  'path',
  'path_type',
  'pathway',
  'pedestrian',
  'railway',
  'railway_type',
  'right-of-way',
  'right_of_way',
  'rightofway',
  'road',
  'road_class',
  'road_classification',
  'road_type',
  'roads',
  'sidewalk',
  'sidewalks',
  'trail',
  'trail_type',
  'transportation_corridor',
  'utility_corridor',
  'walkway',
];

const FALSEY_PARCEL_TEXT_VALUES = new Set(['0', 'false', 'n', 'no', 'none', 'null', 'unknown']);
const NORMALIZED_NON_RESIDENTIAL_PARCEL_TERMS = Array.from(new Set(
  NON_RESIDENTIAL_PARCEL_TERMS
    .map(normalizedResidentialParcelText)
    .filter(Boolean)
));

const parcelResponseCache = new Map<string, { expiresAt: number; value: ScopedParcelResult }>();
const parcelResponseInflight = new Map<string, Promise<ScopedParcelResult>>();

function elapsedMs(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectMetric(metrics: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const value = metrics?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parcelTilesFromSnapshot(snapshot: CampaignSnapshotRow | null): ParcelPmtilesResolution | null {
  const pmtilesKey = stringMetric(snapshot?.tile_metrics, 'parcels_pmtiles_key');
  if (!snapshot) return null;
  const sourceLayers = objectMetric(snapshot.tile_metrics, 'source_layers');
  const promoteIds = objectMetric(snapshot.tile_metrics, 'promote_ids');
  const sourceLayer = stringMetric(sourceLayers, 'parcels') ?? 'parcels';
  const promoteId = stringMetric(promoteIds, 'parcels') ?? 'parcel_id';

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
      sourceLayer,
      promoteId,
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
    sourceLayer,
    promoteId,
    minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
    maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
  };
}

export function parseParcelBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every((entry) => Number.isFinite(entry))) return null;
  return bbox as [number, number, number, number];
}

export function flattenPositions(geometry: GeoJSON.Geometry | null | undefined): Array<[number, number]> {
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

export function bboxFromPositions(positions: Array<[number, number]>): [number, number, number, number] | null {
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

function normalizeLongitudeNearParcelBbox(
  longitude: number,
  bbox: [number, number, number, number]
): number {
  if (!Number.isFinite(longitude)) return longitude;
  const bboxCenter = (bbox[0] + bbox[2]) / 2;
  let normalized = longitude;
  while (normalized - bboxCenter > 180) normalized -= 360;
  while (bboxCenter - normalized > 180) normalized += 360;
  return normalized;
}

/** Normalize vector-tile world copies into the campaign longitude world. */
export function normalizeParcelGeometryLongitudes(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  bbox: [number, number, number, number]
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const normalizePosition = (position: GeoJSON.Position): GeoJSON.Position => [
    Number(normalizeLongitudeNearParcelBbox(Number(position[0]), bbox).toFixed(12)),
    Number(position[1]),
    ...position.slice(2),
  ];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const uniquePolygons: GeoJSON.Position[][][] = [];
  const seen = new Set<string>();

  for (const polygon of polygons) {
    const normalized = polygon.map((ring) => ring.map(normalizePosition));
    const signature = JSON.stringify(normalized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    uniquePolygons.push(normalized);
  }

  return uniquePolygons.length === 1
    ? { type: 'Polygon', coordinates: uniquePolygons[0] }
    : { type: 'MultiPolygon', coordinates: uniquePolygons };
}

function geometryCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const bbox = bboxFromPositions(flattenPositions(geometry));
  if (!bbox) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

export function normalizeParcelGeoJsonPolygon(value: GeoJSON.Polygon | string | null | undefined): GeoJSON.Polygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizeParcelGeoJsonPolygon(JSON.parse(value) as GeoJSON.Polygon);
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
  if (geometry) {
    try {
      return turf.booleanIntersects(
        turf.feature(geometry),
        turf.bboxPolygon(bbox)
      );
    } catch {
      // Fall through to the cheap vertex check for malformed municipal shapes.
    }
  }

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

export function tileRangeForParcelBbox(bbox: [number, number, number, number], maxZoom: number) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  for (let z = maxZoom; z >= 10; z -= 1) {
    const nw = lonLatToTile(minLon, maxLat, z);
    const se = lonLatToTile(maxLon, minLat, z);
    const minX = Math.min(nw.x, se.x);
    const maxX = Math.max(nw.x, se.x);
    const minY = Math.min(nw.y, se.y);
    const maxY = Math.max(nw.y, se.y);
    const tileCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (tileCount <= PARCEL_MAX_TILE_SCAN_COUNT || z === 10) {
      return { z, minX, maxX, minY, maxY };
    }
  }
  return null;
}

export function getParcelFeatureExternalId(feature: GeoJSON.Feature, promoteId?: string | null): string | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const candidates = [
    promoteId ? properties[promoteId] : null,
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
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.map(normalizedParcelText).filter(Boolean).join(' ');
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(normalizedParcelText)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function normalizedResidentialParcelText(value: unknown): string {
  if (typeof value === 'string') {
    return value
      .trim()
      .toLowerCase()
      .replace(/[_/\\-]+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function parcelPropertyResolver(properties: Record<string, unknown>): (key: string) => unknown {
  const propertiesByLowercaseKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(properties)) {
    const lowerKey = key.toLowerCase();
    if (!propertiesByLowercaseKey.has(lowerKey)) {
      propertiesByLowercaseKey.set(lowerKey, value);
    }
  }

  return (key: string) =>
    Object.prototype.hasOwnProperty.call(properties, key)
      ? properties[key]
      : propertiesByLowercaseKey.get(key.toLowerCase());
}

function residentialParcelTextValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(residentialParcelTextValues);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(residentialParcelTextValues);
  }

  const text = normalizedResidentialParcelText(value);
  return text ? [text] : [];
}

function hasResidentialExclusionTerm(value: unknown): boolean {
  return residentialParcelTextValues(value).some((text) =>
    NORMALIZED_NON_RESIDENTIAL_PARCEL_TERMS.some((term) => ` ${text} `.includes(` ${term} `))
  );
}

function hasTruthyRoadIndicatorProperty(propertyValue: (key: string) => unknown): boolean {
  return ROAD_INDICATOR_PROPERTY_KEYS.some((key) => {
    const value = propertyValue(key);
    if (value === null || value === undefined) return false;
    const values = residentialParcelTextValues(value);
    if (values.length === 0) return false;
    return values.some((text) => !FALSEY_PARCEL_TEXT_VALUES.has(text));
  });
}

function hasNonResidentialParcelTerm(value: unknown): boolean {
  const text = normalizedParcelText(value);
  if (!text) return false;
  return NON_RESIDENTIAL_PARCEL_TERMS.some((term) => text.includes(term));
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parcelAreaSqm(properties: Record<string, unknown>): number | null {
  const rawAttributes = properties.raw_attributes && typeof properties.raw_attributes === 'object'
    ? properties.raw_attributes as Record<string, unknown>
    : {};
  return (
    numberValue(properties.area_sqm) ??
    numberValue(properties.area) ??
    numberValue(rawAttributes.Shape__Area) ??
    numberValue(rawAttributes.SHAPE_Area) ??
    numberValue(rawAttributes.shape_area)
  );
}

function parcelPerimeterMeters(properties: Record<string, unknown>): number | null {
  const rawAttributes = properties.raw_attributes && typeof properties.raw_attributes === 'object'
    ? properties.raw_attributes as Record<string, unknown>
    : {};
  return (
    numberValue(properties.perimeter_m) ??
    numberValue(properties.perimeter) ??
    numberValue(properties.shape_length) ??
    numberValue(rawAttributes.Shape__Length) ??
    numberValue(rawAttributes.SHAPE_Length) ??
    numberValue(rawAttributes.shape_length)
  );
}

function hasNonDoorableParcelShape(properties: Record<string, unknown>): boolean {
  const area = parcelAreaSqm(properties);
  const perimeter = parcelPerimeterMeters(properties);
  if (area == null || perimeter == null || perimeter <= 0) return false;

  const compactness = area / (perimeter * perimeter);
  return perimeter >= 250 && compactness < 0.012;
}

export function isDisplayableParcelFeature(feature: GeoJSON.Feature): boolean {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  if ([
    properties.parcel_intent,
    properties.appellation,
    properties.statutory_actions,
    properties.zoning,
    properties.land_use,
    properties.landuse,
    properties.use,
    properties.type,
    properties.class,
    properties.subtype,
    properties.category,
    properties.feature_type,
    properties.status,
    properties.description,
    properties.name,
    properties.road_name,
    properties.raw_attributes,
  ].some(hasNonResidentialParcelTerm)) {
    return false;
  }

  return !hasNonDoorableParcelShape(properties);
}

export function isResidentialParcelFeature(feature: GeoJSON.Feature): boolean {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const propertyValue = parcelPropertyResolver(properties);
  const topologyType = normalizedResidentialParcelText(propertyValue('topology_type'));
  if (topologyType && topologyType !== 'primary') return false;

  if (hasTruthyRoadIndicatorProperty(propertyValue)) return false;

  if (PARCEL_CLASSIFICATION_PROPERTY_KEYS.some((key) =>
    hasResidentialExclusionTerm(propertyValue(key))
  )) {
    return false;
  }

  const intent = normalizedResidentialParcelText(propertyValue('parcel_intent'));
  if (!intent) return true;
  return intent === 'fee simple title' || intent === 'dcdb' || intent.includes('residential');
}

export function featureWithinParcelCampaignScope(
  feature: GeoJSON.Feature,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null
): boolean {
  const center = geometryCenter(feature.geometry);
  const inBbox = (center && pointInBbox(center, bbox)) || geometryIntersectsBbox(feature.geometry, bbox);
  if (!inBbox) return false;
  if (!boundary) return true;
  try {
    return turf.booleanIntersects(
      feature as GeoJSON.Feature<GeoJSON.Geometry>,
      turf.feature(boundary)
    );
  } catch {
    // Fall through to center/vertex checks for malformed municipal shapes.
  }

  if (center && pointInPolygon(center, boundary)) return true;

  return flattenPositions(feature.geometry).some((position) => pointInPolygon(position, boundary));
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

function cacheKeyForScopedParcels(params: {
  campaignId: string;
  snapshot: CampaignSnapshotRow;
  parcelTiles: ParcelPmtilesResolution;
  bbox: [number, number, number, number];
  boundary: GeoJSON.Polygon | null;
  residentialOnly: boolean;
}) {
  return [
    'parcels',
    params.campaignId,
    params.snapshot.bucket,
    params.parcelTiles.pmtilesKey,
    params.snapshot.created_at ?? '',
    JSON.stringify(params.bbox),
    JSON.stringify(params.boundary),
    params.residentialOnly ? 'residential' : 'display',
  ].join('|');
}

function getCachedScopedParcels(cacheKey: string): ScopedParcelResult | null {
  const entry = parcelResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    parcelResponseCache.delete(cacheKey);
    return null;
  }
  return {
    ...entry.value,
    cacheStatus: 'hit',
    timings: {
      ...entry.value.timings,
      cacheMs: 0,
      totalMs: 0,
    },
  };
}

function setCachedScopedParcels(cacheKey: string, value: ScopedParcelResult) {
  parcelResponseCache.set(cacheKey, {
    expiresAt: Date.now() + PARCEL_RESPONSE_CACHE_TTL_MS,
    value: {
      ...value,
      cacheStatus: 'hit',
    },
  });

  if (parcelResponseCache.size > PARCEL_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = parcelResponseCache.keys().next().value as string | undefined;
    if (oldestKey) parcelResponseCache.delete(oldestKey);
  }
}

async function extractScopedPmtilesParcels(
  campaignId: string,
  snapshot: CampaignSnapshotRow,
  parcelTiles: ParcelPmtilesResolution,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null,
  options: ScopedParcelOptions = {}
): Promise<ScopedParcelResult> {
  const totalStarted = performance.now();
  const artifactStarted = performance.now();
  const pmtilesUrl = await resolveArtifactUrl(snapshot, parcelTiles.pmtilesKey);
  const artifactMs = elapsedMs(artifactStarted);
  const archive = getCachedPmtilesArchive(pmtilesUrl);
  const headerStarted = performance.now();
  const header = await archive.getHeader();
  const headerMs = elapsedMs(headerStarted);
  const range = tileRangeForParcelBbox(bbox, Math.min(header.maxZoom, parcelTiles.maxzoom));
  if (!range) {
    return {
      parcels: [],
      cacheStatus: 'miss',
      timings: {
        cacheMs: 0,
        artifactMs,
        headerMs,
        tileMs: 0,
        filterMs: 0,
        totalMs: elapsedMs(totalStarted),
        tileCount: 0,
        featureCount: 0,
      },
    };
  }

  const now = new Date().toISOString();
  const tileCoords: Array<{ x: number; y: number; tileIndex: number }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tileCoords.push({ x, y, tileIndex: tileCoords.length });
    }
  }

  const tileStarted = performance.now();
  const tileResults: Array<Array<{ tileIndex: number; featureIndex: number; parcel: CampaignParcelResponse }>> = [];
  let featureCount = 0;
  let filterMs = 0;

  await forEachWithConcurrency(tileCoords, PARCEL_TILE_FETCH_CONCURRENCY, async ({ x, y, tileIndex }) => {
    const tile = await archive.getZxy(range.z, x, y);
    if (!tile) return;

    const filterStarted = performance.now();
    const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
    const layer = vectorTile.layers[parcelTiles.sourceLayer];
    if (!layer) {
      filterMs += elapsedMs(filterStarted);
      return;
    }

    const parcels: Array<{ tileIndex: number; featureIndex: number; parcel: CampaignParcelResponse }> = [];
    for (let index = 0; index < layer.length; index += 1) {
      const vectorFeature = layer.feature(index);
      const feature = vectorFeature.toGeoJSON(x, y, range.z) as GeoJSON.Feature;
      if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;
      const normalizedFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
        ...feature,
        geometry: normalizeParcelGeometryLongitudes(feature.geometry, bbox),
      };
      if (!featureWithinParcelCampaignScope(normalizedFeature, bbox, boundary)) continue;
      if (options.residentialOnly === true) {
        if (!isResidentialParcelFeature(normalizedFeature)) continue;
      } else if (!isDisplayableParcelFeature(normalizedFeature)) {
        continue;
      }

      const externalId = getParcelFeatureExternalId(normalizedFeature, parcelTiles.promoteId);
      if (!externalId) continue;

      parcels.push({
        tileIndex,
        featureIndex: index,
        parcel: {
          id: externalId,
          campaign_id: campaignId,
          external_id: externalId,
          geom: JSON.stringify(normalizedFeature.geometry),
          properties: {
            ...((normalizedFeature.properties ?? {}) as Record<string, unknown>),
            parcel_id: externalId,
            source: 'bedrock_pmtiles',
          },
          created_at: now,
        },
      });
    }

    featureCount += layer.length;
    filterMs += elapsedMs(filterStarted);
    if (parcels.length > 0) tileResults.push(parcels);
  });

  const tileMs = elapsedMs(tileStarted);
  const byParcelId = new Map<string, CampaignParcelResponse>();
  tileResults
    .flat()
    .sort((a, b) => a.tileIndex - b.tileIndex || a.featureIndex - b.featureIndex)
    .forEach(({ parcel }) => {
      if (!byParcelId.has(parcel.external_id)) {
        byParcelId.set(parcel.external_id, parcel);
      }
    });

  return {
    parcels: Array.from(byParcelId.values()),
    cacheStatus: 'miss',
    timings: {
      cacheMs: 0,
      artifactMs,
      headerMs,
      tileMs,
      filterMs: Math.round(filterMs * 100) / 100,
      totalMs: elapsedMs(totalStarted),
      tileCount: tileCoords.length,
      featureCount,
    },
  };
}

export async function fetchScopedPmtilesParcels(
  campaignId: string,
  snapshot: CampaignSnapshotRow,
  parcelTiles: ParcelPmtilesResolution,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null,
  options: ScopedParcelOptions = {}
): Promise<ScopedParcelResult> {
  const cacheStarted = performance.now();
  const cacheKey = cacheKeyForScopedParcels({
    campaignId,
    snapshot,
    parcelTiles,
    bbox,
    boundary,
    residentialOnly: options.residentialOnly === true,
  });
  const cached = getCachedScopedParcels(cacheKey);
  if (cached) {
    return {
      ...cached,
      timings: {
        ...cached.timings,
        cacheMs: elapsedMs(cacheStarted),
        totalMs: elapsedMs(cacheStarted),
      },
    };
  }

  const existing = parcelResponseInflight.get(cacheKey);
  if (existing) {
    const result = await existing;
    return {
      ...result,
      cacheStatus: 'inflight',
      timings: {
        ...result.timings,
        cacheMs: elapsedMs(cacheStarted),
        totalMs: elapsedMs(cacheStarted),
      },
    };
  }

  const promise = extractScopedPmtilesParcels(campaignId, snapshot, parcelTiles, bbox, boundary, options)
    .then((result) => {
      setCachedScopedParcels(cacheKey, result);
      return result;
    })
    .finally(() => {
      parcelResponseInflight.delete(cacheKey);
    });

  parcelResponseInflight.set(cacheKey, promise);
  const result = await promise;
  return {
    ...result,
    timings: {
      ...result.timings,
      cacheMs: elapsedMs(cacheStarted),
    },
  };
}

export const scopedPmtilesParcelsTestHooks = {
  PARCEL_TILE_FETCH_CONCURRENCY,
  tileRangeForParcelBbox,
  getParcelFeatureExternalId,
  isDisplayableParcelFeature,
  isResidentialParcelFeature,
  featureWithinParcelCampaignScope,
  parcelTilesFromSnapshot,
};
