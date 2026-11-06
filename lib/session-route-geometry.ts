/** Match iOS's LineString foreign member while preserving the existing API shape. */
export type SessionRoutePoint = {
  latitude: number;
  longitude: number;
  startsNewSegment?: boolean;
};

export function sessionRouteGeoJson(path: SessionRoutePoint[] | undefined): string | null {
  const coordinates: number[][] = [];
  const segmentBreakIndices: number[] = [];
  let gap = false;
  for (const point of path ?? []) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
        Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) {
      gap = true;
      continue;
    }
    if (coordinates.length > 0 && (gap || point.startsNewSegment === true)) {
      segmentBreakIndices.push(coordinates.length);
    }
    coordinates.push([point.longitude, point.latitude]);
    gap = false;
  }
  if (coordinates.length < 2) return null;
  return JSON.stringify({ type: 'LineString', coordinates, segmentBreakIndices });
}
