import { VectorTile } from '@mapbox/vector-tile';
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

function featureInCampaignBoundary(feature: GeoJSON.Feature, boundary: GeoJSON.Polygon): boolean {
  const center = geometryCenter(feature.geometry);
  if (center && pointInPolygon(center, boundary)) return true;
  return flattenPositions(feature.geometry).some((position) => pointInPolygon(position, boundary));
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

  const byBuildingId = new Map<string, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>();
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
        if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue;

        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        const buildingId = String(properties.building_id ?? properties.gers_id ?? properties.id ?? '').trim();
        if (!buildingId || hiddenBuildingIds.has(buildingId) || byBuildingId.has(buildingId)) continue;

        if (!geometryIntersectsBbox(feature.geometry, bbox)) continue;
        if (boundary && !featureInCampaignBoundary(feature, boundary)) continue;

        byBuildingId.set(buildingId, {
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
