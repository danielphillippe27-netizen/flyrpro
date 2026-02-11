'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { useTheme } from '@/lib/theme-provider';

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

/**
 * OvertureMap Component
 * 
 * Visualizes Overture building data using fill-extrusion layers on a Mapbox map.
 * Fetches building data from /api/overture/buildings and renders using Mapbox fill-extrusion.
 */
export function OvertureMap() {
  const { theme } = useTheme();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
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

    if (typeof window !== 'undefined') {
      mapboxgl.workerCount = 2;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[theme] ?? MAP_STYLES.light,
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

  // Sync map style with app theme (light/dark)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const styleUrl = MAP_STYLES[theme] ?? MAP_STYLES.light;
    try {
      map.current.setStyle(styleUrl);
      map.current.once('style.load', () => {
        try {
          const style = map.current?.getStyle();
          if (style?.layers) {
            style.layers.forEach((layer) => {
              if (layer.id.toLowerCase().includes('building')) {
                map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
              }
            });
          }
        } catch {}
        loadBuildings();
      });
    } catch (err) {
      console.error('Error setting map style:', err);
    }
  }, [theme, mapLoaded]);

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

      // Transform features to fill-extrusion format
      // Convert Point centroids to simple square Polygons for extrusion
      const extrusionFeatures: GeoJSON.Feature[] = data.features.map((feature: any) => {
        const centroid = feature.properties.centroid || feature.geometry.coordinates; // [lng, lat]
        const height = feature.properties.height || feature.properties.levels 
          ? (feature.properties.levels || 2) * 3 
          : 10; // Default 10m or levels * 3m
        
        // Create a small square polygon around the centroid (approximately 10m x 10m)
        const size = 0.00005; // ~5.5 meters
        const polygon: GeoJSON.Polygon = {
          type: 'Polygon',
          coordinates: [[
            [centroid[0] - size, centroid[1] - size],
            [centroid[0] + size, centroid[1] - size],
            [centroid[0] + size, centroid[1] + size],
            [centroid[0] - size, centroid[1] + size],
            [centroid[0] - size, centroid[1] - size],
          ]],
        };
        
        return {
          type: 'Feature',
          geometry: polygon,
          properties: {
            id: feature.properties.id,
            height: height,
            min_height: 0,
            gers_id: feature.properties.id,
            status: 'default',
          },
        };
      });

      const featureCollection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: extrusionFeatures,
      };

      console.log(`Transformed ${extrusionFeatures.length} buildings to fill-extrusion features`);

      // Add source and layer to map
      const addLayer = () => {
        try {
          if (!map.current) return;
          
          const sourceId = 'overture-buildings-source';
          const layerId = 'overture-buildings-extrusion';
          
          // Add or update source
          if (map.current.getSource(sourceId)) {
            (map.current.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(featureCollection);
          } else {
            map.current.addSource(sourceId, {
              type: 'geojson',
              data: featureCollection,
            });
          }
          
          // Add fill-extrusion layer if it doesn't exist
          if (!map.current.getLayer(layerId)) {
            map.current.addLayer({
              id: layerId,
              type: 'fill-extrusion',
              source: sourceId,
              minzoom: 13,
              filter: ['==', '$type', 'Polygon'],
              paint: {
                'fill-extrusion-color': '#6b7280', // Gray
                'fill-extrusion-opacity': 0.9,
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-vertical-gradient': true,
              },
            });
          }
          
          console.log('✅ Fill-extrusion layer added successfully');
          setLoading(false);
        } catch (err) {
          console.error('❌ Error adding fill-extrusion layer:', err);
          setError('Failed to render buildings');
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
      <MapInfoButton show={mapLoaded && !error} />

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
