'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as turf from '@turf/turf';
import { Maximize2, Minimize2 } from 'lucide-react';
import Lottie from 'lottie-react';
import type { CampaignAddress, CampaignV2, CampaignParcel } from '@/types/database';
import { MapBuildingsLayer, type MapBuildingsRenderState } from '@/components/map/MapBuildingsLayer';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { LocationCard } from '@/components/map/LocationCard';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import {
  DEFAULT_STATUS_FILTERS,
  MAP_STATUS_CONFIG,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import { useFullscreen } from '@/lib/hooks/useFullscreen';

const PARCEL_SOURCE_ID = 'campaign-parcels';
const PARCEL_FILL_LAYER = 'campaign-parcels-fill';
const PARCEL_LINE_LAYER = 'campaign-parcels-line';

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

const BOUNDARY_SOURCE_RAW = 'campaign-boundary-raw';
const BOUNDARY_SOURCE_SNAPPED = 'campaign-boundary-snapped';
const BOUNDARY_LAYER_RAW_FILL = 'campaign-boundary-raw-fill';
const BOUNDARY_LAYER_RAW_LINE = 'campaign-boundary-raw-line';
const BOUNDARY_LAYER_SNAPPED_FILL = 'campaign-boundary-snapped-fill';
const BOUNDARY_LAYER_SNAPPED_LINE = 'campaign-boundary-snapped-line';
const CUSTOM_BUILDING_LAYER_PREFIXES = ['map-buildings-', 'campaign-parcels'];

type BuildingPendingOverlayConfig = {
  title: string;
  description: string;
};

/** Safe getLayer: avoid "getOwnLayer of undefined" during style transition or when map is hidden (e.g. tab switch). */
function safeGetLayer(m: mapboxgl.Map, layerId: string): boolean {
  try {
    if (!m.isStyleLoaded()) return false;
    return !!m.getLayer(layerId);
  } catch {
    return false;
  }
}

/** Safe getSource: avoid "getOwnSource of undefined" during style transition or cleanup after map removal. */
function safeGetSource(m: mapboxgl.Map, sourceId: string): boolean {
  try {
    if (!m.isStyleLoaded()) return false;
    return !!m.getSource(sourceId);
  } catch {
    return false;
  }
}

function isCustomBuildingLayer(layerId: string): boolean {
  return CUSTOM_BUILDING_LAYER_PREFIXES.some((prefix) => layerId.startsWith(prefix));
}

function getAddressCoordinate(address: CampaignAddress): { lon: number; lat: number } | null {
  if (address.coordinate) {
    return address.coordinate;
  }

  const addressWithGeo = address as CampaignAddress & {
    geometry?: unknown;
    geom_json?: { type?: string; coordinates?: number[] };
  };

  if (
    addressWithGeo.geom_json?.type === 'Point' &&
    Array.isArray(addressWithGeo.geom_json.coordinates) &&
    addressWithGeo.geom_json.coordinates.length >= 2
  ) {
    const [lon, lat] = addressWithGeo.geom_json.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
      return { lon, lat };
    }
  }

  let geometry = addressWithGeo.geometry;
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry) as { type?: string; coordinates?: number[] };
    } catch {
      geometry = null;
    }
  }

  const geometryPoint = geometry as { type?: string; coordinates?: number[] } | null;
  if (
    geometryPoint?.type === 'Point' &&
    Array.isArray(geometryPoint.coordinates) &&
    geometryPoint.coordinates.length >= 2
  ) {
    const [lon, lat] = geometryPoint.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
      return { lon, lat };
    }
  }

  if (address.geom) {
    try {
      const geomValue = typeof address.geom === 'string' ? address.geom : JSON.stringify(address.geom);

      try {
        const parsed = JSON.parse(geomValue) as { coordinates?: number[] };
        if (Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
          const [lon, lat] = parsed.coordinates;
          if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
            return { lon, lat };
          }
        }
      } catch {
        const wktMatch = geomValue.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (wktMatch) {
          return { lon: parseFloat(wktMatch[1]), lat: parseFloat(wktMatch[2]) };
        }
      }
    } catch {
      // Ignore malformed geometry values and fall through to null.
    }
  }

  return null;
}

