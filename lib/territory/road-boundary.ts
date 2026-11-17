import * as turf from '@turf/turf';
import type { Feature, Geometry, LineString, Polygon, Position } from 'geojson';

export const ROAD_SNAP_METERS = 15;
const meters = { units: 'meters' } as const;
const minimumEdgeMeters = 8;
const distance = (a: Position, b: Position) => turf.distance(a, b, meters);
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
  return turf.booleanValid(polygon) && turf.kinks(polygon).features.length === 0 && turf.area(polygon) > 1;
}

type Road = Feature<LineString>;
type Match = { road: Road; start: Position; end: Position; score: number };

function roadSlice(road: Road, start: Position, end: Position): Position[] {
  const from = turf.nearestPointOnLine(road, start, meters).properties;
  const to = turf.nearestPointOnLine(road, end, meters).properties;
  const reversed = from.location > to.location;
  const first = reversed ? to : from;
  const last = reversed ? from : to;
  const vertices = road.geometry.coordinates.slice(first.index + 1, last.index + 1);
  if (reversed) vertices.reverse();
  return [start, ...vertices.filter(point => !samePoint(point, start) && !samePoint(point, end)), end];
}

function withinEdge(path: Position[], edge: Road): boolean {
  return path.every(point => turf.pointToLineDistance(point, edge, meters) <= ROAD_SNAP_METERS + 1e-6);
}

function matchEdge(a: Position, b: Position, roads: Road[]): Match | null {
  const length = distance(a, b);
  if (length < minimumEdgeMeters) return null;
  const edge = turf.lineString([a, b]);
  const middle = turf.midpoint(a, b);
  const bearing = turf.bearing(a, b);
  const matches: Match[] = [];
  for (const road of roads) {
    const [west, south, east, north] = road.bbox!;
    if ([a, b].some(([x, y]) => x < west || x > east || y < south || y > north)) continue;
    const start = turf.nearestPointOnLine(road, a, meters).geometry.coordinates;
    const end = turf.nearestPointOnLine(road, b, meters).geometry.coordinates;
    const startDistance = distance(a, start);
    const endDistance = distance(b, end);
    if (Math.max(startDistance, endDistance) > ROAD_SNAP_METERS || distance(start, end) < length * 0.7) continue;
    const turn = Math.abs(turf.bearing(start, end) - bearing) % 360;
    if (Math.min(turn, 360 - turn) > 25) continue;
    const path = roadSlice(road, start, end);
    if (!withinEdge(path, edge) || turf.length(turf.lineString(path), meters) > length * 1.35) continue;
    const score = (startDistance + endDistance + 2 * turf.pointToLineDistance(middle, turf.lineString(path), meters)) / 4
      + Math.max(0, length - distance(start, end)) / 4;
    matches.push({ road, start, end, score });
  }
  matches.sort((first, second) => first.score - second.score);
  const best = matches[0];
  if (!best) return null;
  // Adjacent tiles can contain the same road. Treat coincident copies as one candidate.
  const ambiguous = matches.slice(1).some(other => other.score - best.score < 3 &&
    Math.max(distance(best.start, other.start), distance(best.end, other.end)) > 2);
  return ambiguous ? null : best;
}

function junction(before: Match, after: Match, vertex: Position): Position | null {
  if (distance(before.end, after.start) < 0.05) return before.end;
  const intersections = turf.lineIntersect(before.road, after.road).features
    .map(point => point.geometry.coordinates)
    .filter(point => distance(vertex, point) <= ROAD_SNAP_METERS)
    .sort((a, b) => distance(a, vertex) - distance(b, vertex));
  if (intersections.length > 1 && distance(intersections[0], intersections[1]) > 1 &&
    distance(vertex, intersections[1]) - distance(vertex, intersections[0]) < 3) return null;
  return intersections[0] ?? null;
}

