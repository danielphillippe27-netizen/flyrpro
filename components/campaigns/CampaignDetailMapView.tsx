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
  const initAttemptedRef = useRef(false);

  useEffect(() => {
    if (!mapContainer.current || map.current || initAttemptedRef.current) return;

    // Check if container has dimensions before initializing
    const checkAndInit = () => {
      if (!mapContainer.current) return;
      
      const rect = mapContainer.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        // Container not visible yet, try again on next frame
        requestAnimationFrame(checkAndInit);
        return;
      }

      initAttemptedRef.current = true;
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
      mapboxgl.accessToken = token;

      // Helper to get initial center from addresses (uses same parsing logic as getCoordinate)
      const getInitialCenter = (): [number, number] => {
        if (addresses.length > 0) {
          const addr = addresses[0];
          // Try first address coordinate
          if (addr.coordinate) {
            return [addr.coordinate.lon, addr.coordinate.lat];
          }
          
          // Try parsing geom using robust parsing logic
          if (addr.geom) {
            try {
              let geomData: any = addr.geom;

              // If it's a string, try to parse it
              if (typeof geomData === 'string') {
                try {
                  geomData = JSON.parse(geomData);
                } catch (jsonError) {
                  // Not valid JSON - try WKT format
                  const wktPatterns = [
                    /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
                    /POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
                    /SRID=\d+;POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,
                  ];

                  for (const pattern of wktPatterns) {
                    const match = geomData.match(pattern);
                    if (match) {
                      const lon = parseFloat(match[1]);
                      const lat = parseFloat(match[2]);
                      if (!isNaN(lon) && !isNaN(lat)) {
                        return [lon, lat];
                      }
                    }
                  }
                  // Fall through to default if WKT parsing fails
                }
              }

              // Handle GeoJSON Point object
              if (typeof geomData === 'object' && geomData !== null) {
                if (geomData.type === 'Point' && Array.isArray(geomData.coordinates) && geomData.coordinates.length >= 2) {
                  const lon = geomData.coordinates[0];
                  const lat = geomData.coordinates[1];
                  if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
                    return [lon, lat];
                  }
                }
                // Handle object with direct coordinates property
                if (Array.isArray(geomData.coordinates) && geomData.coordinates.length >= 2) {
                  const lon = geomData.coordinates[0];
                  const lat = geomData.coordinates[1];
                  if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
                    return [lon, lat];
                  }
                }
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

      // Trigger resize after a short delay to ensure map renders properly
      setTimeout(() => {
        if (map.current) {
          map.current.resize();
        }
      }, 100);
    };

    // Use requestAnimationFrame to ensure container is rendered
    requestAnimationFrame(checkAndInit);

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        initAttemptedRef.current = false;
        setMapLoaded(false);
      }
    };
  }, [addresses]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Robust helper function to parse coordinate from address geom field
    // Handles: GeoJSON objects, GeoJSON strings, WKT strings, and direct coordinate objects
    const getCoordinate = (address: CampaignAddress): { lon: number; lat: number } | null => {
      // First try direct coordinate
      if (address.coordinate) {
        return address.coordinate;
      }
      
      // Try parsing from geom (PostGIS geometry)
      if (!address.geom) {
        return null;
      }

      try {
        let geomData: any = address.geom;

        // If it's a string, try to parse it
        if (typeof geomData === 'string') {
          // Try parsing as JSON first (GeoJSON string)
          try {
            geomData = JSON.parse(geomData);
          } catch (jsonError) {
            // Not valid JSON - try WKT format
            // Handle various WKT formats: "POINT(lng lat)", "POINT (lng lat)", "POINT(lng, lat)", etc.
            const wktPatterns = [
              /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,  // Standard: POINT(lng lat)
              /POINT\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,  // With comma: POINT(lng, lat)
              /SRID=\d+;POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i,  // With SRID: SRID=4326;POINT(lng lat)
            ];

            for (const pattern of wktPatterns) {
              const match = geomData.match(pattern);
              if (match) {
                const lon = parseFloat(match[1]);
                const lat = parseFloat(match[2]);
                if (!isNaN(lon) && !isNaN(lat)) {
                  return { lon, lat };
                }
              }
            }
            
            // If WKT parsing failed, return null
            console.warn('Failed to parse WKT geometry for address:', address.id, 'geom:', geomData);
            return null;
          }
        }

        // Now geomData should be an object (either original or parsed from JSON)
        if (typeof geomData !== 'object' || geomData === null) {
          console.warn('Invalid geometry format for address:', address.id, 'geom type:', typeof geomData);
          return null;
        }

        // Handle GeoJSON Point object: { type: 'Point', coordinates: [lng, lat] }
        if (geomData.type === 'Point' && Array.isArray(geomData.coordinates)) {
          if (geomData.coordinates.length >= 2) {
            const lon = geomData.coordinates[0];
            const lat = geomData.coordinates[1];
            if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
              return { lon, lat };
            }
          }
        }

        // Handle object with direct coordinates property: { coordinates: [lng, lat] }
        if (Array.isArray(geomData.coordinates) && geomData.coordinates.length >= 2) {
          const lon = geomData.coordinates[0];
          const lat = geomData.coordinates[1];
          if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
            return { lon, lat };
          }
        }

        // Handle nested geometry objects (some Supabase formats)
        if (geomData.geometry && typeof geomData.geometry === 'object') {
          if (geomData.geometry.coordinates && Array.isArray(geomData.geometry.coordinates) && geomData.geometry.coordinates.length >= 2) {
            const lon = geomData.geometry.coordinates[0];
            const lat = geomData.geometry.coordinates[1];
            if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
              return { lon, lat };
            }
          }
        }

        console.warn('Could not extract coordinates from geometry for address:', address.id, 'geom structure:', JSON.stringify(geomData).substring(0, 200));
        return null;
      } catch (e) {
        console.warn('Failed to parse geometry for address:', address.id, 'geom type:', typeof address.geom, 'error:', e);
        return null;
      }
    };

    // Clear existing markers first
    const existingMarkers: mapboxgl.Marker[] = [];
    
    // Add markers for addresses
    if (addresses.length > 0) {
      console.log('Processing addresses for markers:', addresses.length);
      let coordsFound = 0;
      
      addresses.forEach((address) => {
        const coord = getCoordinate(address);
        
        if (coord) {
          coordsFound++;
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
                  <p class="font-semibold">${address.formatted || address.address || 'Address'}</p>
                  <p class="text-sm text-gray-600">${address.visited ? 'Visited' : 'Not visited'}</p>
                </div>
              `)
            )
            .addTo(map.current!);
          
          existingMarkers.push(marker);
        } else {
          // Enhanced logging to help diagnose parsing issues
          const geomInfo = address.geom 
            ? (typeof address.geom === 'string' 
                ? `string (${address.geom.substring(0, 100)}...)` 
                : `object (${JSON.stringify(address.geom).substring(0, 100)}...)`)
            : 'undefined';
          console.warn('No coordinate found for address:', {
            id: address.id,
            hasCoordinate: !!address.coordinate,
            hasGeom: !!address.geom,
            geomType: typeof address.geom,
            geomInfo,
          });
        }
      });
      
      console.log(`Successfully created ${coordsFound} markers out of ${addresses.length} addresses`);

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