export function CampaignDetailMapView({
  campaignId,
  addresses,
  campaign,
  onSnapComplete,
  renderLocationCardExtra,
  buildingPendingOverlay,
}: {
  campaignId: string;
  addresses: CampaignAddress[];
  campaign?: CampaignV2 | null;
  onSnapComplete?: () => void;
  renderLocationCardExtra?: (args: {
    selectedBuildingId: string;
    selectedAddressId?: string | null;
    campaignId: string;
  }) => ReactNode;
  buildingPendingOverlay?: BuildingPendingOverlayConfig;
}) {
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const mapShellRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { isFullscreen: isMapFullscreen, toggle: toggleMapFullscreen } = useFullscreen(mapShellRef);
  const [statusFilters, setStatusFilters] = useState<StatusFilters>(DEFAULT_STATUS_FILTERS);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [buildingsRenderState, setBuildingsRenderState] = useState<MapBuildingsRenderState>({
    isFetching: false,
    hasData: false,
    hasVisibleFeatures: false,
    featureCount: 0,
    visibleFeatureCount: 0,
    zoomLevel: 15,
  });
  const [showBuildingPendingOverlay, setShowBuildingPendingOverlay] = useState(false);
  const boundsFittedRef = useRef(false);
  const initAttemptedRef = useRef(false);
  const hasRenderedBuildingsRef = useRef(false);
  
  // Location Card state
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedAddressIdForCard, setSelectedAddressIdForCard] = useState<string | null>(null);
  const [locationCardOpen, setLocationCardOpen] = useState(false);
  
  // Create Contact Dialog state
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | undefined>(undefined);
  const [selectedAddressText, setSelectedAddressText] = useState<string | undefined>(undefined);
  const [selectedContactNotes, setSelectedContactNotes] = useState<string | undefined>(undefined);

  // Map view: 3D buildings vs 3D address points (circular fill-extrusions)
  const [mapViewMode, setMapViewMode] = useState<'buildings' | 'addresses'>('buildings');
  // Boundary: Snap to Roads and Raw vs Snapped toggle
  const [snapping, setSnapping] = useState(false);
  // Parcels layer toggle
  const [parcels, setParcels] = useState<CampaignParcel[]>([]);
  const [showParcels, setShowParcels] = useState(false);
  const [parcelsLoading, setParcelsLoading] = useState(false);
  const lottieSrc = useMemo(
    () => (theme === 'dark' ? '/loading/white.json' : '/loading/black.json'),
    [theme]
  );
  const handleBuildingsRenderStateChange = useCallback((state: MapBuildingsRenderState) => {
    setBuildingsRenderState(state);
  }, []);

  // Get user ID on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!buildingPendingOverlay) return;

    let cancelled = false;
    fetch(lottieSrc)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setLoadingAnimationData(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [buildingPendingOverlay, lottieSrc]);

  useEffect(() => {
    if (buildingsRenderState.hasVisibleFeatures) {
      hasRenderedBuildingsRef.current = true;
      setShowBuildingPendingOverlay(false);
    }
  }, [buildingsRenderState.hasVisibleFeatures]);

  useEffect(() => {
    hasRenderedBuildingsRef.current = false;
    setBuildingsRenderState({
      isFetching: false,
      hasData: false,
      hasVisibleFeatures: false,
      featureCount: 0,
      visibleFeatureCount: 0,
      zoomLevel: 15,
    });
    setShowBuildingPendingOverlay(false);
  }, [campaignId]);

  // Fetch parcels for this campaign
  useEffect(() => {
    if (!campaignId) return;
    
    const fetchParcels = async () => {
      setParcelsLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('campaign_parcels')
        .select('*')
        .eq('campaign_id', campaignId);
      
      if (!error && data) {
        setParcels(data);
      }
      setParcelsLoading(false);
    };
    
    fetchParcels();
  }, [campaignId]);

  // Handle building click - opens LocationCard
  // For unit slices, addressId is passed to show specific unit
  const handleBuildingClick = (buildingId: string, addressId?: string) => {
    console.log('Building clicked:', { buildingId, addressId });
    setSelectedBuildingId(buildingId);
    setSelectedAddressIdForCard(addressId || null);
    setLocationCardOpen(true);
  };

  // Handle closing the location card
  const handleCloseLocationCard = () => {
    setLocationCardOpen(false);
    setSelectedBuildingId(null);
    setSelectedAddressIdForCard(null);
  };

  // Handle adding a contact from LocationCard
  const handleAddContact = (addressId?: string, addressText?: string, notes?: string) => {
    setSelectedAddressId(addressId);
    setSelectedAddressText(addressText);
    setSelectedContactNotes(notes);
    setCreateContactOpen(true);
  };

  // Handle contact creation success
  const handleContactCreated = () => {
    setCreateContactOpen(false);
    setSelectedAddressId(undefined);
    setSelectedAddressText(undefined);
    setSelectedContactNotes(undefined);
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
      const token = getMapboxToken();
      mapboxgl.accessToken = token;

      // Helper to get initial center from addresses (GeoJSON-first approach)
      const getInitialCenter = (): [number, number] => {
        if (addresses.length > 0) {
          const addr = addresses[0];
          const coordinate = getAddressCoordinate(addr);
          if (coordinate) {
            return [coordinate.lon, coordinate.lat];
          }
        }
        return [-79.3832, 43.6532]; // Toronto default
      };

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: MAP_STYLES[theme] ?? MAP_STYLES.light,
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
                  if (!isCustomBuildingLayer(layer.id)) {
                    map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
                  }
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

  // Keep Mapbox canvas in sync with container size (sidebar collapse/expand, viewport changes).
  useEffect(() => {
    if (!mapLoaded || !map.current || !mapContainer.current) return;

    const mapInstance = map.current;
    const container = mapContainer.current;
    let frameId: number | null = null;

    const resizeMap = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        try {
          mapInstance.resize();
        } catch {
          // Ignore transient resize errors during style swaps/unmount.
        }
      });
    };

    const observer = new ResizeObserver(() => {
      resizeMap();
    });
    observer.observe(container);

    window.addEventListener('resize', resizeMap);
    window.addEventListener('orientationchange', resizeMap);
    resizeMap();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeMap);
      window.removeEventListener('orientationchange', resizeMap);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    // Extract lon/lat from campaign_addresses_geojson: coordinate, then geom_json (Point), then geometry
    // Fit bounds to show all addresses - buildings are shown via fill extrusions from MapBuildingsLayer
    if (addresses.length > 0) {
      const addressesWithCoords = addresses
        .map(addr => getAddressCoordinate(addr))
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
              padding: {
                top: 72,
                right: 40,
                bottom: 24,
                left: 40,
              },
              maxZoom: 18,
              duration: 1000,
            });

            map.current.once('moveend', () => {
              if (!map.current) return;
              if (map.current.getZoom() >= 12) return;

              map.current.easeTo({
                zoom: 12,
                duration: 300,
              });
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

  const addressPointsSourceId = 'campaign-address-points';
  const addressPointsLayerId = 'campaign-address-points-extrusion';

  // Addresses view: circular fill-extrusion points, same status highlighting as buildings
  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    // Same as bounds effect: coordinate, then geom_json (Point from campaign_addresses_geojson), then geometry
    const buildAddressPointsGeoJSON = (): GeoJSON.FeatureCollection | null => {
      const radiusMeters = 2.5;
      const steps = 24;
      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
      for (const addr of addresses) {
        const coord = getAddressCoordinate(addr);
        if (!coord) continue;
        const center = [coord.lon, coord.lat] as [number, number];
        const circle = turf.circle(center, radiusMeters / 1000, { units: 'kilometers', steps });
        const poly = circle.geometry;
        if (poly.type !== 'Polygon') continue;
        const scansTotal = addr.scans ?? 0;
        const qrScanned = scansTotal > 0 || !!addr.last_scanned_at;
        const addressStatus = getCampaignAddressMapStatus(addr);
        features.push({
          type: 'Feature',
          geometry: poly,
          properties: {
            feature_id: addr.id,
            address_id: addr.id,
            address_status: addressStatus,
            scans_total: scansTotal,
            qr_scanned: qrScanned,
          },
        });
      }
      if (features.length === 0) return null;
      return { type: 'FeatureCollection', features };
    };

    // Address map colors: address_statuses — green = delivered, blue = talked | appointment, purple = QR scanned
    const getColorExpression = (): any => {
      const getAddressStatus = () => ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none'];
      const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
      const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];
      const isQrScanned = ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
      const isConversation = ['in', getAddressStatus(), ['literal', ['talked', 'appointment']]];
      const isTouched = ['==', getAddressStatus(), 'delivered'];
      const isUntouched = [
        'all',
        ['!=', getAddressStatus(), 'delivered'],
        ['!', ['in', getAddressStatus(), ['literal', ['talked', 'appointment']]]],
        ['!', isQrScanned],
      ];
      return [
        'case',
        ['all', isQrScanned, statusFilters.QR_SCANNED],
        MAP_STATUS_CONFIG.QR_SCANNED.color,
        ['all', isConversation, statusFilters.CONVERSATIONS],
        MAP_STATUS_CONFIG.CONVERSATIONS.color,
        ['all', isTouched, statusFilters.TOUCHED],
        MAP_STATUS_CONFIG.TOUCHED.color,
        ['all', isUntouched, statusFilters.UNTOUCHED],
        MAP_STATUS_CONFIG.UNTOUCHED.color,
        '#6b7280',
      ] as any;
    };

    const addAddressPointsLayer = () => {
      if (!mapInstance.isStyleLoaded()) return;
      const geo = buildAddressPointsGeoJSON();
      if (!geo || geo.features.length === 0) return;
      try {
        const existingSource = mapInstance.getSource(addressPointsSourceId);
        if (existingSource && 'setData' in existingSource) {
          (existingSource as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existingSource) {
          mapInstance.addSource(addressPointsSourceId, {
            type: 'geojson',
            data: geo,
            promoteId: 'feature_id',
          });
        }
        if (!safeGetLayer(mapInstance, addressPointsLayerId)) {
          mapInstance.addLayer({
            id: addressPointsLayerId,
            type: 'fill-extrusion',
            source: addressPointsSourceId,
            minzoom: 12,
            paint: {
              'fill-extrusion-color': getColorExpression(),
              'fill-extrusion-height': 7.5,
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 1,
              'fill-extrusion-vertical-gradient': true,
            },
          });
        } else {
          mapInstance.setPaintProperty(addressPointsLayerId, 'fill-extrusion-color', getColorExpression());
        }
      } catch (err) {
        console.error('[CampaignDetailMapView] Error adding address points layer:', err);
      }
    };

    const removeAddressPointsLayer = () => {
      try {
        if (safeGetLayer(mapInstance, addressPointsLayerId)) mapInstance.removeLayer(addressPointsLayerId);
        if (safeGetSource(mapInstance, addressPointsSourceId)) mapInstance.removeSource(addressPointsSourceId);
      } catch (_) {}
    };

    const onAddressPointClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f?.properties) return;
      const addressId = f.properties.address_id as string | undefined;
      const gersId = (f.properties.gers_id as string | undefined) ?? addressId;
      if (addressId && handleBuildingClick) handleBuildingClick(gersId ?? addressId, addressId);
    };

    if (mapViewMode !== 'addresses') {
      removeAddressPointsLayer();
      return;
    }

    if (addresses.length === 0) {
      removeAddressPointsLayer();
      return;
    }

    if (mapInstance.isStyleLoaded()) {
      addAddressPointsLayer();
    } else {
      mapInstance.once('style.load', addAddressPointsLayer);
    }

    mapInstance.off('click', addressPointsLayerId, onAddressPointClick);
    mapInstance.on('click', addressPointsLayerId, onAddressPointClick);

    return () => {
      mapInstance.off('click', addressPointsLayerId, onAddressPointClick);
      removeAddressPointsLayer();
    };
  }, [mapViewMode, mapLoaded, addresses, statusFilters, theme]);

  // Sync map style with app theme (light/dark)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const styleUrl = MAP_STYLES[theme] ?? MAP_STYLES.light;
    try {
      map.current.setStyle(styleUrl);
    } catch (err) {
      console.error('Error setting map style:', err);
    }

    const cleanupLayers = () => {
      if (!map.current) return;
      try {
        if (!map.current.isStyleLoaded()) return;
        const style = map.current.getStyle();
        if (style?.layers) {
          style.layers.forEach((layer) => {
            try {
              if (layer.id?.toLowerCase().includes('building')) {
                if (!isCustomBuildingLayer(layer.id)) {
                  map.current?.setLayoutProperty(layer.id, 'visibility', 'none');
                }
              }
              if (layer.id && (layer.id.includes('road-label') || layer.id.includes('road_label'))) {
                if (safeGetLayer(map.current!, layer.id)) map.current?.removeLayer(layer.id);
              }
            } catch {
              // Ignore per-layer errors during style cleanup (e.g. getOwnLayer of undefined)
            }
          });
        }
      } catch {}
    };

    map.current.once('style.load', () => {
      cleanupLayers();
    });
  }, [theme, mapLoaded]);

  // Auto-set pitch for 3D view (fill-extrusion buildings look better with pitch)
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    
    // Set pitch to 60° for better 3D building visualization
    map.current.easeTo({
      pitch: 60,
      duration: 1000,
    });
  }, [mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const resizeMap = () => {
      try {
        map.current?.resize();
      } catch {
        // Ignore transient resize errors while fullscreen state is changing.
      }
    };

    resizeMap();
    const timeoutId = window.setTimeout(resizeMap, 150);
    return () => window.clearTimeout(timeoutId);
  }, [isMapFullscreen, mapLoaded]);

  // Boundary layer: show territory_boundary (and optional raw/snapped) when campaign has map source
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !campaign?.territory_boundary) return;
    if (campaign.address_source !== 'map') return;

    const boundary = campaign.territory_boundary as GeoJSON.Polygon;
    const raw = campaign.campaign_polygon_raw as GeoJSON.Polygon | undefined;
    const snapped = campaign.campaign_polygon_snapped as GeoJSON.Polygon | undefined;
    const hasBoth = !!(raw && snapped);

    const removeBoundaryLayers = () => {
      [BOUNDARY_LAYER_RAW_FILL, BOUNDARY_LAYER_RAW_LINE, BOUNDARY_LAYER_SNAPPED_FILL, BOUNDARY_LAYER_SNAPPED_LINE].forEach((id) => {
        if (safeGetLayer(m, id)) m.removeLayer(id);
      });
      if (safeGetSource(m, BOUNDARY_SOURCE_RAW)) m.removeSource(BOUNDARY_SOURCE_RAW);
      if (safeGetSource(m, BOUNDARY_SOURCE_SNAPPED)) m.removeSource(BOUNDARY_SOURCE_SNAPPED);
    };

    if (!m.isStyleLoaded()) {
      m.once('style.load', () => {
        removeBoundaryLayers();
        addBoundaryLayers();
      });
      return () => {};
    }

    const addBoundaryLayers = () => {
      const polyToFeature = (p: GeoJSON.Polygon): GeoJSON.Feature<GeoJSON.Polygon> => ({
        type: 'Feature',
        geometry: p,
        properties: {},
      });

      if (hasBoth) {
        m.addSource(BOUNDARY_SOURCE_RAW, { type: 'geojson', data: polyToFeature(raw!) });
        m.addSource(BOUNDARY_SOURCE_SNAPPED, { type: 'geojson', data: polyToFeature(snapped!) });
        m.addLayer({ id: BOUNDARY_LAYER_RAW_FILL, type: 'fill', source: BOUNDARY_SOURCE_RAW, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.08 } });
        m.addLayer({
          id: BOUNDARY_LAYER_RAW_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_RAW,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ef4444',
            'line-width': 2,
            'line-opacity': 0.3,
            'line-dasharray': [1, 1.5],
          },
        });
        m.addLayer({ id: BOUNDARY_LAYER_SNAPPED_FILL, type: 'fill', source: BOUNDARY_SOURCE_SNAPPED, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 } });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 1 },
        });
      } else {
        m.addSource(BOUNDARY_SOURCE_SNAPPED, { type: 'geojson', data: polyToFeature(boundary) });
        m.addLayer({ id: BOUNDARY_LAYER_SNAPPED_FILL, type: 'fill', source: BOUNDARY_SOURCE_SNAPPED, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 } });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 1 },
        });
      }
    };

    removeBoundaryLayers();
    addBoundaryLayers();

    return () => {
      removeBoundaryLayers();
    };
  }, [mapLoaded, campaign?.id, campaign?.territory_boundary, campaign?.campaign_polygon_raw, campaign?.campaign_polygon_snapped, campaign?.address_source]);

  const hasMapBoundary = campaign?.address_source === 'map' && campaign?.territory_boundary;
  const hasRawAndSnapped = !!(campaign?.campaign_polygon_raw && campaign?.campaign_polygon_snapped);

  // Boundary line opacity: snapped emphasized (raw dimmed)
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !hasRawAndSnapped) return;
    if (!safeGetLayer(m, BOUNDARY_LAYER_RAW_LINE) || !safeGetLayer(m, BOUNDARY_LAYER_SNAPPED_LINE)) return;
    m.setPaintProperty(BOUNDARY_LAYER_RAW_LINE, 'line-opacity', 0.3);
    m.setPaintProperty(BOUNDARY_LAYER_SNAPPED_LINE, 'line-opacity', 1);
  }, [mapLoaded, hasRawAndSnapped]);

  // Parcels layer: show/hide when toggle changes
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;
    if (parcels.length === 0) return;

    const removeParcelsLayer = () => {
      if (safeGetLayer(m, PARCEL_FILL_LAYER)) m.removeLayer(PARCEL_FILL_LAYER);
      if (safeGetLayer(m, PARCEL_LINE_LAYER)) m.removeLayer(PARCEL_LINE_LAYER);
      if (safeGetSource(m, PARCEL_SOURCE_ID)) m.removeSource(PARCEL_SOURCE_ID);
    };

    const addParcelsLayer = () => {
      if (!m.isStyleLoaded()) return;
      
      // Convert parcels to GeoJSON
      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = parcels.map((parcel) => {
        const geom = typeof parcel.geom === 'string' 
          ? JSON.parse(parcel.geom) 
          : parcel.geom;
        return {
          type: 'Feature',
          geometry: geom,
          properties: {
            external_id: parcel.external_id,
            feature_type: parcel.properties?.FEATURE_TYPE || 'COMMON',
          },
        };
      });

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features,
      };

      try {
        m.addSource(PARCEL_SOURCE_ID, {
          type: 'geojson',
          data: geojson,
        });

        // Fill layer - subtle yellow/cream fill
        m.addLayer({
          id: PARCEL_FILL_LAYER,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          paint: {
            'fill-color': '#fbbf24',
            'fill-opacity': 0.1,
          },
        });

        // Line layer - amber outline
        m.addLayer({
          id: PARCEL_LINE_LAYER,
          type: 'line',
          source: PARCEL_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#f59e0b',
            'line-width': 1.5,
            'line-opacity': 0.7,
          },
        });
      } catch (err) {
        console.error('Error adding parcels layer:', err);
      }
    };

    if (!showParcels) {
      removeParcelsLayer();
      return;
    }

    if (m.isStyleLoaded()) {
      addParcelsLayer();
    } else {
      m.once('style.load', addParcelsLayer);
    }

    return () => {
      removeParcelsLayer();
    };
  }, [mapLoaded, showParcels, parcels]);

  const handleSnapToRoads = async () => {
    setSnapping(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/snap`, { method: 'POST', credentials: 'include' });
      if (res.ok) onSnapComplete?.();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Snap to roads failed');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Snap to roads failed');
    } finally {
      setSnapping(false);
    }
  };

  const anyStatusFilterActive = Object.values(statusFilters).some(Boolean);
  const waitingForInitialBuildingRender =
    Boolean(buildingPendingOverlay) &&
    mapLoaded &&
    mapViewMode === 'buildings' &&
    anyStatusFilterActive &&
    !hasRenderedBuildingsRef.current &&
    (buildingsRenderState.isFetching ||
      (buildingsRenderState.hasData &&
        buildingsRenderState.zoomLevel >= 12 &&
        !buildingsRenderState.hasVisibleFeatures));

  useEffect(() => {
    if (mapViewMode !== 'buildings') {
      setShowBuildingPendingOverlay(false);
      return;
    }

    if (!waitingForInitialBuildingRender) {
      setShowBuildingPendingOverlay(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowBuildingPendingOverlay(true);
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mapViewMode, waitingForInitialBuildingRender]);

  return (
    <div
      ref={mapShellRef}
      className={`relative h-full w-full ${isMapFullscreen ? 'bg-background' : ''}`}
    >
      <div ref={mapContainer} className="h-full w-full" />
      {map.current && mapLoaded && (
        <>
          <MapInfoButton
            show
            statusFilters={statusFilters}
            onStatusFiltersChange={setStatusFilters}
            portalContainer={mapShellRef.current}
          />
          {/* View switcher: Buildings | Addresses */}
          <div className="pointer-events-none absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
            <div className="pointer-events-auto flex items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-black/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMapViewMode('buildings')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${mapViewMode === 'buildings' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  Buildings
                </button>
                <button
                  type="button"
                  onClick={() => setMapViewMode('addresses')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${mapViewMode === 'addresses' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  Addresses
                </button>
              </div>
              <button
                type="button"
                onClick={() => void toggleMapFullscreen()}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-sm font-medium text-gray-600 shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-black/80 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label={isMapFullscreen ? 'Exit full screen map' : 'Full screen map'}
                title={isMapFullscreen ? 'Exit full screen map' : 'Full screen map'}
              >
                {isMapFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span>{isMapFullscreen ? 'Exit full screen' : 'Full screen'}</span>
              </button>
            </div>
            {/* Parcels toggle - only show if parcels exist for this campaign */}
            {parcels.length > 0 && (
              <div className="pointer-events-auto flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-black/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowParcels((v) => !v)}
                  className={`px-3 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
                    showParcels 
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' 
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  title={`${parcels.length} parcel${parcels.length !== 1 ? 's' : ''} available`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v10H5V5z" clipRule="evenodd" />
                  </svg>
                  {showParcels ? 'Hide Parcels' : 'Show Parcels'}
                  <span className="text-xs opacity-60">({parcels.length})</span>
                </button>
              </div>
            )}
          </div>
          {showBuildingPendingOverlay && buildingPendingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-lg border border-border bg-background/92 p-4 shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                    {loadingAnimationData ? (
                      <Lottie
                        animationData={loadingAnimationData}
                        loop
                        className="h-full w-full"
                        rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                      />
                    ) : (
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {buildingPendingOverlay.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {buildingPendingOverlay.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {mapViewMode === 'buildings' && (
            <MapBuildingsLayer 
              map={map.current} 
              campaignId={campaignId}
              addressStateOverrides={addresses}
              statusFilters={statusFilters}
              onBuildingClick={handleBuildingClick}
              onRenderStateChange={handleBuildingsRenderStateChange}
            />
          )}
          {/* Location Card - floating card when building is clicked */}
          {locationCardOpen && selectedBuildingId && (
            <div className="absolute bottom-6 left-4 z-20">
              <LocationCard
                gersId={selectedBuildingId}
                campaignId={campaignId}
                preferredAddressId={selectedAddressIdForCard}
                onSelectAddress={(id) => setSelectedAddressIdForCard(id ?? null)}
                onClose={handleCloseLocationCard}
                onAddContact={handleAddContact}
                extraContent={
                  renderLocationCardExtra
                    ? renderLocationCardExtra({
                        selectedBuildingId,
                        selectedAddressId: selectedAddressIdForCard,
                        campaignId,
                      })
                    : null
                }
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
            setSelectedContactNotes(undefined);
          }}
          onSuccess={handleContactCreated}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
          portalContainer={mapShellRef.current}
          initialAddress={selectedAddressText}
          initialAddressId={selectedAddressId}
          initialCampaignId={campaignId}
          initialNotes={selectedContactNotes}
        />
      )}
    </div>
  );
}
