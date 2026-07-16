'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { getMapboxToken } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, getResolvedMapInitOptions, hideBaseBuildingLayers, resolveMapStyle } from '@/lib/map-styles';

type OvertureBuildingFeature = {
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    id: string;
    centroid?: [number, number];
    height?: number;
    levels?: number;
  };
};

type OvertureBuildingResponse = {
  features?: OvertureBuildingFeature[];
};

/**
 * OvertureMap Component
 * 
 * Visualizes Overture building data using fill-extrusion layers on a Mapbox map.
 * Fetches building data from /api/overture/buildings and renders using Mapbox fill-extrusion.
 */
export function OvertureMap() {
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v12'),
    [mapPreset, theme],
  );
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
    let cancelled = false;

    // Initialize Mapbox
    const token = getMapboxToken();
    
    if (!token || !token.startsWith(String.fromCharCode(112, 107) + '.')) {
      setError('Invalid Mapbox access token');
      return;
    }

    mapboxgl.accessToken = token;

    if (typeof window !== 'undefined') {
      mapboxgl.workerCount = 2;
    }

    const initMap = async () => {
      const mapInitOptions = await getResolvedMapInitOptions(resolvedMapStyle);
      if (cancelled || !mapContainer.current || map.current) return;

      const mapInstance = new mapboxgl.Map({
        container: mapContainer.current,
        ...mapInitOptions,
        center: [-78.688, 43.914], // Bowmanville, ON
        zoom: 15.5,
        pitch: 45,
        bearing: 0,
      });
      map.current = mapInstance;

      mapInstance.on('load', () => {
        setMapLoaded(true);
        
        // Hide standard building extrusion layers to prevent z-fighting
        try {
          const style = mapInstance.getStyle();
          if (style && style.layers) {
            applyPresetVisualTweaks(mapInstance, resolvedMapStyle, {
              preserveLayerPrefixes: ['overture-'],
            });
            hideBaseBuildingLayers(mapInstance);
          }
        } catch (err) {
          console.warn('Error hiding building layers:', err);
        }

        // Fetch and render building data
        loadBuildings();
      });

      // Handle errors
      mapInstance.on('error', (e) => {
        console.error('Mapbox error:', e);
        setError('Failed to load map');
      });
    };

    void initMap();

    // Cleanup
    return () => {
      cancelled = true;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [resolvedMapStyle]);

  // Sync map style with the selected map preset.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const mapInstance = map.current;
    try {
      applyResolvedMapStyle(mapInstance, resolvedMapStyle);
      mapInstance.once('style.load', () => {
        try {
          const style = mapInstance.getStyle();
          if (style?.layers) {
            applyPresetVisualTweaks(mapInstance, resolvedMapStyle, {
              preserveLayerPrefixes: ['overture-'],
            });
            hideBaseBuildingLayers(mapInstance);
          }
        } catch {}
        loadBuildings();
      });
    } catch (err) {
      console.error('Error setting map style:', err);
    }
  }, [mapLoaded, resolvedMapStyle]);

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

      const data = (await response.json()) as OvertureBuildingResponse;
      console.log('Received building data:', data);
      console.log('Number of features:', data.features?.length || 0);

      if (!data.features || data.features.length === 0) {
        console.warn('No buildings found in the specified bbox');
        setLoading(false);
        return;
      }

      // Transform features to fill-extrusion format
      // Convert Point centroids to simple square Polygons for extrusion
      const extrusionFeatures: GeoJSON.Feature[] = data.features.map((feature) => {
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
              layout: {
                'fill-extrusion-edge-radius': 0.6,
              },
              paint: {
                'fill-extrusion-color': '#6b7280', // Gray
                'fill-extrusion-opacity': 0.9,
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-vertical-gradient': true,
                'fill-extrusion-rounded-roof': true,
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
