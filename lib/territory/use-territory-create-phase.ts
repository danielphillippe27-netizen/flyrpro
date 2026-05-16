'use client';

import { useCallback, useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import type MapboxDraw from '@mapbox/mapbox-gl-draw';

export type TerritoryCreatePhase = 'idle' | 'drawing' | 'naming';

export function useTerritoryCreatePhase({
  map,
  mapLoaded,
}: {
  map: React.RefObject<mapboxgl.Map | null>;
  mapLoaded: boolean;
}) {
  const [phase, setPhase] = useState<TerritoryCreatePhase>('idle');

  const startCreating = useCallback(() => {
    setPhase('drawing');
  }, []);

  const resetToIdle = useCallback(() => {
    setPhase('idle');
  }, []);

  const enterNaming = useCallback(() => {
    setPhase('naming');
  }, []);

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    const handleDrawCreate = () => {
      setPhase((current) => (current === 'drawing' ? 'naming' : current));
    };

    mapInstance.on('draw.create', handleDrawCreate);
    return () => {
      mapInstance.off('draw.create', handleDrawCreate);
    };
  }, [map, mapLoaded]);

  return {
    phase,
    setPhase,
    startCreating,
    resetToIdle,
    enterNaming,
  };
}

export function applyDrawModeForPhase(
  draw: MapboxDraw | null | undefined,
  phase: TerritoryCreatePhase,
  hasSavedFeatures: boolean
) {
  if (!draw) return;

  if (phase === 'idle') {
    if (!hasSavedFeatures) {
      draw.deleteAll();
    }
    draw.changeMode('simple_select');
    return;
  }

  if (phase === 'drawing') {
    if (!hasSavedFeatures) {
      draw.changeMode('draw_polygon');
    }
    return;
  }

  draw.changeMode('simple_select');
}

export function clearTerritoryDrawing(
  draw: MapboxDraw | null | undefined,
  phase: TerritoryCreatePhase
): TerritoryCreatePhase {
  draw?.deleteAll();
  if (phase === 'naming') {
    draw?.changeMode('draw_polygon');
    return 'drawing';
  }
  if (phase === 'drawing') {
    draw?.changeMode('draw_polygon');
  }
  return phase;
}
