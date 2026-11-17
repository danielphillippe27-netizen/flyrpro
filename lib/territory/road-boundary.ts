import * as turf from '@turf/turf';
import type { Feature, Geometry, LineString, Polygon, Position } from 'geojson';

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

const INTERSECTION_SNAP_METERS = 20;

function intersectionArms(point: Position, roads: Feature<LineString>[]): number[] {
  const bearings: number[] = [];
  for (const road of roads) {
    const nearest = turf.nearestPointOnLine(road, point, meters);
    if (nearest.properties.dist > 0.5) continue;
    const location = nearest.properties.location;
    const length = turf.length(road, meters);
    for (const offset of [-3, 3]) {
      const along = Math.max(0, Math.min(length, location + offset));
      if (Math.abs(along - location) < 1) continue;
      const direction = turf.bearing(point, turf.along(road, along, meters));
      if (!bearings.some(existing => Math.abs(((direction - existing + 540) % 360) - 180) < 20)) {
        bearings.push(direction);
      }
    }
  }
  return bearings;
}

function preferredIntersection(
  point: Position,
  closestRoad: Feature<LineString>,
  roads: Feature<LineString>[],
): Position | undefined {
  const groundRoads = roads.filter(road => {
    const structure = road.properties?.structure ?? road.properties?.brunnel;
    return structure !== 'bridge' && structure !== 'tunnel' &&
      turf.pointToLineDistance(point, road, meters) <= INTERSECTION_SNAP_METERS;
  });
  if (!groundRoads.includes(closestRoad)) return undefined;
  const candidates = groundRoads.flatMap(road => {
    if (road === closestRoad) return [];
    return turf.lineIntersect(closestRoad, road).features.map(feature => feature.geometry.coordinates);
  }).filter(candidate => turf.distance(point, candidate, meters) <= INTERSECTION_SNAP_METERS);
  candidates.sort((a, b) => turf.distance(point, a, meters) - turf.distance(point, b, meters));
  return candidates.find(candidate => intersectionArms(candidate, groundRoads).length >= 3);
}

export function snapRoadPoints(points: Position[], features: Feature<Geometry>[]): Position[] {
  const roads = features.filter((feature): feature is Feature<LineString> =>
    feature.geometry.type === 'LineString' && feature.geometry.coordinates.length >= 2,
  );
  if (!roads.length) return points;
  return points.map(point => {
    const matches = roads.map(road => ({ road, closest: turf.nearestPointOnLine(road, point, meters) }));
    matches.sort((a, b) => a.closest.properties.dist - b.closest.properties.dist);
    const { road, closest } = matches[0];
    if (closest.properties.dist > ROAD_SNAP_METERS) return point;
    return preferredIntersection(point, road, roads) ?? closest.geometry.coordinates;
  });
}

export function previewRoadBoundary(polygon: Polygon, features: Feature<Geometry>[]): Polygon | null {
  const original = polygon.coordinates[0].slice(0, -1);
  const projected = snapRoadPoints(original, features);
  const matches = original.flatMap((point, index) => {
    const distance = turf.distance(point, projected[index], meters);
    if (distance < minimumMoveMeters) return [];
    return [{ index, distance, point: projected[index] }];
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
