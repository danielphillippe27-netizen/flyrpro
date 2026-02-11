'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { CampaignMarkersLayer } from './CampaignMarkersLayer';
import { MapBuildingsLayer } from './MapBuildingsLayer';
import { MapInfoButton } from './MapInfoButton';
import { RouteLayer } from './RouteLayer';
import { UserLocationLayer } from './UserLocationLayer';
import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddressOrientationPanel } from './AddressOrientationPanel';
import { HouseDetailPanel } from './HouseDetailPanel';
import { LocationCard } from './LocationCard';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { DEFAULT_STATUS_FILTERS, type StatusFilters } from '@/lib/constants/mapStatus';
import type { CampaignV2, CampaignAddress } from '@/types/database';

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

export function FlyrMapView() {
  const { theme } = useTheme();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [statusFilters, setStatusFilters] = useState<StatusFilters>(DEFAULT_STATUS_FILTERS);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignV2 | null>(null);
  const [campaignAddresses, setCampaignAddresses] = useState<CampaignAddress[]>([]);
  const [show3DBuildings, setShow3DBuildings] = useState(false);
  const [useFillExtrusion, setUseFillExtrusion] = useState(true);
  const [selectedAddress, setSelectedAddress] = useState<CampaignAddress | null>(null);
  const [orientationPanelOpen, setOrientationPanelOpen] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [housePanelOpen, setHousePanelOpen] = useState(false);
  const [locationCardOpen, setLocationCardOpen] = useState(false);
  const [createContactDialogOpen, setCreateContactDialogOpen] = useState(false);
  const [contactDialogData, setContactDialogData] = useState<{ address: string; addressId?: string; gersId?: string; campaignId?: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const boundsFittedRef = useRef(false);
  const [campaignBbox, setCampaignBbox] = useState<{ minLon: number; minLat: number; maxLon: number; maxLat: number } | null>(null);
  const [showUserLocation, setShowUserLocation] = useState(false);

  // Get user ID on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize map immediately
    const initMap = () => {
      if (!mapContainer.current) return;
      
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiZmx5cnBybyIsImEiOiJjbWd6dzZsbm0wYWE3ZWpvbjIwNGVteDV6In0.lvbLszJ7ADa_Cck3A8hZEQ';
        
        if (!token || !token.startsWith('pk.')) {
          throw new Error('Invalid Mapbox access token');
        }
        
        mapboxgl.accessToken = token;
        
        // Set worker URL to fix potential worker loading issues
        if (typeof window !== 'undefined') {
          mapboxgl.workerCount = 2;
        }

        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: MAP_STYLES[theme] ?? MAP_STYLES.light,
          center: [-79.3832, 43.6532], // Toronto default
          zoom: 12,
          pitch: 0,
          bearing: 0,
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
          
          // Resize after load to ensure proper rendering
          setTimeout(() => {
            map.current?.resize();
          }, 50);
        });

        map.current.on('error', (e) => {
          // Log full error details for debugging
          const errorDetails = {
            error: e.error,
            message: e.error?.message || String(e.error),
            type: e.type,
            target: e.target,
          };
          
          // Check if this is a non-critical source layer error
          const errorMessage = e.error?.message || String(e.error);
          const isSourceLayerError = errorMessage.includes('does not exist on source') || 
                                     errorMessage.includes('Source layer');
          
          if (isSourceLayerError) {
            // This is a style validation error - log but don't show to user
            // The map will still function, just without that specific layer
            console.warn('Mapbox style layer warning (non-critical):', errorDetails);
            
            // Try to remove the problematic layer after style loads
            if (map.current) {
              map.current.once('style.load', () => {
                try {
                  const style = map.current?.getStyle();
                  if (style && style.layers) {
                    // Find and remove layers that reference non-existent source layers
                    style.layers.forEach((layer) => {
                      if (layer.id && (
                        layer.id.includes('road-label') || 
                        layer.id.includes('road_label')
                      )) {
                        try {
                          map.current?.removeLayer(layer.id);
                          console.log(`Removed problematic layer: ${layer.id}`);
                        } catch (removeErr) {
                          // Layer might already be removed or not exist
                        }
                      }
                    });
                  }
                } catch (cleanupErr) {
                  // Ignore cleanup errors
                }
              });
            }
            return; // Don't set error state for non-critical issues
          }
          
          console.error('Mapbox error:', errorDetails);
          
          // Only show critical errors to the user
          setError(`Map error: ${errorMessage}`);
        });

        // Also listen for style loading errors
        map.current.on('style.loading', () => {
          console.log('Mapbox style loading...');
        });

        map.current.on('style.error', (e) => {
          console.error('Mapbox style error:', e);
          setError(`Style loading error: ${e.error?.message || 'Failed to load map style'}`);
        });

        // Handle data loading errors
        map.current.on('data', (e) => {
          if (e.dataType === 'error') {
            console.error('Mapbox data error:', e);
            setError(`Data loading error: ${e.error?.message || 'Failed to load map data'}`);
          }
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

  // Sync map style with app theme (light/dark)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const styleUrl = MAP_STYLES[theme] ?? MAP_STYLES.light;
    try {
      map.current.setStyle(styleUrl);
    } catch (err) {
      console.error('Error setting map style:', err);
      setError(`Failed to load map style: ${err instanceof Error ? err.message : String(err)}`);
    }

    const cleanupLayers = () => {
      if (!map.current) return;
      try {
        const style = map.current.getStyle();
        if (style?.layers) {
          style.layers.forEach((layer) => {
            if (layer.id.toLowerCase().includes('building')) {
              map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
            }
            if (layer.id && (layer.id.includes('road-label') || layer.id.includes('road_label'))) {
              try {
                map.current.removeLayer(layer.id);
              } catch {}
            }
          });
        }
      } catch {}
    };

    map.current.once('style.load', () => {
      cleanupLayers();
    });
  }, [theme, mapLoaded]);

  // Handle 3D view pitch and bearing
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (show3DBuildings) {
      map.current.setPitch(60);
      map.current.setBearing(-17.6);
    } else {
      map.current.setPitch(0);
      map.current.setBearing(0);
    }
  }, [show3DBuildings, mapLoaded]);

  // Fetch campaign data and addresses when selectedCampaignId changes
  const fetchCampaignData = async () => {
    if (!selectedCampaignId) {
      setSelectedCampaign(null);
      setCampaignAddresses([]);
      setCampaignBbox(null);
      boundsFittedRef.current = false;
      return;
    }

    try {
      const [campaign, addresses, bbox] = await Promise.all([
        CampaignsService.fetchCampaign(selectedCampaignId),
        CampaignsService.fetchAddresses(selectedCampaignId),
        CampaignsService.fetchCampaignBoundingBox(selectedCampaignId),
      ]);
      
      setSelectedCampaign(campaign);
      setCampaignAddresses(addresses || []);
      setCampaignBbox(bbox);
      boundsFittedRef.current = false; // Reset bounds fitting for new campaign
    } catch (error) {
      console.error('Error fetching campaign data:', error);
      setSelectedCampaign(null);
      setCampaignAddresses([]);
      setCampaignBbox(null);
    }
  };

  useEffect(() => {
    fetchCampaignData();
  }, [selectedCampaignId]);

  // Fit camera to campaign bounding box when campaign is selected and map is loaded
  useEffect(() => {
    if (!map.current || !mapLoaded || !selectedCampaignId || !campaignBbox || boundsFittedRef.current) return;

    setTimeout(() => {
      if (!map.current || boundsFittedRef.current) return;
      
      const bounds = new mapboxgl.LngLatBounds(
        [campaignBbox.minLon, campaignBbox.minLat],
        [campaignBbox.maxLon, campaignBbox.maxLat]
      );
      
      boundsFittedRef.current = true;
      map.current.fitBounds(bounds, {
        padding: 100,
        maxZoom: 18,
        duration: 1000, // Smooth animation
      });
    }, 100);
  }, [selectedCampaignId, campaignBbox, mapLoaded]);


  // Handle marker click (legacy address-based)
  const handleMarkerClick = (addressId: string) => {
    const address = campaignAddresses.find((addr) => addr.id === addressId);
    if (address) {
      setSelectedAddress(address);
      setOrientationPanelOpen(true);
    }
  };

  // Handle building click (Gold Standard: building UUID)
  const handleAddToCRM = (data: { address: string; addressId?: string; gersId?: string; campaignId?: string }) => {
    setContactDialogData(data);
    setCreateContactDialogOpen(true);
  };

  const handleBuildingClick = (buildingId: string, addressId?: string) => {
    setSelectedBuildingId(buildingId);
    setSelectedAddressId(addressId ?? null);
    setLocationCardOpen(true);
  };

  // Open detailed panel (from LocationCard "Log Visit" action)
  const handleOpenDetailPanel = () => {
    setLocationCardOpen(false);
    setHousePanelOpen(true);
  };

  // Handle navigate action from LocationCard
  const handleNavigateToBuilding = () => {
    // Could open Google Maps or Apple Maps with the address
    // For now, just log - can be expanded later
    console.log('Navigate to building:', selectedBuildingId);
  };

  // Handle adding contact from LocationCard
  const handleAddContactFromCard = () => {
    if (selectedBuildingId && selectedCampaignId) {
      setContactDialogData({
        address: '',
        gersId: selectedBuildingId,
        campaignId: selectedCampaignId,
      });
      setCreateContactDialogOpen(true);
    }
  };

  // Handle orientation panel update
  const handleOrientationUpdate = () => {
    if (selectedCampaignId) {
      fetchCampaignData();
    }
  };

  // Helper function to extract coordinates from CampaignAddress
  const getCoordinate = (address: CampaignAddress): { lon: number; lat: number } | null => {
    // First try direct coordinate
    if (address.coordinate) {
      return address.coordinate;
    }
    
    // Try parsing from geom (PostGIS geometry)
    if (address.geom) {
      try {
        // Check if it's already an object
        let geom = typeof address.geom === 'string' ? address.geom : JSON.stringify(address.geom);
        
        // Try to parse as JSON first
        try {
          const parsed = JSON.parse(geom);
          if (parsed && parsed.coordinates) {
            // PostGIS Point: [lon, lat]
            if (Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
              return { lon: parsed.coordinates[0], lat: parsed.coordinates[1] };
            }
          }
        } catch (jsonError) {
          // Not valid JSON - might be WKT or PostGIS binary format
          // Try to extract coordinates from WKT format like "POINT(lon lat)"
          const wktMatch = geom.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
          if (wktMatch) {
            return { lon: parseFloat(wktMatch[1]), lat: parseFloat(wktMatch[2]) };
          }
          // If it's already an object with coordinates
          if (typeof address.geom === 'object' && address.geom.coordinates) {
            const coords = address.geom.coordinates;
            if (Array.isArray(coords) && coords.length >= 2) {
              return { lon: coords[0], lat: coords[1] };
            }
          }
        }
      } catch (e) {
        // Silently skip invalid geometries - don't spam console
        // console.warn('Failed to parse geometry for address:', address.id, e);
      }
    }
    
    return null;
  };

  // Fit map bounds to campaign addresses when campaign is selected
  useEffect(() => {
    if (!map.current || !mapLoaded || !selectedCampaignId || campaignAddresses.length === 0 || boundsFittedRef.current) return;

    const addressesWithCoords = campaignAddresses
      .map(addr => getCoordinate(addr))
      .filter((coord): coord is { lon: number; lat: number } => coord !== null);

    if (addressesWithCoords.length > 0) {
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
      }, 200); // Small delay to ensure map is ready
    }
  }, [selectedCampaignId, campaignAddresses, mapLoaded]);


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
      <MapInfoButton show={mapLoaded && !error} />
      {mapLoaded && map.current && !error && useFillExtrusion && (
        <>
          <MapBuildingsLayer 
            map={map.current} 
            campaignId={selectedCampaignId}
            statusFilters={statusFilters}
            onBuildingClick={handleBuildingClick}
            onAddToCRM={handleAddToCRM}
          />
          <RouteLayer 
            map={map.current}
            campaignId={selectedCampaignId}
          />
          <CampaignMarkersLayer
            map={map.current}
            mapLoaded={mapLoaded}
            userId={userId}
            selectedCampaignId={selectedCampaignId}
            onCampaignSelect={setSelectedCampaignId}
          />
          <UserLocationLayer
            map={map.current}
            mapLoaded={mapLoaded}
            showUserLocation={showUserLocation}
            onLocationFound={(lng, lat) => {
              map.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
            }}
            onLocationError={(err) => {
              console.warn('Geolocation error:', err.message);
            }}
          />
        </>
      )}
      {mapLoaded && !error && (
        <div className="absolute top-14 left-3 z-10">
          <Button
            variant="secondary"
            size="icon"
            className={`h-9 w-9 rounded-full shadow-md border ${
              showUserLocation
                ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700'
            }`}
            onClick={() => setShowUserLocation((v) => !v)}
            aria-label="Show my location"
            title="My location"
          >
            <LocateFixed className={`h-5 w-5 ${showUserLocation ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={2.5} />
          </Button>
        </div>
      )}
      <AddressOrientationPanel
        address={selectedAddress}
        open={orientationPanelOpen}
        onClose={() => {
          setOrientationPanelOpen(false);
          setSelectedAddress(null);
        }}
        onUpdate={handleOrientationUpdate}
      />
      
      {/* Location Card - floating card on map when building is clicked */}
      {locationCardOpen && selectedBuildingId && selectedCampaignId && (
        <div className="absolute bottom-6 left-4 z-20">
          <LocationCard
            gersId={selectedBuildingId}
            campaignId={selectedCampaignId}
            preferredAddressId={selectedAddressId}
            onSelectAddress={(id) => setSelectedAddressId(id ?? null)}
            onClose={() => {
              setLocationCardOpen(false);
              setSelectedBuildingId(null);
              setSelectedAddressId(null);
            }}
            onNavigate={handleNavigateToBuilding}
            onLogVisit={handleOpenDetailPanel}
            onAddContact={handleAddContactFromCard}
          />
        </div>
      )}

      <HouseDetailPanel
        buildingId={selectedBuildingId}
        open={housePanelOpen}
        onClose={() => {
          setHousePanelOpen(false);
          setSelectedBuildingId(null);
        }}
        onUpdate={handleOrientationUpdate}
      />
      {userId && (
        <CreateContactDialog
          open={createContactDialogOpen}
          onClose={() => {
            setCreateContactDialogOpen(false);
            setContactDialogData(null);
          }}
          onSuccess={() => {
            setCreateContactDialogOpen(false);
            setContactDialogData(null);
            // Optionally refresh map data or show success message
          }}
          userId={userId}
          initialAddress={contactDialogData?.address}
          initialAddressId={contactDialogData?.addressId}
          initialCampaignId={contactDialogData?.campaignId}
        />
      )}
    </div>
  );
}

