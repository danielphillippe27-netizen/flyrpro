'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { Satellite, Map, Trash2, Pencil, Search } from 'lucide-react';
import * as turf from '@turf/turf';
import Lottie from 'lottie-react';
import type { CampaignType } from '@/types/database';

const CAMPAIGN_TYPE_OPTIONS: Array<{ value: CampaignType; label: string }> = [
  { value: 'just_sold', label: 'Just Sold' },
  { value: 'just_listed', label: 'Just Listed' },
  { value: 'open_house', label: 'Open House' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'market_update', label: 'Market Update' },
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'pop_by', label: 'Pop by' },
  { value: 'other', label: 'Other' },
];

type ProvisionStatus = 'pending' | 'ready' | 'failed' | null;
type ProvisionPhase =
  | 'created'
  | 'source_probed'
  | 'addresses_loading'
  | 'addresses_ready'
  | 'map_ready'
  | 'optimizing'
  | 'optimized'
  | 'failed'
  | null;

type ProvisionSource = 'diamond' | 'bedrock_nz' | 'bedrock_au' | 'bedrock_ca' | 'bedrock_us' | 'bedrock_za' | 'bedrock_uk' | null;

type CampaignProvisionState = {
  provision_status: ProvisionStatus;
  provision_phase: ProvisionPhase;
  provision_source: ProvisionSource;
  map_ready_at: string | null;
  optimized_at: string | null;
};

function isCampaignFullyReady(state: CampaignProvisionState | null) {
  if (!state || state.provision_status !== 'ready') return false;
  if (state.provision_phase === 'optimized' || Boolean(state.optimized_at)) return true;
  return Boolean(state.map_ready_at);
}

