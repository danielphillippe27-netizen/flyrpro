'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CampaignAddress } from '@/types/database';
import { MapService } from '@/lib/services/MapService';
import { BuildingLayers, type RenderingMode } from '@/components/map/BuildingLayers';

export function CampaignDetailMapView({
  campaignId,
  addresses,
  mode = '3d',
}: {
  campaignId: string;
  addresses: CampaignAddress[];
  mode?: RenderingMode;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const boundsFittedRef = useRef(false);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
    mapboxgl.accessToken = token;

    // Helper to get initial center from addresses
    const getInitialCenter = (): [number, number] => {
      if (addresses.length > 0) {
        // Try first address coordinate
        if (addresses[0].coordinate) {
          return [addresses[0].coordinate.lon, addresses[0].coordinate.lat];
        }
        // Try parsing geom
        if (addresses[0].geom) {
          try {
            const geom = typeof addresses[0].geom === 'string' 
              ? JSON.parse(addresses[0].geom) 
              : addresses[0].geom;
            if (geom && geom.coordinates && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
              return [geom.coordinates[0], geom.coordinates[1]];
            }
          } catch (e) {
            // Fall through to default
          }
        }
      }
      return [-79.3832, 43.6532]; // Toronto default
    };

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
      center: getInitialCenter(),
      zoom: 12,
    });

    map.current.on('load', () => {
      setMapLoaded(true);
      
      // Clean up problematic layers and hide building layers
      const cleanupLayers = () => {
        if (!map.current) return;
        
        try {
          const style = map.current.getStyle();
          if (style && style.layers) {
            style.layers.forEach((layer) => {
              // Hide layers that contain "building" in their id
              if (layer.id.toLowerCase().includes('building')) {
                map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
              }
              
              // Remove layers that reference non-existent source layers
              if (layer.id && (
                layer.id.includes('road-label') || 
                layer.id.includes('road_label')
              )) {
                try {
                  map.current.removeLayer(layer.id);
                } catch (err) {
                  // Layer might not exist or already removed
                }
              }
            });
          }
        } catch (err) {
          // Ignore cleanup errors
        }
      };
      
      cleanupLayers();
    });

    // Handle non-critical source layer errors
    map.current.on('error', (e) => {
      const errorMessage = e.error?.message || String(e.error);
      const isSourceLayerError = errorMessage.includes('does not exist on source') || 
                                 errorMessage.includes('Source layer');
      
      if (isSourceLayerError) {
        // This is a style validation error - log but don't show to user
        console.warn('Mapbox style layer warning (non-critical):', errorMessage);
        
        // Try to remove the problematic layer after style loads
        if (map.current) {
          map.current.once('style.load', () => {
            try {
              const style = map.current?.getStyle();
              if (style && style.layers) {
                style.layers.forEach((layer) => {
                  if (layer.id && (
                    layer.id.includes('road-label') || 
                    layer.id.includes('road_label')
                  )) {
                    try {
                      map.current?.removeLayer(layer.id);
                    } catch (removeErr) {
                      // Layer might already be removed
                    }
                  }
                });
              }
            } catch (cleanupErr) {
              // Ignore cleanup errors
            }
          });
        }
      }
    });

    return () => {
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Helper function to parse coordinate from address
    const getCoordinate = (address: CampaignAddress): { lon: number; lat: number } | null => {
      // First try direct coordinate
      if (address.coordinate) {
        return address.coordinate;
      }
      
      // Try parsing from geom (PostGIS geometry)
      if (address.geom) {
        try {
          const geom = typeof address.geom === 'string' ? JSON.parse(address.geom) : address.geom;
          if (geom && geom.coordinates) {
            // PostGIS Point: [lon, lat]
            if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
              return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
            }
          }
        } catch (e) {
          console.warn('Failed to parse geometry for address:', address.id, e);
        }
      }
      
      return null;
    };

    // Clear existing markers first
    const existingMarkers: mapboxgl.Marker[] = [];
    
    // Add markers for addresses
    if (addresses.length > 0) {
      addresses.forEach((address) => {
        const coord = getCoordinate(address);
        
        if (coord) {
          const el = document.createElement('div');
          el.className = 'marker';
          el.style.width = '20px';
          el.style.height = '20px';
          el.style.borderRadius = '50%';
          el.style.backgroundColor = address.visited ? '#10b981' : '#3b82f6';
          el.style.border = '2px solid white';
          el.style.cursor = 'pointer';

          const marker = new mapboxgl.Marker(el)
            .setLngLat([coord.lon, coord.lat])
            .setPopup(
              new mapboxgl.Popup().setHTML(`
                <div>
                  <p class="font-semibold">${address.address}</p>
                  <p class="text-sm text-gray-600">${address.visited ? 'Visited' : 'Not visited'}</p>
                </div>
              `)
            )
            .addTo(map.current!);
          
          existingMarkers.push(marker);
        }
      });

      // Fit bounds to show all addresses - wait a bit for map to be ready and markers to be added
      const addressesWithCoords = addresses
        .map(addr => getCoordinate(addr))
        .filter((coord): coord is { lon: number; lat: number } => coord !== null);

      if (addressesWithCoords.length > 0 && !boundsFittedRef.current) {
        // Use setTimeout to ensure map is fully ready and markers are added
        setTimeout(() => {
          if (!map.current || boundsFittedRef.current) return;
          
          const bounds = new mapboxgl.LngLatBounds();
          addressesWithCoords.forEach((coord) => {
            bounds.extend([coord.lon, coord.lat]);
          });
          
          // Only fit bounds if we have valid bounds
          if (!bounds.isEmpty()) {
            boundsFittedRef.current = true;
            map.current.fitBounds(bounds, { 
              padding: 100, 
              maxZoom: 18,
              duration: 1000 // Smooth animation
            });
          }
        }, 200); // Small delay to ensure markers are rendered
      }
    }

    // Load building polygons (2D fallback/overlay)
    const loadBuildings = async () => {
      const addressesWithCoords = addresses
        .map(addr => {
          const coord = getCoordinate(addr);
          return coord && addr.id ? { id: addr.id, lat: coord.lat, lon: coord.lon } : null;
        })
        .filter((a): a is { id: string; lat: number; lon: number } => a !== null);

      if (addressesWithCoords.length > 0) {
        try {
          await MapService.requestBuildingPolygons(addressesWithCoords);
          // Fetch and render polygons
          const polygonIds = addressesWithCoords.map(a => a.id);
          const polygons = await MapService.fetchBuildingPolygons(polygonIds);
          
          // Render polygons on map
          if (polygons.length > 0 && map.current) {
            const geojson = {
              type: 'FeatureCollection' as const,
              features: polygons.map((polygon) => ({
                type: 'Feature' as const,
                geometry: JSON.parse(polygon.geom),
                properties: { address_id: polygon.address_id },
              })),
            };

            if (map.current.getSource('buildings')) {
              (map.current.getSource('buildings') as mapboxgl.GeoJSONSource).setData(geojson);
            } else {
              map.current.addSource('buildings', {
                type: 'geojson',
                data: geojson,
              });

              map.current.addLayer({
                id: 'buildings-fill',
                type: 'fill',
                source: 'buildings',
                paint: {
                  'fill-color': '#3b82f6',
                  'fill-opacity': 0.3,
                },
              });

              map.current.addLayer({
                id: 'buildings-line',
                type: 'line',
                source: 'buildings',
                paint: {
                  'line-color': '#3b82f6',
                  'line-width': 2,
                },
              });
            }
          }
        } catch (error) {
          console.error('Error loading building polygons:', error);
        }
      }
    };

    loadBuildings();

    // Cleanup markers on unmount or address change
    return () => {
      existingMarkers.forEach(marker => marker.remove());
      boundsFittedRef.current = false; // Reset when addresses change
    };
  }, [mapLoaded, addresses]);

  // Auto-set pitch for 3D mode (matching iOS behavior)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    
    if (mode === '3d') {
      // Set pitch to 60° for 3D view (matching iOS)
      map.current.easeTo({
        pitch: 60,
        duration: 1000,
      });
    } else {
      // Reset pitch for 2D view
      map.current.easeTo({
        pitch: 0,
        duration: 1000,
      });
    }
  }, [mapLoaded, mode]);

  return (
    <>
      <div ref={mapContainer} className="h-full w-full" />
      {map.current && mapLoaded && (
        <BuildingLayers map={map.current} campaignId={campaignId} mode={mode} />
      )}
    </>
  );
}

