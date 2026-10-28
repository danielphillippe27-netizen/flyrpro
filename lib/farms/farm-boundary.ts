import { stormGeometrySchema } from '@/lib/storm-maps/intelligence/geometry';

/** Farms may store a GeoJSON polygon as JSONB or as a serialized JSON string. */
export function parseFarmBoundary(value: unknown): GeoJSON.Polygon | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  const result = stormGeometrySchema.safeParse(candidate);
  return result.success && result.data.type === 'Polygon' ? result.data : null;
}
