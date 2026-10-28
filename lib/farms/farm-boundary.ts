import { stormGeometrySchema } from '@/lib/storm-maps/intelligence/geometry';

/** Farms may store a GeoJSON polygon as JSONB or as a serialized JSON string. */
export function parseFarmBoundary(value: unknown): GeoJSON.Polygon | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (candidate && typeof candidate === 'object' && 'type' in candidate && 'coordinates' in candidate) {
    const geometry = candidate as { type: unknown; coordinates: unknown; crs?: { properties?: { name?: unknown } } };
    if (geometry.crs && geometry.crs.properties?.name !== 'EPSG:4326') return null;
    candidate = { type: geometry.type, coordinates: geometry.coordinates };
  }
  const result = stormGeometrySchema.safeParse(candidate);
  return result.success && result.data.type === 'Polygon' ? result.data : null;
}
