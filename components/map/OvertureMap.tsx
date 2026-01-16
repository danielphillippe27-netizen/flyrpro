'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ThreeHouseLayer } from './ThreeHouseLayer';
import type { BuildingModelPoint } from '@/lib/services/MapService';
import { LoadingSpinner } from '@/components/LoadingSpinner';

/**
 * OvertureMap Component
 * 
 * Visualizes Overture building data using 3D GLB models on a Mapbox map.
 * Fetches building data from /api/overture/buildings and renders using Three.js.
 */
export function OvertureMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const threeLayerRef = useRef<ThreeHouseLayer | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default Bowmanville bbox
  const DEFAULT_BBOX = {
    minx: -78.700,
    miny: 43.900,
    maxx: -78.670,
    maxy: 43.920,
  };

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize Mapbox
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
    
    if (!token || !token.startsWith('pk.')) {
      setError('Invalid Mapbox access token');
      return;
    }

    mapboxgl.accessToken = token;

    // Set worker URL to fix potential worker loading issues
    if (typeof window !== 'undefined') {
      mapboxgl.workerCount = 2;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-78.688, 43.914], // Bowmanville, ON
      zoom: 15.5,
      pitch: 45,
      bearing: 0,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
      
      // Hide standard building extrusion layers to prevent z-fighting
      try {
        const style = map.current?.getStyle();
        if (style && style.layers) {
          style.layers.forEach((layer) => {
            if (layer.id.toLowerCase().includes('building')) {
              map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
            }
          });
        }
      } catch (err) {
        console.warn('Error hiding building layers:', err);
      }

      // Fetch and render building data
      loadBuildings();
    });

    // Handle errors
    map.current.on('error', (e) => {
      console.error('Mapbox error:', e);
      setError('Failed to load map');
    });

    // Cleanup
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  const loadBuildings = async () => {
    if (!map.current) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch building data from API
      const url = `/api/overture/buildings?minx=${DEFAULT_BBOX.minx}&miny=${DEFAULT_BBOX.miny}&maxx=${DEFAULT_BBOX.maxx}&maxy=${DEFAULT_BBOX.maxy}`;
      console.log('Fetching building data from:', url);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Received building data:', data);
      console.log('Number of features:', data.features?.length || 0);

      if (!data.features || data.features.length === 0) {
        console.warn('No buildings found in the specified bbox');
        setLoading(false);
        return;
      }

      // Verify centroid in properties
      if (data.features[0]?.properties?.centroid) {
        console.log('✅ Centroid found in properties:', data.features[0].properties.centroid);
      } else {
        console.warn('⚠️ Centroid not found in properties');
      }

      // Transform GeoJSON features to BuildingModelPoint[] format
      const modelPoints: BuildingModelPoint[] = data.features.map((feature: any) => {
        const centroid = feature.properties.centroid; // [lng, lat]
        
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: centroid, // [lng, lat]
          },
          properties: {
            'model-id': feature.properties.id || `building-${Math.random()}`,
            'front_bearing': 0, // Default bearing
            'house_bearing': 0, // Default bearing
            'gers_id': feature.properties.id,
            'height_m': feature.properties.height || null,
            'latest_status': 'default',
          },
        };
      });

      console.log(`Transformed ${modelPoints.length} buildings to model points`);

      // Create ThreeHouseLayer with GLB model
      const threeLayer = new ThreeHouseLayer({
        glbUrl: '/House 2026.glb',
        features: modelPoints,
        onModelLoad: () => {
          console.log('✅ 3D GLB models loaded successfully');
          setLoading(false);
        },
      });

      // Add layer to map
      const addLayer = () => {
        try {
          if (!map.current) return;
          
          console.log('Adding Three.js layer to map...');
          map.current.addLayer(threeLayer as any);
          threeLayerRef.current = threeLayer;
          console.log('✅ Three.js layer added successfully');
        } catch (err) {
          console.error('❌ Error adding Three.js layer:', err);
          setError('Failed to render 3D models');
          setLoading(false);
        }
      };

      if (map.current.loaded()) {
        addLayer();
      } else {
        map.current.once('style.load', addLayer);
      }
    } catch (err) {
      console.error('Error loading buildings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load building data');
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <LoadingSpinner />
            <p className="mt-2 text-sm text-gray-600">Loading buildings...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-500 text-white p-4 rounded-lg shadow-lg z-10">
          <p className="font-semibold">Error</p>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => {
              setError(null);
              if (mapLoaded) loadBuildings();
            }}
            className="mt-2 px-3 py-1 bg-white text-red-500 rounded text-sm font-medium hover:bg-gray-100"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
