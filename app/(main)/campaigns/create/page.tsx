'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, hideBaseBuildingLayers, resolveMapStyle } from '@/lib/map-styles';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { UserLocationLayer } from '@/components/map/UserLocationLayer';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { Satellite, Map, Trash2, Pencil } from 'lucide-react';
import * as turf from '@turf/turf';
import Lottie from 'lottie-react';

export default function CreateCampaignPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle('standard', theme, 'v11'),
    [theme],
  );
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState<string>('');
  const [generatingAddresses, setGeneratingAddresses] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const appliedBaseStyleKeyRef = useRef<string | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const isDark = theme === 'dark';
  const lottieSrc = useMemo(
    () => (isDark ? '/loading/white.json' : '/loading/black.json'),
    [isDark]
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(lottieSrc)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setLoadingAnimationData(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lottieSrc]);

  const currentStepText = generatingAddresses
        ? 'Step 3/5: Fetching addresses'
        : provisionProgress.includes('Scanning')
          ? 'Step 4/5: Fetching buildings'
          : provisionProgress.includes('Matching') || provisionProgress.includes('Linking')
            ? 'Step 4/5: Linking addresses to buildings'
            : provisionProgress.includes('Finalizing')
              ? 'Step 5/5: Preparing optimized route'
              : 'Step 5/5: Finishing setup';

  /** Add residential-only 2D building footprints from Mapbox vector tiles.
   *  Hides built-in style buildings and renders residential buildings as near-black at 80% opacity.
   *  Works with streets-v11 / dark-v11 / satellite-streets-v12 styles. */
  const add2DBuildingsLayer = (m: mapboxgl.Map) => {
    const buildingLayerId = '2d-buildings';
    if (m.getLayer(buildingLayerId)) return; // already added
    const buildingFill = isDark ? '#111111' : '#c8c1b2';
    const buildingOutline = isDark ? '#0a0a0a' : '#b5ad9d';

    const layers = m.getStyle().layers;

    applyPresetVisualTweaks(m, resolvedMapStyle, {
      preserveLayerIds: [buildingLayerId],
      preserveLayerPrefixes: ['gl-draw-'],
    });

    // Hide ALL built-in building layers from the base style (includes 3D extrusions)
    hideBaseBuildingLayers(m, { preserveLayerIds: [buildingLayerId] });

    // Find the first symbol layer so buildings render beneath labels
    let labelLayerId: string | undefined;
    for (const layer of layers) {
      const symbolLayer = layer as mapboxgl.SymbolLayer;
      if (layer.type === 'symbol' && symbolLayer.layout?.['text-field']) {
        labelLayerId = layer.id;
        break;
      }
    }

    m.addLayer(
      {
        id: buildingLayerId,
        source: 'composite',
        'source-layer': 'building',
        type: 'fill',
        minzoom: 12,
        // Exclude explicitly non-residential building types
        filter: [
          'match', ['get', 'type'],
          ['commercial', 'industrial', 'retail', 'warehouse', 'office',
           'church', 'cathedral', 'chapel', 'temple', 'mosque',
           'hospital', 'civic', 'government', 'public',
           'university', 'school', 'college', 'kindergarten',
           'train_station', 'transportation', 'hangar',
           'parking', 'garage', 'garages',
           'service', 'manufacture', 'factory',
           'supermarket', 'hotel', 'motel',
           'stadium', 'grandstand',
           'fire_station', 'barn', 'silo', 'greenhouse',
           'kiosk', 'roof', 'ruins', 'bridge', 'construction'],
          false,
          true,
        ],
        paint: {
          'fill-color': buildingFill,
          'fill-opacity': 0.8,
          'fill-outline-color': buildingOutline,
        },
      },
      labelLayerId,
    );
  };

  // Initialize map with drawing controls
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = getMapboxToken();
    mapboxgl.accessToken = token;

    // Initialize map (style follows app theme)
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: resolvedMapStyle.style,
      config: resolvedMapStyle.config,
      center: [-79.35, 43.65], // Default to Toronto area
      zoom: 15,
    });
    appliedBaseStyleKeyRef.current = resolvedMapStyle.key;

    map.current.on('load', () => {
      setMapLoaded(true);
      if (!isSatellite) {
        add2DBuildingsLayer(map.current!);
      }
    });

    // Initialize Mapbox Draw with red styling (no visible controls - draw by clicking)
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {}, // Hide all default controls to avoid duplicates
      defaultMode: 'draw_polygon',
      styles: [
        // Polygon fill
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#ef4444',
            'fill-outline-color': '#ef4444',
            'fill-opacity': 0.15,
          },
        },
        // Polygon outline stroke
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
          },
        },
        // Vertex points (the draggable circles)
        {
          id: 'gl-draw-polygon-and-line-vertex-active',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        },
        // Midpoint vertices
        {
          id: 'gl-draw-polygon-midpoint',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
          },
        },
        // Line while drawing
        {
          id: 'gl-draw-line-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
            'line-dasharray': [0.2, 2],
          },
        },
        // Static polygon (after completion)
        {
          id: 'gl-draw-polygon-fill-static',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
          paint: {
            'fill-color': '#ef4444',
            'fill-outline-color': '#ef4444',
            'fill-opacity': 0.15,
          },
        },
        {
          id: 'gl-draw-polygon-stroke-static',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
          },
        },
      ],
    });

    map.current.addControl(draw);
    drawRef.current = draw;

    return () => {
      if (map.current) {
        // Temporarily suppress AbortError from Mapbox's in-flight tile requests
        const suppressAbort = (e: PromiseRejectionEvent) => {
          if (e.reason?.name === 'AbortError') e.preventDefault();
        };
        window.addEventListener('unhandledrejection', suppressAbort);
        removeMapboxMapWhenSafe(map.current);
        map.current = null;
        setTimeout(() => window.removeEventListener('unhandledrejection', suppressAbort), 0);
      }
    };
  }, []);

  // Store drawn features for restoration after style change
  const savedFeaturesRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // Handle map style change - recreate draw instance to avoid source conflicts
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const expectedStyleKey = isSatellite ? 'satellite' : resolvedMapStyle.key;
    if (appliedBaseStyleKeyRef.current === expectedStyleKey && drawRef.current) return;

    // Save features before destroying draw
    if (drawRef.current) {
      try {
        savedFeaturesRef.current = drawRef.current.getAll();
        map.current.removeControl(drawRef.current);
        drawRef.current = null;
      } catch (e) {
        console.log('Error saving/removing draw:', e);
      }
    }

    // Clear boundary layer ref so we never call getLayer with stale IDs after style replace
    boundaryLayerIdsRef.current = [];
    // Change style
    if (isSatellite) {
      map.current.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else {
      applyResolvedMapStyle(map.current, resolvedMapStyle);
    }

    // After style loads, re-add 2D buildings and create fresh draw instance
    map.current.once('style.load', () => {
      if (!map.current) return;
      appliedBaseStyleKeyRef.current = expectedStyleKey;

      // Keep custom residential building overlays off satellite mode.
      if (!isSatellite) {
        add2DBuildingsLayer(map.current);
      }

      // Create fresh draw instance
      const newDraw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: 'draw_polygon',
        styles: [
          { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], paint: { 'fill-color': '#ef4444', 'fill-outline-color': '#ef4444', 'fill-opacity': 0.15 } },
          { id: 'gl-draw-polygon-stroke-active', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3 } },
          { id: 'gl-draw-polygon-and-line-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 4, 'circle-color': '#ef4444', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
          { id: 'gl-draw-polygon-midpoint', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']], paint: { 'circle-radius': 4, 'circle-color': '#ef4444' } },
          { id: 'gl-draw-line-active', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [0.2, 2] } },
          { id: 'gl-draw-polygon-fill-static', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']], paint: { 'fill-color': '#ef4444', 'fill-outline-color': '#ef4444', 'fill-opacity': 0.15 } },
          { id: 'gl-draw-polygon-stroke-static', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ef4444', 'line-width': 3 } },
        ],
      });

      map.current.addControl(newDraw);
      drawRef.current = newDraw;

      // Restore saved features
      if (savedFeaturesRef.current?.features?.length > 0) {
        newDraw.set(savedFeaturesRef.current);
        newDraw.changeMode('simple_select');
      } else {
        newDraw.changeMode('draw_polygon');
      }
    });
  }, [isSatellite, mapLoaded, resolvedMapStyle]);

  // Keep map fully sized when surrounding layout (e.g. campaign sidebar) collapses/expands.
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
          // Ignore transient resize errors during style transitions/unmount.
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

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const clearDrawing = () => {
    if (drawRef.current) {
      drawRef.current.deleteAll();
      drawRef.current.changeMode('draw_polygon');
    }
  };

  const startDrawing = () => {
    if (drawRef.current) {
      drawRef.current.changeMode('draw_polygon');
    }
  };

  const handleMapSearchSelect = (suggestion: AddressSuggestion) => {
    if (!map.current || !mapLoaded) return;
    
    map.current.flyTo({
      center: [suggestion.coordinate.longitude, suggestion.coordinate.latitude],
      zoom: 18,
      duration: 1500, // Smooth animation
    });
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId) return;

    // Get drawn polygon (map territory only)
    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    let bbox: number[] | undefined = undefined;
    const features = drawRef.current?.getAll();
    if (!features || features.features.length === 0) {
      alert('Please draw a territory boundary on the map');
      return;
    }

    // Find the first completed Polygon feature (skip points, lines, or incomplete geometries)
    const polygonFeature = features.features.find(
      (f: { geometry?: { type?: string; coordinates?: number[][][] } }) =>
        f.geometry?.type === 'Polygon' && f.geometry.coordinates?.[0]?.length >= 3
    );
    if (!polygonFeature) {
      alert('Please draw a territory boundary on the map. Double-click to finish your shape.');
      return;
    }
    polygon = polygonFeature.geometry as { type: 'Polygon'; coordinates: number[][][] };

    // Ensure valid polygon (GeoJSON closed ring = at least 4 positions for 3 unique corners)
    const ring = polygon.coordinates[0];
    if (!ring || ring.length < 3) {
      alert('Please draw a proper territory with at least 3 corners. The shape you drew has too few points.');
      return;
    }
    // Close the ring if unclosed (first and last must be equal per GeoJSON spec)
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      polygon = {
        ...polygon,
        coordinates: [[...ring, [first[0], first[1]]]],
      };
    }

    // Calculate bbox from polygon using turf
    try {
      const turfPolygon = turf.polygon(polygon.coordinates);
      const calculatedBbox = turf.bbox(turfPolygon);
      bbox = [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
    } catch (bboxError) {
      console.error('Error calculating bbox from polygon:', bboxError);
    }

    setLoading(true);
    try {
      // Create campaign server-side so generate-address-list and provision find it in Supabase
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type: 'flyer',
          address_source: 'map',
          workspace_id: currentWorkspaceId ?? undefined,
          bbox,
          territory_boundary: polygon || undefined,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create campaign (${createRes.status})`);
      }
      const campaign = await createRes.json();
      console.log('Campaign created:', campaign?.id, campaign?.name);

      if (polygon) {
        setProvisioning(true);
        setProvisionProgress('Scanning 3D Shapes...');
        try {
          const progressInterval = setInterval(() => {
            setProvisionProgress((prev) => {
              if (prev === 'Scanning 3D Shapes...') return 'Matching Addresses...';
              if (prev === 'Matching Addresses...') return 'Finalizing Mission Territory...';
              return prev;
            });
          }, 2000);

          try {
            const provisionResponse = await fetch('/api/campaigns/provision', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaign_id: campaign.id,
              }),
            });

            clearInterval(progressInterval);
            setProvisionProgress('Finalizing Mission Territory...');

            if (!provisionResponse.ok) {
              const error = await provisionResponse.json().catch(() => ({}));
              console.error('Provisioning error:', error);
              alert(`Campaign created but provisioning failed: ${error.error || 'Unknown error'}`);
            } else {
              const result = await provisionResponse.json();
              const { addresses_saved = 0, buildings_saved = 0, links_created = 0 } = result;
              setAddressCount(addresses_saved);
              console.log(`Staged provision: ${addresses_saved} addresses, ${buildings_saved} buildings, ${links_created} links`);
              if (result.warning) {
                alert(result.warning);
              }
              if (links_created < addresses_saved) {
                setProvisionProgress(`Linking: ${links_created} / ${addresses_saved} addresses...`);
              }
              await new Promise(resolve => setTimeout(resolve, 800));
            }
          } finally {
            clearInterval(progressInterval);
          }
        } catch (provisionError) {
          console.error('Error provisioning campaign:', provisionError);
          alert('Campaign created but provisioning failed. You can provision later.');
        } finally {
          setProvisioning(false);
          setProvisionProgress('');
        }
      }

      router.push(`/campaigns/${campaign.id}`);
    } catch (error: unknown) {
      console.error('Error creating campaign:', error);
      // Extract meaningful error message
      const errorDetails =
        error && typeof error === 'object'
          ? (error as { message?: string; details?: string; hint?: string; code?: string })
          : {};
      const errorMessage = errorDetails.message || errorDetails.details || errorDetails.hint || 'Unknown error occurred';
      const errorCode = errorDetails.code ? ` (${errorDetails.code})` : '';
      alert(`Failed to create campaign: ${errorMessage}${errorCode}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-background overflow-hidden">
      {/* Compact Header Toolbar – matches app header styling */}
      <div className="flex-shrink-0 bg-white dark:bg-card border-b border-border px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Campaign Name */}
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <Label htmlFor="name" className="text-sm font-medium text-foreground whitespace-nowrap">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Campaign Name"
              className="flex-1 min-w-0 bg-gray-200 dark:bg-neutral-600"
            />
          </div>

          {/* Address Search */}
          <div className="flex items-center gap-2 flex-1 min-w-64">
            <Label className="text-sm font-medium text-foreground whitespace-nowrap">Search</Label>
            <AddressAutocomplete
              value={mapSearchQuery}
              onChange={setMapSearchQuery}
              onSelect={handleMapSearchSelect}
              placeholder="Jump to address..."
              className="flex-1"
              inputClassName="bg-gray-200 dark:bg-neutral-600"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 ml-auto">
            <Button type="button" variant="outline" size="sm" className="bg-gray-200 dark:bg-neutral-600 dark:border-neutral-500 dark:hover:bg-neutral-500" onClick={() => router.back()} disabled={loading || provisioning || generatingAddresses}>
              Cancel
            </Button>
            <Button 
              type="button" 
              size="sm" 
              disabled={loading || provisioning || generatingAddresses || !name}
              onClick={handleSubmit}
            >
              {loading ? 'Creating...' : generatingAddresses ? 'Finding...' : provisioning ? 'Provisioning...' : 'Create Campaign'}
            </Button>
          </div>
        </div>

        {/* Helper text row */}
        <p className="text-xs text-muted-foreground mt-2">
          Draw a polygon on the map to define your campaign territory. Use the search to jump to a location.
        </p>
        {addressCount !== null && (
          <p className="text-xs font-medium text-green-600 dark:text-green-400 mt-2">
            {addressCount} addresses loaded
          </p>
        )}
      </div>

      {/* Full-screen Map */}
      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <MapInfoButton show={mapLoaded} />
        {mapLoaded && map.current && (
          <UserLocationLayer
            map={map.current}
            mapLoaded={mapLoaded}
            showUserLocation={true}
            onLocationFound={(lng, lat) => {
              // Only center on user location once when first opening create campaign
              if (!hasCenteredOnUserLocationRef.current) {
                hasCenteredOnUserLocationRef.current = true;
                map.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
              }
            }}
            onLocationError={() => {
              // Keep default Toronto center if geolocation denied or fails
            }}
          />
        )}

        {/* Map Controls - Google Maps style floating buttons */}
        {mapLoaded && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-10">
            {/* Satellite Toggle */}
            <button
              type="button"
              onClick={toggleSatelliteView}
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
            >
              {isSatellite ? (
                <>
                  <Map className="w-5 h-5" />
                  <span>Map</span>
                </>
              ) : (
                <>
                  <Satellite className="w-5 h-5" />
                  <span>Satellite</span>
                </>
              )}
            </button>
            
            {/* Draw Button */}
            <button
              type="button"
              onClick={startDrawing}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg shadow-lg hover:shadow-xl hover:bg-red-600 transition-all duration-200 text-sm font-medium border border-red-600"
            >
              <Pencil className="w-5 h-5" />
              <span>Draw</span>
            </button>
            
            {/* Clear Drawing Button */}
            <button
              type="button"
              onClick={clearDrawing}
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
            >
              <Trash2 className="w-5 h-5" />
              <span>Clear</span>
            </button>

          </div>
        )}

        {/* Draw instructions overlay */}
        {mapLoaded && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card rounded-full px-5 py-2.5 shadow-lg border border-border z-10">
            <p className="text-sm text-foreground whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}
      </div>

      {/* Loading Modal */}
      {(provisioning || generatingAddresses) && (
        <div className="fixed inset-0 bg-black/35 backdrop-blur-[1px] flex items-center justify-center z-50">
          <div className="max-w-lg w-full mx-4 text-center">
            <div className="h-80 w-full flex items-center justify-center">
              {loadingAnimationData ? (
                <Lottie
                  animationData={loadingAnimationData}
                  loop
                  className="h-full w-full"
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                />
              ) : (
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              )}
            </div>
            <div className="pt-3">
              <h3 className="text-lg font-semibold text-white mb-3">
                Generating Campaign
              </h3>
              <div className="space-y-2">
                <p className="text-sm font-medium text-white/95">{currentStepText}</p>
                <p className="text-sm text-white/90">Syncing property data...</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
