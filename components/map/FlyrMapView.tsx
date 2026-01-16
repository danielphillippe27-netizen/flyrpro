'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapModeToggle } from './MapModeToggle';
import { BuildingLayers } from './BuildingLayers';
import { MapControls } from './MapControls';
import { ThreeDToggle } from './ThreeDToggle';
import { OrientHousesButton } from './OrientHousesButton';
import { AddressOrientationPanel } from './AddressOrientationPanel';
import { HouseDetailPanel } from './HouseDetailPanel';
import { Button } from '@/components/ui/button';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignV2, CampaignAddress } from '@/types/database';

type MapMode = 'light' | 'dark' | 'satellite';

export function FlyrMapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('light');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignV2 | null>(null);
  const [campaignAddresses, setCampaignAddresses] = useState<CampaignAddress[]>([]);
  const [show3DBuildings, setShow3DBuildings] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<CampaignAddress | null>(null);
  const [orientationPanelOpen, setOrientationPanelOpen] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [housePanelOpen, setHousePanelOpen] = useState(false);
  const boundsFittedRef = useRef(false);

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
          style: 'mapbox://styles/flyrpro/cmie253op00fa01qmgiri8lcb', // Light 3D Style
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
      setError(`Failed to load map style: ${err instanceof Error ? err.message : String(err)}`);
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

    map.current.once('style.load', () => {
      cleanupLayers();
    });
  }, [mapMode, mapLoaded]);

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
      boundsFittedRef.current = false;
      return;
    }

    try {
      const [campaign, addresses] = await Promise.all([
        CampaignsService.fetchCampaign(selectedCampaignId),
        CampaignsService.fetchAddresses(selectedCampaignId),
      ]);
      
      setSelectedCampaign(campaign);
      setCampaignAddresses(addresses || []);
      boundsFittedRef.current = false; // Reset bounds fitting for new campaign
    } catch (error) {
      console.error('Error fetching campaign data:', error);
      setSelectedCampaign(null);
      setCampaignAddresses([]);
    }
  };

  useEffect(() => {
    fetchCampaignData();
  }, [selectedCampaignId]);

  // Refresh handler for orientation completion
  const handleOrientationComplete = () => {
    if (selectedCampaignId) {
      fetchCampaignData();
    }
  };

  // Handle marker click (legacy address-based)
  const handleMarkerClick = (addressId: string) => {
    const address = campaignAddresses.find((addr) => addr.id === addressId);
    if (address) {
      setSelectedAddress(address);
      setOrientationPanelOpen(true);
    }
  };

  // Handle building click (Gold Standard: building UUID)
  const handleBuildingClick = (buildingId: string) => {
    setSelectedBuildingId(buildingId);
    setHousePanelOpen(true);
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

  // Fit map bounds to campaign addresses
  useEffect(() => {
    if (!map.current || !mapLoaded || campaignAddresses.length === 0 || boundsFittedRef.current) return;

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
  }, [campaignAddresses, mapLoaded]);


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
      {mapLoaded && map.current && !error && (
        <>
          <OrientHousesButton 
            campaignId={selectedCampaignId} 
            onComplete={handleOrientationComplete}
          />
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            <MapModeToggle mode={mapMode} onModeChange={setMapMode} />
            <ThreeDToggle enabled={show3DBuildings} onToggle={setShow3DBuildings} />
            {show3DBuildings && !selectedCampaignId && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-yellow-50/90 text-xs text-yellow-700 hover:bg-yellow-50/95 h-auto py-1 px-2 text-center border border-yellow-200"
                disabled
              >
                Select a campaign to see 3D buildings
              </Button>
            )}
            {show3DBuildings && selectedCampaignId && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-white/90 text-xs text-gray-600 hover:bg-white/95 h-auto py-1 px-2 text-center"
                disabled
              >
                Press Control to change angle
              </Button>
            )}
            <MapControls 
              onCampaignSelect={setSelectedCampaignId} 
              selectedCampaignId={selectedCampaignId}
              selectedCampaignName={selectedCampaign?.name || null}
            />
          </div>
          {show3DBuildings && (
            <BuildingLayers 
              map={map.current} 
              campaignId={selectedCampaignId}
              onMarkerClick={handleMarkerClick}
              onBuildingClick={handleBuildingClick}
            />
          )}
        </>
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
      <HouseDetailPanel
        buildingId={selectedBuildingId}
        open={housePanelOpen}
        onClose={() => {
          setHousePanelOpen(false);
          setSelectedBuildingId(null);
        }}
        onUpdate={handleOrientationUpdate}
      />
    </div>
  );
}

