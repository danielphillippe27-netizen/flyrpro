import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * Centralized Mapbox token access for client components.
 * Use this instead of reading process.env.NEXT_PUBLIC_MAPBOX_TOKEN directly.
 */
export function getMapboxToken(): string {
  return process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
}

export function removeMapboxMapWhenSafe(map: MapboxMap): void {
  const remove = () => {
    try {
      map.remove();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Mapbox remove skipped during teardown:', error);
      }
    }
  };

  try {
    if (map.loaded() || map.isStyleLoaded()) {
      remove();
      return;
    }

    const timeoutId = window.setTimeout(remove, 1500);
    map.once('load', () => {
      window.clearTimeout(timeoutId);
      remove();
    });
  } catch {
    remove();
  }
}
