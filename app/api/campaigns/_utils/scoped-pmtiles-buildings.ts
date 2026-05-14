import { VectorTile } from '@mapbox/vector-tile';
import * as turf from '@turf/turf';
import Pbf from 'pbf';
import { getCachedPmtilesArchive } from '@/app/api/campaigns/_utils/tile-cache';
import {
  type CampaignSnapshotRow,
  resolveArtifactUrl,
  resolvePmtilesKey,
} from '@/lib/diamond/geometry';

export type ScopedBuildingFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
};

type PolygonalBuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  Record<string, unknown>
>;

const TILE_RANGE_PADDING = 1;
const TILE_FETCH_CONCURRENCY = 12;
const SCOPED_TILE_LIMIT = Math.max(
  64,
  Number.isFinite(Number(process.env.PMTILES_SCOPED_TILE_LIMIT))
    ? Number(process.env.PMTILES_SCOPED_TILE_LIMIT)
    : 2048
);
const WEB_MERCATOR_MAX_LAT = 85.05112878;

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
    if (tileCount <= SCOPED_TILE_LIMIT || z === 12) {
      const maxTile = 2 ** z - 1;
      return {
        z,
        minX: Math.max(0, minX - TILE_RANGE_PADDING),
        maxX: Math.min(maxTile, maxX + TILE_RANGE_PADDING),
        minY: Math.max(0, minY - TILE_RANGE_PADDING),
        maxY: Math.min(maxTile, maxY + TILE_RANGE_PADDING),
      };
    }
  }
  return null;
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

function featureInCampaignBoundary(feature: GeoJSON.Feature, boundary: GeoJSON.Polygon): boolean {
  try {
    return turf.booleanIntersects(
      feature as GeoJSON.Feature<GeoJSON.Geometry>,
      turf.feature(boundary)
    );
  } catch {
    // Fall back to cheap checks if a malformed municipal feature cannot be
    // evaluated by Turf.
  }

  const center = geometryCenter(feature.geometry);
  if (center && pointInPolygon(center, boundary)) return true;
  return flattenPositions(feature.geometry).some((position) => pointInPolygon(position, boundary));
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
    console.warn('[ScopedPMTilesBuildings] Failed to merge clipped building tile fragments:', {
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

export async function fetchScopedPmtilesBuildingFeatures(
  snapshot: CampaignSnapshotRow,
  bbox: [number, number, number, number],
  hiddenBuildingIds: Set<string> = new Set(),
  boundary: GeoJSON.Polygon | null = null
): Promise<ScopedBuildingFeatureCollection | null> {
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

  const byBuildingId = new Map<string, PolygonalBuildingFeature[]>();
  const tileCoords: Array<{ x: number; y: number }> = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tileCoords.push({ x, y });
    }
  }

  await forEachWithConcurrency(tileCoords, TILE_FETCH_CONCURRENCY, async ({ x, y }) => {
    const tile = await archive.getZxy(range.z, x, y);
    if (!tile) return;

    const vectorTile = new VectorTile(new Pbf(Buffer.from(tile.data)));
    const layer = vectorTile.layers[sourceLayer] ?? vectorTile.layers.buildings;
    if (!layer) return;

    for (let index = 0; index < layer.length; index += 1) {
      const vectorFeature = layer.feature(index);
      const feature = vectorFeature.toGeoJSON(x, y, range.z) as GeoJSON.Feature;
      if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;

      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const buildingId = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
      if (!buildingId || hiddenBuildingIds.has(buildingId)) continue;

      if (!geometryIntersectsBbox(feature.geometry, bbox)) continue;
      if (boundary && !featureInCampaignBoundary(feature, boundary)) continue;

      const normalizedFeature: PolygonalBuildingFeature = {
        ...feature,
        id: buildingId,
        geometry: feature.geometry,
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
  if (features.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features,
  };
}
