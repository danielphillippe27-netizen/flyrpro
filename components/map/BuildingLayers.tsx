'use client';

import { useEffect, useRef } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { MapService, type BuildingModelPoint } from '@/lib/services/MapService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { ThreeHouseLayer } from './ThreeHouseLayer';

export type RenderingMode = '3d' | '2d';

interface BuildingLayersProps {
  map: Map;
  campaignId?: string | null;
  mode?: RenderingMode; // '3d' for GLB models, '2d' for extruded polygons
  onLayerReady?: (layer: ThreeHouseLayer | null) => void;
}

export function BuildingLayers({ map, campaignId, mode = '3d', onLayerReady }: BuildingLayersProps) {
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

        // First, try to fetch campaign buildings directly (they already have geometry and front_bearing)
        console.log(`Loading campaign buildings for campaign: ${campaignId} in ${mode} mode`);
        let buildings = await MapService.fetchCampaignBuildings(campaignId);
        console.log('Fetched campaign_buildings:', buildings.length);
        
        let modelPoints: BuildingModelPoint[] = [];
        let houseFeatures: GeoJSON.FeatureCollection | null = null;

        if (buildings.length > 0) {
          // Use campaign_buildings if available
          if (mode === '3d') {
            modelPoints = MapService.createBuildingModelPointsFromCampaignBuildings(buildings, 'flyr-monopoly-house-model');
            console.log('Created model points from campaign_buildings:', modelPoints.length);
          } else {
            // 2D mode: Create house-shaped polygons
            houseFeatures = MapService.convertCampaignBuildingsToHouseFeatureCollection(buildings);
            console.log('Created house features from campaign_buildings:', houseFeatures.features.length);
          }
        } else {
          // Fallback: Use addresses and building polygons
          console.log('No campaign_buildings found, falling back to addresses and building polygons');
          const addresses = await CampaignsService.fetchAddresses(campaignId);
          
          // Get addresses with coordinates
          const addressesWithCoords = addresses
            .map(addr => {
              let coord = addr.coordinate;
              if (!coord && addr.geom) {
                try {
                  const geom = typeof addr.geom === 'string' ? JSON.parse(addr.geom) : addr.geom;
                  if (geom && geom.coordinates) {
                    coord = { lon: geom.coordinates[0], lat: geom.coordinates[1] };
                  }
                } catch (e) {
                  return null;
                }
              }
              return coord && addr.id ? { id: addr.id, lat: coord.lat, lon: coord.lon } : null;
            })
            .filter((a): a is { id: string; lat: number; lon: number } => a !== null);

          if (addressesWithCoords.length > 0) {
            try {
              // Request building polygons
              await MapService.requestBuildingPolygons(addressesWithCoords);
              
              // Fetch building polygons
              const polygonIds = addressesWithCoords.map(a => a.id);
              const polygons = await MapService.fetchBuildingPolygons(polygonIds);
              
              if (polygons.length > 0) {
                if (mode === '3d') {
                  // Create model points from building polygons
                  modelPoints = MapService.createBuildingModelPoints(polygons, 'flyr-monopoly-house-model');
                  console.log('Created model points from building polygons:', modelPoints.length);
                } else {
                  // 2D mode: Convert polygons to house shapes
                  // For 2D mode, we need to create house footprints from polygon centroids
                  const buildingData = polygons.map(poly => {
                    const geom = JSON.parse(poly.geom) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
                    const centroid = MapService.calculatePolygonCentroid(geom);
                    const frontBearing = MapService.calculateFrontBearing(geom);
                    return {
                      id: poly.address_id, // Use address_id as building id
                      campaign_id: campaignId,
                      address_id: poly.address_id,
                      building_id: undefined,
                      geometry: JSON.stringify(geom), // Convert back to string for consistency
                      height_m: 18.0,
                      min_height_m: 0.0,
                      front_bearing: frontBearing,
                      source: 'building_polygon',
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    };
                  });
                  houseFeatures = MapService.convertCampaignBuildingsToHouseFeatureCollection(buildingData);
                  console.log('Created house features from building polygons:', houseFeatures.features.length);
                }
              } else {
                // Last resort: Create points directly from address coordinates
                console.log('No building polygons found, using address coordinates directly');
                if (mode === '3d') {
                  modelPoints = addressesWithCoords.map(addr => ({
                    type: 'Feature' as const,
                    geometry: {
                      type: 'Point' as const,
                      coordinates: [addr.lon, addr.lat] as [number, number],
                    },
                    properties: {
                      'model-id': 'flyr-monopoly-house-model',
                      'front_bearing': 0, // Default bearing
                      address_id: addr.id,
                    },
                  }));
                  console.log('Created model points from addresses:', modelPoints.length);
                } else {
                  // 2D mode: Create house footprints at address coordinates
                  const buildingData = addressesWithCoords.map(addr => ({
                    id: addr.id,
                    campaign_id: campaignId,
                    address_id: addr.id,
                    building_id: undefined,
                    geometry: JSON.stringify({
                      type: 'Point',
                      coordinates: [addr.lon, addr.lat],
                    }),
                    height_m: 18.0,
                    min_height_m: 0.0,
                    front_bearing: 0,
                    source: 'address_coordinate',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  }));
                  houseFeatures = MapService.convertCampaignBuildingsToHouseFeatureCollection(buildingData);
                  console.log('Created house features from addresses:', houseFeatures.features.length);
                }
              }
            } catch (error) {
              console.error('Error loading building polygons:', error);
              // Still try to create points from coordinates
              if (mode === '3d') {
                modelPoints = addressesWithCoords.map(addr => ({
                  type: 'Feature' as const,
                  geometry: {
                    type: 'Point' as const,
                    coordinates: [addr.lon, addr.lat] as [number, number],
                  },
                  properties: {
                    'model-id': 'flyr-monopoly-house-model',
                    'front_bearing': 0,
                    address_id: addr.id,
                  },
                }));
              } else {
                const buildingData = addressesWithCoords.map(addr => ({
                  id: addr.id,
                  campaign_id: campaignId,
                  address_id: addr.id,
                  building_id: undefined,
                  geometry: JSON.stringify({
                    type: 'Point',
                    coordinates: [addr.lon, addr.lat],
                  }),
                  height_m: 18.0,
                  min_height_m: 0.0,
                  front_bearing: 0,
                  source: 'address_coordinate',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }));
                houseFeatures = MapService.convertCampaignBuildingsToHouseFeatureCollection(buildingData);
              }
            }
          }
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

          // Add or update FillExtrusionLayer
          const layerId = 'flyr-campaign-buildings-extrusion';
          if (!map.getLayer(layerId)) {
            map.addLayer({
              id: layerId,
              type: 'fill-extrusion',
              source: sourceId,
              minzoom: 13,
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

          // Fit bounds to show all buildings - but let CampaignDetailMapView handle initial bounds
          // Only fit if we have valid data and map is ready
          if (houseFeatures.features.length > 0) {
            setTimeout(() => {
              if (!map) return;
              const bounds = new mapboxgl.LngLatBounds();
              houseFeatures.features.forEach((feature) => {
                if (feature.geometry.type === 'Polygon') {
                  feature.geometry.coordinates[0].forEach((coord: [number, number]) => {
                    bounds.extend(coord);
                  });
                }
              });
              if (!bounds.isEmpty()) {
                map.fitBounds(bounds, { padding: 100, maxZoom: 18, duration: 1000 });
              }
            }, 300); // Wait for extrusion layer to render
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
            const threeLayer = new ThreeHouseLayer({
              glbUrl: '/3d-houses.glb',
              features: modelPoints,
              onModelLoad: () => {
                console.log('✅ 3D models loaded successfully');
                onLayerReady?.(threeLayer);
              },
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
          const geojson = {
            type: 'FeatureCollection' as const,
            features: modelPoints,
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

        // Fit bounds to show all buildings - but let CampaignDetailMapView handle initial bounds
        // Only fit if we have valid data and map is ready
        if (modelPoints.length > 0) {
          setTimeout(() => {
            if (!map) return;
            const bounds = new mapboxgl.LngLatBounds();
            modelPoints.forEach((point) => {
              bounds.extend(point.geometry.coordinates as [number, number]);
            });
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { padding: 100, maxZoom: 18, duration: 1000 });
            }
          }, 500); // Wait for 3D models to start loading
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

  return null;
}

