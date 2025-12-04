'use client';

import { useEffect, useRef } from 'react';
import type { Map } from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { MapService } from '@/lib/services/MapService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { ThreeHouseLayer } from './ThreeHouseLayer';

interface BuildingLayersProps {
  map: Map;
  campaignId?: string | null;
  onLayerReady?: (layer: ThreeHouseLayer | null) => void;
}

export function BuildingLayers({ map, campaignId, onLayerReady }: BuildingLayersProps) {
  const threeLayerRef = useRef<ThreeHouseLayer | null>(null);
  const fallbackLayerRef = useRef<string | null>(null);
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
              if (map.getLayer('three-houses')) {
                map.removeLayer('three-houses');
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
          return;
        }

        // Fetch campaign addresses
        console.log('Loading campaign buildings for campaign:', campaignId);
        const addresses = await CampaignsService.fetchAddresses(campaignId);
        console.log('Fetched addresses:', addresses.length);
        const addressesWithCoords = addresses.filter(a => a.coordinate && a.id);
        console.log('Addresses with coordinates:', addressesWithCoords.length);
        
        if (addressesWithCoords.length === 0) {
          console.warn('No addresses with coordinates found');
          return;
        }

        // Request building polygons if not already available
        console.log('Requesting building polygons...');
        await MapService.requestBuildingPolygons(
          addressesWithCoords.map(a => ({ 
            id: a.id!, 
            lat: a.coordinate!.lat, 
            lon: a.coordinate!.lon 
          }))
        );

        // Fetch building polygons
        const polygonIds = addressesWithCoords.map(a => a.id);
        console.log('Fetching polygons for IDs:', polygonIds);
        const polygons = await MapService.fetchBuildingPolygons(polygonIds);
        console.log('Fetched polygons:', polygons.length);
        
        if (polygons.length === 0) {
          console.warn('No building polygons found');
          return;
        }

        // Create point features with centroids and front_bearing
        const modelPoints = MapService.createBuildingModelPoints(polygons, 'house-model');
        console.log('Created model points:', modelPoints.length);
        
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
                if (map.getLayer('three-houses')) {
                  map.removeLayer('three-houses');
                }
              } catch (err) {
                console.warn('Error removing existing Three.js layer:', err);
              }
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

        // Fit bounds to show all buildings
        if (modelPoints.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          modelPoints.forEach((point) => {
            bounds.extend(point.geometry.coordinates as [number, number]);
          });
          map.fitBounds(bounds, { padding: 100, maxZoom: 18 });
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
          if (map.getLayer('three-houses')) {
            map.removeLayer('three-houses');
          }
        } catch (err) {
          // Ignore
        }
        threeLayerRef.current = null;
      }
    };
  }, [map, campaignId]);

  return null;
}

