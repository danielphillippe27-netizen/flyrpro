import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

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

let configuredKey: string | null = null;

export async function loadGoogleMapsLibrary<T extends 'core' | 'maps'>(library: T) {
  const apiKey = getStandardModeGoogleMapsApiKey().trim();
  if (!apiKey) {
    throw new Error('Google Maps standard-mode API key is not configured');
  }
  if (configuredKey && configuredKey !== apiKey) {
    throw new Error('Google Maps was already configured with a different API key');
  }
  if (!configuredKey) {
    setOptions({ key: apiKey, v: 'weekly' });
    configuredKey = apiKey;
  }
  return importLibrary(library);
}
