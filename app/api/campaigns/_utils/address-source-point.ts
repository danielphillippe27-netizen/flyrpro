/** Prefer exact source coordinates when present. MVT geometry is quantized and
 * can move an address across a campaign boundary, particularly at low zooms. */
export function addressSourcePoint(
  properties: Record<string, unknown> | null | undefined,
  fallback: [number, number]
): [number, number] {
  const lon = properties?.longitude;
  const lat = properties?.latitude;
  if (typeof lon === 'number' && typeof lat === 'number' &&
      Number.isFinite(lon) && Number.isFinite(lat) &&
      lon >= -180 && lon <= 180 && lat >= -85.05112878 && lat <= 85.05112878) {
    return [lon, lat];
  }
  return fallback;
}
