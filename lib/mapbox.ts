/**
 * Centralized Mapbox token access for client components.
 * Use this instead of reading process.env.NEXT_PUBLIC_MAPBOX_TOKEN directly.
 */
export function getMapboxToken(): string {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
}
