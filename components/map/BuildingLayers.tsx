'use client';

import { useEffect, useRef } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { MapService, type BuildingModelPoint } from '@/lib/services/MapService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { BuildingService } from '@/lib/services/BuildingService';
import { ThreeHouseLayer } from './ThreeHouseLayer';
import { createClient } from '@/lib/supabase/client';
import type { Building as BuildingType } from '@/types/database';

export type RenderingMode = '3d' | '2d';

// Helper: Calculate the Top-Left and Bottom-Right of all your data
function getBoundingBox(features: GeoJSON.Feature[]): [[number, number], [number, number]] | null {
  if (!features || features.length === 0) return null;

  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;

  features.forEach(f => {
    // Handle both Points (pins) and Polygons (buildings)
    let coords: number[] | number[][] = [];
    
    if (f.geometry.type === 'Polygon') {
      // For Polygon, get all coordinates from the first ring
      const ring = f.geometry.coordinates[0];
      ring.forEach((coord: number[]) => {
        const [lng, lat] = coord;
        if (typeof lng === 'number' && typeof lat === 'number' && !isNaN(lng) && !isNaN(lat)) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      });
    } else if (f.geometry.type === 'Point') {
      // For Point, coordinates are [lng, lat]
      const [lng, lat] = f.geometry.coordinates;
      if (typeof lng === 'number' && typeof lat === 'number' && !isNaN(lng) && !isNaN(lat)) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  });

  // Check if we found any valid coordinates
  if (minLng === 180 || minLat === 90 || maxLng === -180 || maxLat === -90) {
    return null;
  }

  return [
    [minLng, minLat], // Southwest corner
    [maxLng, maxLat]  // Northeast corner
  ];
}

interface BuildingLayersProps {
  map: Map;
  campaignId?: string | null;
  mode?: RenderingMode; // '3d' for GLB models, '2d' for extruded polygons
  onLayerReady?: (layer: ThreeHouseLayer | null) => void;
  onMarkerClick?: (addressId: string) => void; // Legacy: address-based callback
  onBuildingClick?: (buildingId: string) => void; // Gold Standard: building UUID callback
}

export function BuildingLayers({ map, campaignId, mode = '3d', onLayerReady, onMarkerClick, onBuildingClick }: BuildingLayersProps) {
  const threeLayerRef = useRef<ThreeHouseLayer | null>(null);
  const fallbackLayerRef = useRef<string | null>(null);
  const extrusionLayerRef = useRef<string | null>(null);
  const webglSupportedRef = useRef<boolean | null>(null);

  // Check WebGL support
  useEffect(() => {
    if (webglSupportedRef.current === null) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        webglSupportedRef.current = !!gl;
      } catch (e) {
        webglSupportedRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!map) return;

    const loadCampaignBuildings = async () => {
      try {
        if (!campaignId) {
          // Remove layers when campaign is deselected
          if (threeLayerRef.current) {
            try {
              if (map.getLayer('flyr-campaign-buildings-model-layer')) {
                map.removeLayer('flyr-campaign-buildings-model-layer');
              }
            } catch (err) {
              console.warn('Error removing Three.js layer:', err);
            }
            threeLayerRef.current = null;
          }

          if (fallbackLayerRef.current) {
            try {
              if (map.getLayer('building-models-fallback')) {
                map.removeLayer('building-models-fallback');
              }
              if (map.getSource(fallbackLayerRef.current)) {
                map.removeSource(fallbackLayerRef.current);
              }
            } catch (err) {
              console.warn('Error removing fallback layer:', err);
            }
            fallbackLayerRef.current = null;
          }

          // Remove 2D extrusion layer
          if (extrusionLayerRef.current) {
            try {
              if (map.getLayer('flyr-campaign-buildings-extrusion')) {
                map.removeLayer('flyr-campaign-buildings-extrusion');
              }
              if (map.getLayer('address-pins')) {
                map.removeLayer('address-pins');
              }
              if (map.getSource('flyr-campaign-buildings-source')) {
                map.removeSource('flyr-campaign-buildings-source');
              }
            } catch (err) {
              console.warn('Error removing extrusion layer:', err);
            }
            extrusionLayerRef.current = null;
          }
          return;
        }

        console.log(`[Frontend] Loading campaign: ${campaignId}`);
        
        // 1. Fetch Buildings (Polygons)
        let buildings: any[] = [];
        try {
          const buildingRes = await fetch(`/api/campaigns/${campaignId}/buildings`);
          if (buildingRes.ok) {
            buildings = await buildingRes.json();
            console.log(`Fetched ${buildings.length} buildings from API`);
          }
        } catch (error) {
          console.warn('Error fetching buildings from API:', error);
        }

        // 2. Fetch Addresses (Points) - always fetch for 3D mode
        let addresses: any[] = [];
        try {
          const addressRes = await fetch(`/api/campaigns/${campaignId}/addresses`);
          if (addressRes.ok) {
            const rawResponse = await addressRes.json();
            // DEBUG: Log raw response structure
            console.log('[Frontend] Raw API response:', {
              isArray: Array.isArray(rawResponse),
              length: Array.isArray(rawResponse) ? rawResponse.length : 'N/A',
              type: typeof rawResponse,
              hasData: 'data' in rawResponse,
              firstItem: Array.isArray(rawResponse) && rawResponse.length > 0 ? {
                keys: Object.keys(rawResponse[0]),
                hasGeometry: 'geometry' in rawResponse[0],
                geometryType: rawResponse[0].geometry ? typeof rawResponse[0].geometry : 'N/A',
                geometrySample: rawResponse[0].geometry ? JSON.stringify(rawResponse[0].geometry).substring(0, 200) : 'N/A',
                properties: rawResponse[0].properties || 'N/A',
              } : 'N/A',
            });
            
            // Handle both array and object with data property
            addresses = Array.isArray(rawResponse) ? rawResponse : (rawResponse.data || []);
            console.log(`[Frontend] Fetched ${addresses.length} addresses.`);
          } else {
            console.error('[Frontend] Address API returned non-OK status:', addressRes.status, addressRes.statusText);
            const errorText = await addressRes.text();
            console.error('[Frontend] Error response body:', errorText);
          }
        } catch (error) {
          console.error('[Frontend] Error fetching addresses from API:', error);
        }

        let mapFeatures: GeoJSON.Feature[] = [];

        if (mode === '3d') {
          // --- 3D MONOPOLY MODE ---
          console.log('3D Mode: Using Address Points for Models');

          const validFeatures: GeoJSON.Feature[] = [];
          addresses.forEach((a: any, index: number) => {
            try {
              // DEBUG: Log first address structure
              if (index === 0) {
                console.log('[Frontend] Processing first address:', {
                  keys: Object.keys(a),
                  hasGeometry: 'geometry' in a,
                  geometryType: a.geometry ? typeof a.geometry : 'N/A',
                  geometryValue: a.geometry ? JSON.stringify(a.geometry).substring(0, 200) : 'N/A',
                  hasProperties: 'properties' in a,
                  properties: a.properties || 'N/A',
                });
              }

              // The API should return GeoJSON features, so geometry should already be parsed
              // But handle both cases: string or object
              let geometry = a.geometry;
              if (typeof geometry === 'string') {
                try {
                  geometry = JSON.parse(geometry);
                } catch (e) {
                  console.warn(`[Frontend] Failed to parse geometry string for address ${a.properties?.id}:`, e);
                  return;
                }
              }

              if (!geometry || !geometry.type || !geometry.coordinates) {
                console.warn(`[Frontend] Skipping address with invalid geometry: ${a.properties?.id}`, {
                  geometry,
                  hasGeometry: !!geometry,
                  geometryType: geometry?.type,
                  hasCoordinates: !!geometry?.coordinates,
                });
                return;
              }

              validFeatures.push({
                type: 'Feature' as const,
                geometry: geometry,
                properties: {
                  id: a.properties?.id,
                  height: 10,
                  min_height: 0,
                  type: 'address',
                  address_id: a.properties?.id,
                  house_bearing: a.properties?.house_bearing || 0,
                },
              });
            } catch (e) {
              console.warn(`[Frontend] Skipping invalid address ID ${a.properties?.id}:`, e);
            }
          });

          mapFeatures = validFeatures;
          console.log(`Prepared ${mapFeatures.length} model points from ${addresses.length} addresses.`);
        } else {
          // --- 2D CITY MODE ---
          if (buildings && buildings.length > 0) {
            console.log('Using 2D buildings (Polygons)');
            mapFeatures = buildings.map((b: any) => ({
              type: 'Feature' as const,
              geometry: b.geometry,
              properties: {
                height: b.properties?.height || b.height || 10,
                min_height: b.properties?.min_height || 0,
                type: 'building',
                building_id: b.properties?.building_id,
                address_id: b.properties?.address_id,
              },
            }));
          } else {
            console.log('No 3D buildings found. Falling back to addresses.');
            const validFeatures: GeoJSON.Feature[] = [];
            addresses.forEach((a: any, index: number) => {
              try {
                // DEBUG: Log first address structure
                if (index === 0) {
                  console.log('[Frontend] Processing first address (2D fallback):', {
                    keys: Object.keys(a),
                    hasGeometry: 'geometry' in a,
                    geometryType: a.geometry ? typeof a.geometry : 'N/A',
                    geometryValue: a.geometry ? JSON.stringify(a.geometry).substring(0, 200) : 'N/A',
                    hasProperties: 'properties' in a,
                    properties: a.properties || 'N/A',
                  });
                }

                // The API should return GeoJSON features, so geometry should already be parsed
                // But handle both cases: string or object
                let geometry = a.geometry;
                if (typeof geometry === 'string') {
                  try {
                    geometry = JSON.parse(geometry);
                  } catch (e) {
                    console.warn(`[Frontend] Failed to parse geometry string for address ${a.properties?.id}:`, e);
                    return;
                  }
                }

                if (!geometry || !geometry.type || !geometry.coordinates) {
                  console.warn(`[Frontend] Skipping address with invalid geometry: ${a.properties?.id}`, {
                    geometry,
                    hasGeometry: !!geometry,
                    geometryType: geometry?.type,
                    hasCoordinates: !!geometry?.coordinates,
                  });
                  return;
                }

                validFeatures.push({
                  type: 'Feature' as const,
                  geometry: geometry,
                  properties: {
                    id: a.properties?.id,
                    height: 10,
                    min_height: 0,
                    type: 'address',
                    address_id: a.properties?.id,
                    house_bearing: a.properties?.house_bearing || 0,
                  },
                });
              } catch (e) {
                console.warn(`[Frontend] Skipping invalid address ID ${a.properties?.id}:`, e);
              }
            });

            mapFeatures = validFeatures;
            console.log(`Prepared ${mapFeatures.length} address features from ${addresses.length} addresses.`);
          }
        }

        if (mapFeatures.length === 0) {
          console.warn('No data found for this campaign (neither buildings nor addresses).');
          return;
        }

        // Convert to the format expected by the rendering logic
        let modelPoints: BuildingModelPoint[] = [];
        let houseFeatures: GeoJSON.FeatureCollection | null = null;

        // Convert mapFeatures to the format expected by rendering logic
        if (mode === '3d') {
          // Convert to modelPoints for 3D mode
          modelPoints = mapFeatures
            .filter(f => f.geometry.type === 'Point')
            .map(feature => {
              const props = feature.properties || {};
              return {
                type: 'Feature' as const,
                geometry: {
                  type: 'Point' as const,
                  coordinates: feature.geometry.type === 'Point' 
                    ? feature.geometry.coordinates as [number, number]
                    : [0, 0] as [number, number],
                },
                properties: {
                  'model-id': 'flyr-monopoly-house-model',
                  'front_bearing': props.house_bearing || 0,
                  'house_bearing': props.house_bearing || 0,
                  address_id: props.address_id || props.id,
                  building_id: props.building_id,
                },
              };
            });
          console.log(`Created ${modelPoints.length} model points from mapFeatures`);
        } else {
          // Convert to houseFeatures for 2D mode
          houseFeatures = {
            type: 'FeatureCollection' as const,
            features: mapFeatures.map(feature => {
              const props = feature.properties || {};
              return {
                ...feature,
                properties: {
                  ...props,
                  height: props.height || 10,
                  min_height: props.min_height || 0,
                },
              };
            }),
          };
          console.log(`Created ${houseFeatures.features.length} house features from mapFeatures`);
        }
        
        // Check if we have data to render
        if (mode === '3d' && modelPoints.length === 0) {
          console.warn('No model points available to render');
          return;
        }
        if (mode === '2d' && (!houseFeatures || houseFeatures.features.length === 0)) {
          console.warn('No house features available to render');
          return;
        }

        // 2D Mode: Render extruded polygons
        if (mode === '2d' && houseFeatures) {
          // Remove 3D layers if they exist
          if (threeLayerRef.current) {
            try {
              if (map.getLayer('flyr-campaign-buildings-model-layer')) {
                map.removeLayer('flyr-campaign-buildings-model-layer');
              }
            } catch (err) {
              console.warn('Error removing 3D layer:', err);
            }
            threeLayerRef.current = null;
          }

          const sourceId = 'flyr-campaign-buildings-source';
          
          // Add or update source
          if (map.getSource(sourceId)) {
            (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(houseFeatures);
          } else {
            map.addSource(sourceId, {
              type: 'geojson',
              data: houseFeatures,
            });
          }

          // Add or update FillExtrusionLayer (Only works for Polygons)
          const layerId = 'flyr-campaign-buildings-extrusion';
          if (!map.getLayer(layerId)) {
            map.addLayer({
              id: layerId,
              type: 'fill-extrusion',
              source: sourceId,
              minzoom: 13,
              filter: ['==', '$type', 'Polygon'], // Only Polygons
              paint: {
                'fill-extrusion-color': [
                  'case',
                  ['==', ['get', 'status'], 'done'],
                  '#10b981', // Green for done
                  '#ef4444', // Red for pending
                ],
                'fill-extrusion-opacity': 0.98,
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
              },
            });
          }
          extrusionLayerRef.current = layerId;

          // Add Circle Layer for Points (address pins)
          const circleLayerId = 'address-pins';
          if (!map.getLayer(circleLayerId)) {
            map.addLayer({
              id: circleLayerId,
              type: 'circle',
              source: sourceId,
              filter: ['==', '$type', 'Point'], // Only Points
              paint: {
                'circle-radius': 6,
                'circle-color': '#FF5722', // Orange dots
                'circle-stroke-width': 2,
                'circle-stroke-color': '#FFFFFF',
              },
            });
          }

          // 4. AUTO-ZOOM for 2D mode
          if (mapFeatures.length > 0) {
            setTimeout(() => {
              if (!map) return;
              
              const bounds = new mapboxgl.LngLatBounds();
              mapFeatures.forEach((feature: GeoJSON.Feature) => {
                // Specific check for Point vs Polygon coordinates
                if (feature.geometry.type === 'Point') {
                  const coords = feature.geometry.coordinates as [number, number];
                  bounds.extend(coords);
                } else if (feature.geometry.type === 'Polygon') {
                  // For polygons, extend bounds with all coordinates in the first ring
                  feature.geometry.coordinates[0].forEach((coord: number[]) => {
                    bounds.extend(coord as [number, number]);
                  });
                }
              });

              if (!bounds.isEmpty()) {
                console.log('Zooming to campaign area (2D mode)...');
                map.fitBounds(bounds, {
                  padding: 100,
                  pitch: 60, // Tilted 3D view
                  maxZoom: 18,
                  duration: 1500
                });
              }
            }, 300); // Wait for layers to render
          }

          return; // Done with 2D mode
        }
        
        // 3D Mode: Render GLB models
        // Try to use Three.js layer if WebGL is supported
        console.log('WebGL supported:', webglSupportedRef.current);
        if (webglSupportedRef.current) {
          try {
            // Remove fallback layer if it exists
            if (fallbackLayerRef.current) {
              try {
                if (map.getLayer('building-models-fallback')) {
                  map.removeLayer('building-models-fallback');
                }
                if (map.getSource(fallbackLayerRef.current)) {
                  map.removeSource(fallbackLayerRef.current);
                }
              } catch (err) {
                console.warn('Error removing fallback layer:', err);
              }
              fallbackLayerRef.current = null;
            }

            // Remove existing Three.js layer if it exists
            if (threeLayerRef.current) {
              try {
                if (map.getLayer('flyr-campaign-buildings-model-layer')) {
                  map.removeLayer('flyr-campaign-buildings-model-layer');
                }
              } catch (err) {
                console.warn('Error removing existing Three.js layer:', err);
              }
            }

            // Remove 2D extrusion layer if it exists
            if (extrusionLayerRef.current) {
              try {
                if (map.getLayer('flyr-campaign-buildings-extrusion')) {
                  map.removeLayer('flyr-campaign-buildings-extrusion');
                }
                if (map.getSource('flyr-campaign-buildings-source')) {
                  map.removeSource('flyr-campaign-buildings-source');
                }
              } catch (err) {
                console.warn('Error removing 2D layer:', err);
              }
              extrusionLayerRef.current = null;
            }

            // Create new Three.js layer
            console.log('Creating Three.js layer with', modelPoints.length, 'model points');
            // Create click handler that supports building_id, gers_id, and address_id
            const handleMarkerClick = (id: string) => {
              // Check if this is a building_id, gers_id, or address_id
              const point = modelPoints.find(p => 
                p.properties.building_id === id || 
                p.properties.gers_id === id ||
                p.properties.address_id === id
              );
              
              if (point?.properties.building_id && onBuildingClick) {
                // Gold Standard: Use building UUID
                onBuildingClick(point.properties.building_id);
              } else if (point?.properties.gers_id && onBuildingClick) {
                // Overture: Use GERS ID to find building
                // Fetch building by GERS ID and use its UUID
                BuildingService.fetchBuildingByGersId(point.properties.gers_id)
                  .then(building => {
                    if (building && onBuildingClick) {
                      onBuildingClick(building.id);
                    }
                  })
                  .catch(() => {
                    // Fallback to legacy if building not found
                    if (point?.properties.address_id && onMarkerClick) {
                      onMarkerClick(point.properties.address_id);
                    }
                  });
              } else if (point?.properties.address_id && onMarkerClick) {
                // Legacy: Use address ID
                onMarkerClick(point.properties.address_id);
              } else if (onMarkerClick) {
                // Fallback to legacy callback
                onMarkerClick(id);
              }
            };
            
            const threeLayer = new ThreeHouseLayer({
              glbUrl: '/House 2026.glb',
              features: modelPoints,
              onModelLoad: () => {
                console.log('✅ 3D models loaded successfully');
                onLayerReady?.(threeLayer);
              },
              onMarkerClick: handleMarkerClick,
            });

            // Wait for map style to load before adding layer
            const addLayer = () => {
              try {
                console.log('Adding Three.js layer to map...');
                map.addLayer(threeLayer as any);
                threeLayerRef.current = threeLayer;
                onLayerReady?.(threeLayer);
                console.log('✅ Three.js layer added successfully');
              } catch (err) {
                console.error('❌ Error adding Three.js layer:', err);
                throw err;
              }
            };

            if (map.loaded()) {
              addLayer();
            } else {
              map.once('style.load', addLayer);
            }
          } catch (error) {
            console.error('❌ Error setting up Three.js layer, falling back to circles:', error);
            webglSupportedRef.current = false;
            // Fall through to fallback
          }
        }

        // Fallback to circle markers if WebGL not supported or Three.js failed
        if (!webglSupportedRef.current || !threeLayerRef.current) {
          // Ensure all features have explicit IDs for Mapbox stability
          const geojson = {
            type: 'FeatureCollection' as const,
            features: modelPoints.map((feature, index) => {
              const props = feature.properties || {};
              const featureId = (props as any).id || props.address_id || props.building_id || `feature-${index}`;
              return {
                ...feature,
                id: featureId
              };
            }),
          };

          const sourceId = 'building-models-fallback';
          if (map.getSource(sourceId)) {
            (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
          } else {
            map.addSource(sourceId, {
              type: 'geojson',
              data: geojson,
            });

            if (!map.getLayer('building-models-fallback')) {
              map.addLayer({
                id: 'building-models-fallback',
                type: 'circle',
                source: sourceId,
                paint: {
                  'circle-radius': 8,
                  'circle-color': '#ef4444',
                  'circle-opacity': 0.8,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                },
              });
            }
          }
          fallbackLayerRef.current = sourceId;
        }

        // 4. AUTO-ZOOM (The "Insurance Policy" - Fly To Fix)
        // Calculate bounds so the map FORCES the pins into view
        // This ensures pins are visible even if map starts centered elsewhere
        if (mapFeatures.length > 0) {
          setTimeout(() => {
            if (!map) return;
            
            const bounds = new mapboxgl.LngLatBounds();
            mapFeatures.forEach((feature: GeoJSON.Feature) => {
              // Specific check for Point vs Polygon coordinates
              if (feature.geometry.type === 'Point') {
                const coords = feature.geometry.coordinates as [number, number];
                if (coords && coords.length >= 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                  bounds.extend(coords);
                }
              } else if (feature.geometry.type === 'Polygon') {
                // For polygons, extend bounds with all coordinates in the first ring
                feature.geometry.coordinates[0].forEach((coord: number[]) => {
                  if (coord && coord.length >= 2 && !isNaN(coord[0]) && !isNaN(coord[1])) {
                    bounds.extend(coord as [number, number]);
                  }
                });
              }
            });

            if (!bounds.isEmpty() && map) {
              console.log(`Auto-zooming to ${mapFeatures.length} features...`);
              map.fitBounds(bounds, {
                padding: 80, // Padding around the bounds
                pitch: mode === '3d' ? 60 : 0, // Tilted 3D view for 3d mode
                maxZoom: 18,
                duration: 1000 // Smooth animation
              });
            }
          }, mode === '3d' ? 500 : 300); // Wait for layers to render
        }
      } catch (error) {
        console.error('Error loading campaign buildings:', error);
      }
    };

    // Wait for map to be fully loaded
    if (map.loaded()) {
      loadCampaignBuildings();
    } else {
      map.once('load', loadCampaignBuildings);
    }

    // Cleanup on unmount
    return () => {
      if (threeLayerRef.current) {
        try {
          if (map.getLayer('flyr-campaign-buildings-model-layer')) {
            map.removeLayer('flyr-campaign-buildings-model-layer');
          }
        } catch (err) {
          // Ignore
        }
        threeLayerRef.current = null;
      }
      if (extrusionLayerRef.current) {
        try {
          if (map.getLayer('flyr-campaign-buildings-extrusion')) {
            map.removeLayer('flyr-campaign-buildings-extrusion');
          }
          if (map.getSource('flyr-campaign-buildings-source')) {
            map.removeSource('flyr-campaign-buildings-source');
          }
        } catch (err) {
          // Ignore
        }
        extrusionLayerRef.current = null;
      }
    };
  }, [map, campaignId, mode]);

  // Real-time subscription for campaign buildings
  useEffect(() => {
    if (!map || !campaignId || !threeLayerRef.current) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`campaign-buildings-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'buildings',
          filter: `campaign_id=eq.${campaignId}`
        },
        async (payload) => {
          const newBuilding = payload.new as BuildingType;
          
          // Animate building in
          if (threeLayerRef.current && newBuilding) {
            try {
              // Fetch full building data if needed
              const building = await BuildingService.fetchBuilding(newBuilding.id);
              if (building && threeLayerRef.current) {
                // Trigger animation in ThreeHouseLayer
                threeLayerRef.current.animateBuildingIn(building);
              }
            } catch (error) {
              console.error('Error animating new building:', error);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId]);

  return null;
}

