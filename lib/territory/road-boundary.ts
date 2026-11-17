import * as turf from '@turf/turf';
import type { Feature, Geometry, Polygon, Position } from 'geojson';

export const ROAD_SNAP_METERS = 50;
const meters = { units: 'meters' } as const;
const minimumMoveMeters = 0.05;
const samePoint = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

export function isCampaignBoundary(value: unknown): value is Polygon {
  const polygon = value as Polygon | null;
  if (polygon?.type !== 'Polygon' || !Array.isArray(polygon.coordinates) || polygon.coordinates.length !== 1) return false;
  const [ring] = polygon.coordinates;
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > 501) return false;
  if (!ring.every(point => Array.isArray(point) && point.length === 2 &&
    point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85)) return false;
  return samePoint(ring[0], ring[ring.length - 1]) && validBoundary(polygon);
}

function validBoundary(polygon: Polygon): boolean {
  const points = polygon.coordinates[0].slice(0, -1);
  return new Set(points.map(point => point.join(','))).size === points.length &&
    points.every((point, index) => turf.distance(point, points[(index + 1) % points.length], meters) >= minimumMoveMeters) &&
    turf.booleanValid(polygon) && turf.kinks(polygon).features.length === 0 && turf.area(polygon) > 1;
}

function closeBoundary(points: Position[]): Polygon {
  return { type: 'Polygon', coordinates: [[...points, points[0]]] };
}

export function snapRoadPoints(points: Position[], features: Feature<Geometry>[]): Position[] {
  const roads = features.flatMap(({ geometry }) =>
    geometry.type === 'LineString' && geometry.coordinates.length >= 2 ? [geometry.coordinates] : [],
  );
  if (!roads.length) return points;
  const network = turf.multiLineString(roads);
  return points.map(point => {
    const closest = turf.nearestPointOnLine(network, point, meters);
    return closest.properties.dist <= ROAD_SNAP_METERS ? closest.geometry.coordinates : point;
  });
}

export function previewRoadBoundary(polygon: Polygon, features: Feature<Geometry>[]): Polygon | null {
  const roads = features.flatMap(({ geometry }) =>
    geometry.type === 'LineString' && geometry.coordinates.length >= 2 ? [geometry.coordinates] : [],
  );
  if (!roads.length) return null;

  const network = turf.multiLineString(roads);
  const original = polygon.coordinates[0].slice(0, -1);
  const matches = original.flatMap((point, index) => {
    const closest = turf.nearestPointOnLine(network, point, meters);
    const distance = closest.properties.dist;
    if (distance < minimumMoveMeters || distance > ROAD_SNAP_METERS) return [];
    return [{ index, distance, point: closest.geometry.coordinates }];
  });
  if (!matches.length) return null;

  const points = [...original];
  for (const match of matches) points[match.index] = match.point;
  const snapped = closeBoundary(points);
  if (validBoundary(snapped)) return snapped;

  // Favor the nearest moves if a group of projections would collapse or cross the boundary.
  const partial = [...original];
  for (const match of matches.sort((a, b) => a.distance - b.distance)) {
    partial[match.index] = match.point;
    if (!validBoundary(closeBoundary(partial))) partial[match.index] = original[match.index];
  }
  return partial.some((point, index) => !samePoint(point, original[index])) ? closeBoundary(partial) : null;
}
