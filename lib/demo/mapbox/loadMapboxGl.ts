'use client';

import { getMapboxToken } from '@/lib/mapbox';

type MapboxGlModule = typeof import('mapbox-gl');

let cachedMapboxGl: MapboxGlModule | null = null;
let loadingMapboxGl: Promise<MapboxGlModule> | null = null;

export async function getMapboxGl(): Promise<MapboxGlModule> {
  if (cachedMapboxGl) {
    return cachedMapboxGl;
  }

  if (!loadingMapboxGl) {
    loadingMapboxGl = import('mapbox-gl').then((module) => {
      const mapboxgl = module.default ?? module;
      mapboxgl.accessToken = getMapboxToken();
      cachedMapboxGl = module;
      return module;
    });
  }

  return loadingMapboxGl;
}