function provisionPhaseLabel(state: CampaignProvisionState | null) {
  if (!state) return 'Step 2/5: Starting map build';
  if (state.provision_status === 'failed') {
    return 'Map build failed';
  }
  if (state.provision_status === 'ready' && state.provision_phase === 'failed' && state.map_ready_at) {
    return 'Step 5/5: Map ready';
  }

  switch (state.provision_phase) {
    case 'created':
      return 'Step 2/5: Starting map build';
    case 'source_probed':
      return 'Step 3/5: Finding best data source';
    case 'addresses_loading':
      return 'Step 3/5: Loading addresses';
    case 'addresses_ready':
      return 'Step 4/5: Preparing map geometry';
    case 'map_ready':
      return 'Step 5/5: Map ready';
    case 'optimizing':
      return 'Step 5/5: Optimizing campaign map';
    case 'optimized':
      return 'Step 5/5: Campaign ready';
    default:
      return 'Step 2/5: Building campaign map';
  }
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle('standard', theme, 'v11'),
    [theme],
  );
  const [name, setName] = useState('');
  const [campaignType, setCampaignType] = useState<CampaignType>('just_sold');
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState<string>('');
  const [provisionFailed, setProvisionFailed] = useState<string | null>(null);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [isDrawingActive, setIsDrawingActive] = useState(true);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const hasNavigatedToCampaignRef = useRef(false);
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

  const currentStepText = loading
        ? 'Step 1/5: Saving territory'
        : provisionProgress || 'Step 2/5: Starting map build';

  const goToCreatedCampaign = useCallback((campaignId: string) => {
    if (hasNavigatedToCampaignRef.current) return;
    hasNavigatedToCampaignRef.current = true;
    router.push(`/campaigns/${campaignId}`);
  }, [router]);

  useEffect(() => {
    if (detailsSaved && createdCampaignId) {
      goToCreatedCampaign(createdCampaignId);
    }
  }, [detailsSaved, createdCampaignId, goToCreatedCampaign]);

  useEffect(() => {
    if (!createdCampaignId || setupComplete || provisionFailed) return;

    let cancelled = false;
    const supabase = createClient();

    const pollCampaignReady = async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('provision_status, provision_phase, provision_source, map_ready_at, optimized_at')
        .eq('id', createdCampaignId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn('Unable to poll campaign provisioning status:', error.message);
        return;
      }

      const state = (data ?? null) as CampaignProvisionState | null;
      setProvisionProgress(provisionPhaseLabel(state));

      if (state?.provision_status === 'failed') {
        setProvisioning(false);
        setProvisionFailed('Campaign map build failed. Try a larger polygon or retry provisioning.');
        return;
      }

      if (isCampaignFullyReady(state)) {
        setProvisioning(false);
        setProvisionProgress('Step 5/5: Campaign ready');
        setSetupComplete(true);
      } else {
        setProvisioning(true);
      }
    };

    void pollCampaignReady();
    const intervalId = window.setInterval(() => {
      void pollCampaignReady();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [createdCampaignId, provisionFailed, setupComplete]);

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
      config: resolvedMapStyle.config as mapboxgl.MapboxOptions['config'],
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
      const savedFeatures = savedFeaturesRef.current;
      if (savedFeatures && (savedFeatures.features?.length ?? 0) > 0) {
        newDraw.set(savedFeatures);
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

  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const mapInstance = map.current;
    const updateDrawingState = () => {
      const getMode = (drawRef.current as unknown as { getMode?: () => string } | null)?.getMode;
      setIsDrawingActive(getMode?.() === 'draw_polygon');
    };

    mapInstance.on('draw.modechange', updateDrawingState);
    mapInstance.on('draw.create', updateDrawingState);
    mapInstance.on('draw.delete', updateDrawingState);
    updateDrawingState();

    return () => {
      mapInstance.off('draw.modechange', updateDrawingState);
      mapInstance.off('draw.create', updateDrawingState);
      mapInstance.off('draw.delete', updateDrawingState);
    };
  }, [mapLoaded]);

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const clearDrawing = () => {
    if (drawRef.current) {
      drawRef.current.deleteAll();
      drawRef.current.changeMode('draw_polygon');
      setIsDrawingActive(true);
    }
  };

  const startDrawing = () => {
    if (drawRef.current) {
      drawRef.current.changeMode('draw_polygon');
      setIsDrawingActive(true);
    }
  };

  const handleMapSearchSelect = (suggestion: AddressSuggestion) => {
    if (!map.current || !mapLoaded) return;
    
    map.current.flyTo({
      center: [suggestion.coordinate.longitude, suggestion.coordinate.latitude],
      zoom: 18,
      duration: 1500, // Smooth animation
    });
    setSearchOpen(false);
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
      (f) => f.geometry?.type === 'Polygon' && f.geometry.coordinates?.[0]?.length >= 3
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
    setDetailsSaved(false);
    setSetupComplete(false);
    setProvisionFailed(null);
    setProvisionProgress('Step 1/5: Saving territory');
    try {
      // Create campaign server-side so generate-address-list and provision find it in Supabase
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled Campaign',
          type: campaignType,
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
      setCreatedCampaignId(campaign.id);
      setLoading(false);
      setProvisioning(Boolean(polygon));
      setProvisionProgress(polygon ? 'Step 2/5: Starting map build' : 'Step 5/5: Campaign ready');
      setSetupComplete(!polygon);

      if (polygon) {
        void fetch('/api/campaigns/provision', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaign.id,
          }),
        }).then(async (provisionResponse) => {
          if (!provisionResponse.ok) {
            const error = await provisionResponse.json().catch(() => ({}));
            console.error('Provisioning queue error:', error);
            return;
          }
          console.log('Campaign provisioning accepted:', campaign.id);
          setProvisionProgress('Step 2/5: Map build queued');
        }).catch((provisionError) => {
          console.error('Error starting background provisioning:', provisionError);
          setProvisioning(false);
          setProvisionFailed('Campaign was saved, but map build did not start.');
        });
      }

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

  const handleCampaignDetailsSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!createdCampaignId) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      alert('Please name your campaign');
      return;
    }

    setDetailsSaving(true);
    try {
      const response = await fetch(`/api/campaigns/${createdCampaignId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          type: campaignType,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Failed to update campaign (${response.status})`);
      }

      setDetailsSaved(true);
      goToCreatedCampaign(createdCampaignId);
    } catch (error: unknown) {
      console.error('Error updating campaign details:', error);
      alert(error instanceof Error ? error.message : 'Failed to update campaign details');
    } finally {
      setDetailsSaving(false);
    }
  };

  const showCampaignDetailsCard = Boolean(createdCampaignId && !detailsSaved);
  const showGeneratingStatus = provisioning || Boolean(createdCampaignId && detailsSaved && !setupComplete);

  return (
    <div className="flex h-full min-h-0 bg-gray-50 dark:bg-background overflow-hidden">
      {showCampaignDetailsCard && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4 backdrop-blur-md">
          <form
            onSubmit={handleCampaignDetailsSubmit}
            className="relative z-[60] w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-2xl"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Campaign Details</h2>
              <p className="text-sm text-muted-foreground">
                Name the campaign and choose the type.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Campaign name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDetailsSaved(false);
                  }}
                  required
                  autoFocus
                  placeholder="Campaign Name"
                  className="bg-gray-100 dark:bg-neutral-800"
                  disabled={detailsSaving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaign-type">Type</Label>
                <Select
                  value={campaignType}
                  onValueChange={(value) => {
                    setCampaignType(value as CampaignType);
                    setDetailsSaved(false);
                  }}
                  disabled={detailsSaving}
                >
                  <SelectTrigger id="campaign-type" className="w-full bg-gray-100 dark:bg-neutral-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[80]">
                    {CAMPAIGN_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={detailsSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={detailsSaving || !name.trim()}>
                {detailsSaving ? 'Saving...' : setupComplete ? 'Save & Open' : 'Save & Build Map'}
              </Button>
            </div>
          </form>
        </div>
      )}

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
            {!createdCampaignId ? (
              <Button
                type="button"
                size="lg"
                className="h-14 justify-start gap-3 rounded-xl border border-red-600 bg-red-500 px-6 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-red-600 hover:shadow-xl"
                disabled={loading || provisioning}
                onClick={handleSubmit}
              >
                {loading ? 'Saving Territory...' : 'Create Territory'}
              </Button>
            ) : null}

            <button
              type="button"
              onClick={() => setSearchOpen((current) => !current)}
              className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
            >
              <Search className="w-5 h-5" />
              <span>Search</span>
            </button>

            {searchOpen ? (
              <div className="w-[min(24rem,calc(100vw-7rem))] rounded-2xl border border-border bg-card/95 backdrop-blur-sm shadow-lg p-4 space-y-2">
                <AddressAutocomplete
                  value={mapSearchQuery}
                  onChange={setMapSearchQuery}
                  onSelect={handleMapSearchSelect}
                  placeholder="Jump to address..."
                  className="flex-1"
                  inputClassName="bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  Search for an address, then draw the campaign boundary.
                </p>
              </div>
            ) : null}

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
            
            {!createdCampaignId && (
              <>
                {/* Draw Button */}
                <button
                  type="button"
                  onClick={startDrawing}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 text-sm font-medium border ${
                    isDrawingActive
                      ? 'bg-black text-white hover:bg-neutral-900 border-black dark:bg-white dark:text-black dark:hover:bg-neutral-100 dark:border-white'
                      : 'bg-card text-foreground hover:bg-muted/50 border-border'
                  }`}
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
              </>
            )}

          </div>
        )}

        {/* Draw instructions overlay */}
        {mapLoaded && !createdCampaignId && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card rounded-full px-5 py-2.5 shadow-lg border border-border z-10">
            <p className="text-sm text-foreground whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}
      </div>

      {/* Background setup status */}
      {showGeneratingStatus && (
        <div className="fixed bottom-6 right-6 z-[70] pointer-events-none">
          <div className="flex w-[min(380px,calc(100vw-3rem))] items-center gap-4 rounded-xl border border-border bg-card/95 px-5 py-4 text-left shadow-2xl backdrop-blur">
            <div className="h-20 w-20 shrink-0 flex items-center justify-center">
              {loadingAnimationData ? (
                <Lottie
                  animationData={loadingAnimationData}
                  loop
                  className="h-full w-full"
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                />
              ) : (
                <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-primary"></div>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">
                {provisionFailed ? 'Campaign needs attention' : 'Generating Campaign'}
              </h3>
              <p className="mt-1 text-sm font-medium text-foreground">
                {provisionFailed ?? currentStepText}
              </p>
              {!provisionFailed ? (
                <p className="mt-1 text-sm text-muted-foreground">Opening when the map is ready...</p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
