'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CampaignAddress } from '@/types/database';
import { MapBuildingsLayer } from '@/components/map/MapBuildingsLayer';
import { MapModeToggle } from '@/components/map/MapModeToggle';
import { ViewModeToggle, type ViewMode } from '@/components/map/ViewModeToggle';
import { LocationCard } from '@/components/map/LocationCard';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { createClient } from '@/lib/supabase/client';

type MapMode = 'light' | 'dark' | 'satellite';

export function CampaignDetailMapView({
  campaignId,
  addresses,
}: {
  campaignId: string;
  addresses: CampaignAddress[];
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('light');
  const [viewMode, setViewMode] = useState<ViewMode>('standard');
  const [mapLoaded, setMapLoaded] = useState(false);
  const boundsFittedRef = useRef(false);
  const initAttemptedRef = useRef(false);
  
  // Location Card state
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [locationCardOpen, setLocationCardOpen] = useState(false);
  
  // Create Contact Dialog state
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | undefined>(undefined);
  const [selectedAddressText, setSelectedAddressText] = useState<string | undefined>(undefined);

  // Get user ID on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  // Handle building click - opens LocationCard
  const handleBuildingClick = (buildingId: string) => {
    console.log('Building clicked:', buildingId);
    setSelectedBuildingId(buildingId);
    setLocationCardOpen(true);
  };

  // Handle closing the location card
  const handleCloseLocationCard = () => {
    setLocationCardOpen(false);
    setSelectedBuildingId(null);
  };

  // Handle adding a contact from LocationCard
  const handleAddContact = (addressId?: string, addressText?: string) => {
    setSelectedAddressId(addressId);
    setSelectedAddressText(addressText);
    setCreateContactOpen(true);
  };

  // Handle contact creation success
  const handleContactCreated = () => {
    setCreateContactOpen(false);
    setSelectedAddressId(undefined);
    setSelectedAddressText(undefined);
    // Refresh the location card data
    if (selectedBuildingId) {
      // Force re-render by toggling
      const currentId = selectedBuildingId;
      setSelectedBuildingId(null);
      setTimeout(() => setSelectedBuildingId(currentId), 100);
    }
  };

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

      // Helper to get initial center from addresses (GeoJSON-first approach)
      const getInitialCenter = (): [number, number] => {
        if (addresses.length > 0) {
          const addr = addresses[0];
          
          // Try direct coordinate first
          if (addr.coordinate) {
            return [addr.coordinate.lon, addr.coordinate.lat];
          }
          
          // GeoJSON-first: Check geometry field (type assertion for view fields)
          const addrWithGeo = addr as CampaignAddress & { geometry?: any; geom_json?: any };
          let geometry = addrWithGeo.geometry;
          if (typeof geometry === 'string') {
            try {
              geometry = JSON.parse(geometry);
            } catch {
              // Not valid JSON
            }
          }
          
          if (geometry && typeof geometry === 'object' && geometry.type === 'Point') {
            const coords = geometry.coordinates;
            if (Array.isArray(coords) && coords.length >= 2) {
              const [lon, lat] = coords;
                  if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
                    return [lon, lat];
                  }
                }
          }
          
          // Fallback: Check geom_json
          if (addrWithGeo.geom_json && typeof addrWithGeo.geom_json === 'object' && addrWithGeo.geom_json.type === 'Point') {
            const coords = addrWithGeo.geom_json.coordinates;
            if (Array.isArray(coords) && coords.length >= 2) {
              const [lon, lat] = coords;
                  if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
                    return [lon, lat];
                  }
            }
          }
        }
        return [-79.3832, 43.6532]; // Toronto default
      };

      const styleMap: Record<MapMode, string> = {
        light: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
        dark: 'mapbox://styles/flyrpro/cmie0fu21003001qt912a9r5s', // Dark 3D Style
        satellite: 'mapbox://styles/mapbox/satellite-v9',
      };

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: styleMap[mapMode],
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
                    map.current?.removeLayer(layer.id);
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

    // GeoJSON-first helper: Extract coordinates from GeoJSON geometry
    // Addresses from campaign_addresses_geojson view should already be GeoJSON
    const getCoordinate = (address: CampaignAddress): { lon: number; lat: number } | null => {
      // First try direct coordinate (backward compatibility)
      if (address.coordinate) {
        return address.coordinate;
      }
      
      // GeoJSON-first: Check for geometry field (from campaign_addresses_geojson view)
      // Type assertion needed because CampaignAddress type doesn't include view fields
      const addrWithGeo = address as CampaignAddress & { geometry?: any; geom_json?: any };
      let geometry = addrWithGeo.geometry;
      
      // If geometry is a string, parse it
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          // Not valid JSON, try next option
        }
      }
      
      // Extract coordinates from GeoJSON Point
      if (geometry && typeof geometry === 'object') {
        if (geometry.type === 'Point' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
          const [lon, lat] = geometry.coordinates;
          if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
                  return { lon, lat };
                }
              }
            }
            
      // Fallback: Check geom_json field (from view)
      if (addrWithGeo.geom_json && typeof addrWithGeo.geom_json === 'object' && addrWithGeo.geom_json.type === 'Point') {
        const coords = addrWithGeo.geom_json.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const [lon, lat] = coords;
          if (typeof lon === 'number' && typeof lat === 'number' && !isNaN(lon) && !isNaN(lat)) {
              return { lon, lat };
            }
          }
        }

        return null;
    };

    // Fit bounds to show all addresses - buildings are shown via fill extrusions from MapBuildingsLayer
    if (addresses.length > 0) {
      const addressesWithCoords = addresses
        .map(addr => getCoordinate(addr))
        .filter((coord): coord is { lon: number; lat: number } => coord !== null);

      if (addressesWithCoords.length > 0 && !boundsFittedRef.current) {
        // Use setTimeout to ensure map is fully ready
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
        }, 200);
      }
    }

    // Buildings are handled by MapBuildingsLayer component which provides fill extrusions

    // Cleanup on unmount or address change
    return () => {
      boundsFittedRef.current = false; // Reset when addresses change
    };
  }, [mapLoaded, addresses]);

  // Handle map style changes when mapMode changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const styleMap: Record<MapMode, string> = {
      light: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
      dark: 'mapbox://styles/flyrpro/cmie0fu21003001qt912a9r5s', // Dark 3D Style
      satellite: 'mapbox://styles/mapbox/satellite-v9',
    };

    try {
      map.current.setStyle(styleMap[mapMode]);
    } catch (err) {
      console.error('Error setting map style:', err);
    }

    // Hide building layers and clean up problematic layers after style loads
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
                map.current?.removeLayer(layer.id);
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

    map.current.once('style.load', () => {
      cleanupLayers();
    });
  }, [mapMode, mapLoaded]);

  // Auto-set pitch for 3D view (fill-extrusion buildings look better with pitch)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    
    // Set pitch to 60° for better 3D building visualization
    map.current.easeTo({
      pitch: 60,
      duration: 1000,
    });
  }, [mapLoaded]);

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainer} className="h-full w-full" />
      {map.current && mapLoaded && (
        <>
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            <MapModeToggle mode={mapMode} onModeChange={setMapMode} />
            <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
          </div>
          <MapBuildingsLayer 
            map={map.current} 
            campaignId={campaignId}
            viewMode={viewMode}
            onBuildingClick={handleBuildingClick}
          />
          
          {/* Location Card - floating card when building is clicked */}
          {locationCardOpen && selectedBuildingId && (
            <div className="absolute bottom-6 left-4 z-20">
              <LocationCard
                gersId={selectedBuildingId}
                campaignId={campaignId}
                onClose={handleCloseLocationCard}
                onAddContact={handleAddContact}
              />
            </div>
          )}
        </>
      )}
      
      {/* Create Contact Dialog */}
      {userId && (
        <CreateContactDialog
          open={createContactOpen}
          onClose={() => {
            setCreateContactOpen(false);
            setSelectedAddressId(undefined);
            setSelectedAddressText(undefined);
          }}
          onSuccess={handleContactCreated}
          userId={userId}
          initialAddress={selectedAddressText}
          initialAddressId={selectedAddressId}
          initialCampaignId={campaignId}
        />
      )}
    </div>
  );
}

