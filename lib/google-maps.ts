/**
 * Dedicated Google Maps key access for the web Standard Canvassing Mode path.
 * Keep this separate from Mapbox and from the iOS Google Maps configuration.
 */
export function getStandardModeGoogleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_STANDARD_MODE_API_KEY ?? '';
}

export function isStandardModeGoogleMapsConfigured(): boolean {
  return getStandardModeGoogleMapsApiKey().trim().length > 0;
}
