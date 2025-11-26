'use client';

import { useEffect } from 'react';
import type { Map } from 'mapbox-gl';
import { MapService } from '@/lib/services/MapService';

export function BuildingLayers({ map }: { map: Map }) {
  useEffect(() => {
    // This will be populated when we have campaign addresses
    // For now, just set up the structure
    const loadBuildings = async () => {
      // Example: Load building polygons for a campaign
      // const polygons = await MapService.fetchBuildingPolygons(addressIds);
      // Render them on the map
    };

    loadBuildings();
  }, [map]);

  return null;
}