function joinRoadFragments(features: Feature<Geometry>[]): Road[] {
  const endpoints = new Map<string, Set<Road>>();
  const segments: Road[] = [];
  const seen = new Set<string>();
  const key = (road: Road, point: Position) =>
    JSON.stringify([road.properties?.name ?? road.properties?.name_en, road.properties?.class, point]);
  for (const feature of features) {
    if (feature.geometry.type !== 'LineString' || feature.geometry.coordinates.length < 2) continue;
    const road = feature as Road;
    const coordinates = road.geometry.coordinates;
    const id = key(road, coordinates.flat());
    const reverseId = key(road, [...coordinates].reverse().flat());
    if (seen.has(id) || seen.has(reverseId)) continue;
    seen.add(id);
    segments.push(road);
    for (const point of [coordinates[0], coordinates[coordinates.length - 1]]) {
      const id = key(road, point);
      const touching = endpoints.get(id) ?? new Set<Road>();
      touching.add(road);
      endpoints.set(id, touching);
    }
  }

  const used = new Set<Road>();
  const roads: Road[] = [];
  for (const segment of segments) {
    if (used.has(segment)) continue;
    used.add(segment);
    const coordinates = [...segment.geometry.coordinates];
    for (const backwards of [false, true]) {
      if (backwards) coordinates.reverse();
      while (coordinates.length < 1_000) {
        const end = coordinates[coordinates.length - 1];
        const touching = endpoints.get(key(segment, end));
        if (touching?.size !== 2) break;
        const next = [...touching].find(road => !used.has(road));
        if (!next) break;
        used.add(next);
        const points = next.geometry.coordinates;
        const continuation = samePoint(end, points[0]) ? points : [...points].reverse();
        coordinates.push(...continuation.slice(1));
      }
    }
    // Keep fragments available in loops and where separate carriageways join the same junction.
    if (samePoint(coordinates[0], coordinates[coordinates.length - 1])) continue;
    if (coordinates.length > segment.geometry.coordinates.length) {
      roads.push(turf.lineString(coordinates, segment.properties ?? {}));
    }
  }
  return [...segments, ...roads];
}

export function previewRoadBoundary(polygon: Polygon, features: Feature<Geometry>[]): Polygon | null {
  const points = polygon.coordinates[0].slice(0, -1);
  const roads = joinRoadFragments(features).map(road => {
    const [west, south, east, north] = turf.bbox(road, { recompute: true });
    const latitudeMargin = (ROAD_SNAP_METERS + 1) / 110_000;
    const longitudeMargin = latitudeMargin / Math.cos(Math.max(Math.abs(south), Math.abs(north)) * Math.PI / 180);
    const bbox: GeoJSON.BBox = [west - longitudeMargin, south - latitudeMargin, east + longitudeMargin, north + latitudeMargin];
    return { ...road, bbox };
  });
  const matches = points.map((point, index) => matchEdge(point, points[(index + 1) % points.length], roads));
  const previous = (index: number) => (index + points.length - 1) % points.length;
  // If the shared corner cannot reach the junction, keep the closer road match.
  // An eligible edge should still snap even if its neighbor cannot meet it.
  for (const [index, point] of points.entries()) {
    const beforeIndex = previous(index);
    const before = matches[beforeIndex];
    const after = matches[index];
    if (before && after && !junction(before, after, point)) {
      matches[before.score <= after.score ? index : beforeIndex] = null;
    }
  }
  if (!matches.some(Boolean)) return null;

  const corners = points.map((point, index) => {
    const before = matches[previous(index)];
    const after = matches[index];
    if (before && after) return junction(before, after, point) ?? point;
    return after?.start ?? before?.end ?? point;
  });
  const ring: Position[] = [];
  for (const [index, start] of corners.entries()) {
    const next = (index + 1) % points.length;
    const end = corners[next];
    const match = matches[index];
    const path = match ? roadSlice(match.road, start, end) : [start, end];
    if (match && (distance(start, end) < minimumEdgeMeters / 2 ||
      !withinEdge(path, turf.lineString([points[index], points[next]])))) return null;
    for (const point of path.slice(0, -1)) {
      if (!ring.length || !samePoint(ring[ring.length - 1], point)) ring.push(point);
    }
  }
  if (ring.length < 3 || ring.length > 500) return null;
  if (samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return null;
  ring.push(ring[0]);
  const snapped: Polygon = { type: 'Polygon', coordinates: [ring] };
  return validBoundary(snapped) && !turf.booleanEqual(polygon, snapped) ? snapped : null;
}
