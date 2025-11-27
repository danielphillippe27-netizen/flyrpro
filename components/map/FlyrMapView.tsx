'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapModeToggle } from './MapModeToggle';
import { BuildingLayers } from './BuildingLayers';
import { MapControls } from './MapControls';

type MapMode = 'light' | 'dark' | 'satellite' | 'campaign_3d';

export function FlyrMapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('light');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize map immediately
    const initMap = () => {
      if (!mapContainer.current) return;
      
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
        
        mapboxgl.accessToken = token;

        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
          center: [-79.3832, 43.6532], // Toronto default
          zoom: 12,
          pitch: 0,
          bearing: 0,
        });

        map.current.on('load', () => {
          setMapLoaded(true);
          
          // Hide building layers after initial style loads (matching iOS app behavior)
          const style = map.current?.getStyle();
          if (style && style.layers) {
            style.layers.forEach((layer) => {
              // Hide layers that contain "building" in their id
              if (layer.id.toLowerCase().includes('building')) {
                map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
              }
            });
          }
          
          // Resize after load to ensure proper rendering
          setTimeout(() => {
            map.current?.resize();
          }, 50);
        });

        map.current.on('error', (e) => {
          console.error('Mapbox error:', e);
          setError('Failed to load map');
        });
      } catch (err) {
        console.error('Map initialization error:', err);
        setError('Failed to initialize map');
      }
    };

    // Use requestAnimationFrame to ensure DOM is ready
    const rafId = requestAnimationFrame(() => {
      initMap();
    });

    return () => {
      cancelAnimationFrame(rafId);
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const styleMap: Record<MapMode, string> = {
      light: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
      dark: 'mapbox://styles/flyrpro/cmie0fu21003001qt912a9r5s', // Dark 3D Style
      satellite: 'mapbox://styles/mapbox/satellite-v9',
      campaign_3d: 'mapbox://styles/flyrpro/cmicjnhhu00ag01qm106bbyt7', // Custom 3D (v10, no buildings)
    };

    map.current.setStyle(styleMap[mapMode]);

    // Hide building layers after style loads (matching iOS app behavior)
    const hideBuildingLayers = () => {
      if (!map.current) return;
      
      const style = map.current.getStyle();
      if (style && style.layers) {
        style.layers.forEach((layer) => {
          // Hide layers that contain "building" in their id
          if (layer.id.toLowerCase().includes('building')) {
            map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
          }
        });
      }
    };

    if (mapMode === 'campaign_3d') {
      map.current.once('style.load', () => {
        if (map.current) {
          map.current.setPitch(60);
          map.current.setBearing(-17.6);
          hideBuildingLayers();
        }
      });
    } else {
      map.current.once('style.load', () => {
        hideBuildingLayers();
      });
      if (map.current) {
        map.current.setPitch(0);
        map.current.setBearing(0);
      }
    }
  }, [mapMode, mapLoaded]);


  return (
    <div className="relative h-full w-full">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10">
          <div className="text-center">
            <p className="text-red-600 font-semibold">Map Error</p>
            <p className="text-red-500 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}
      {!mapLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 dark:border-red-500 mx-auto mb-2"></div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Loading map...</p>
          </div>
        </div>
      )}
      <div ref={mapContainer} className="h-full w-full min-h-[400px]" />
      {mapLoaded && map.current && !error && (
        <>
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            <MapModeToggle mode={mapMode} onModeChange={setMapMode} />
            <MapControls />
          </div>
          <BuildingLayers map={map.current} />
        </>
      )}
    </div>
  );
}

