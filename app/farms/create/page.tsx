'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, hideBaseBuildingLayers, resolveMapStyle } from '@/lib/map-styles';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { UserLocationLayer } from '@/components/map/UserLocationLayer';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { CheckCircle2, CircleAlert, Loader2, Map, Minus, Pencil, Plus, Satellite, Search, Trash2, TriangleAlert } from 'lucide-react';
import * as turf from '@turf/turf';
import { FarmTouchService } from '@/lib/services/FarmService';
import type { FarmSessionMode, FarmTouchInterval, FarmTouchType } from '@/types/database';

const DEFAULT_HOME_LIMIT = 5000;
const DEFAULT_TOUCHES_PER_YEAR = 12;
const DEFAULT_FARM_DURATION_DAYS = 365;
const FLYR_FARM_TOUCH_COUNT = 12;

type CustomFarmTouchOptionValue = FarmTouchType;
type CustomExtraTouch = {
  id: string;
  label: string;
  count: number;
};

const CUSTOM_FARM_TOUCH_OPTIONS: Array<{
  value: CustomFarmTouchOptionValue;
  label: string;
  sessionTitle: string;
  mode: FarmSessionMode;
  touchType?: FarmTouchType;
}> = [
  { value: 'phone_call', label: 'Phone calls', sessionTitle: 'Phone call campaign', mode: 'phone_call', touchType: 'phone_call' },
  { value: 'doorknock', label: 'Door knocking', sessionTitle: 'Door knocking session', mode: 'doorknock', touchType: 'doorknock' },
  { value: 'flyer', label: 'Flyers', sessionTitle: 'Flyer run', mode: 'flyer', touchType: 'flyer' },
  { value: 'social_ad', label: 'Social media ads', sessionTitle: 'Social media ad campaign', mode: 'social_ad', touchType: 'social_ad' },
  { value: 'event', label: 'Events', sessionTitle: 'Community event or pop-by', mode: 'event', touchType: 'event' },
];

const DEFAULT_CUSTOM_TOUCH_COUNTS: Record<CustomFarmTouchOptionValue, number> = {
  phone_call: 1,
  doorknock: 2,
  flyer: 4,
  social_ad: 4,
  event: 1,
  canada_post: 0,
  pop_by: 0,
  letter: 0,
};

const FLYR_FARM_TEMPLATE_SUMMARY = [
  '4 flyer runs',
  '4 social media ad campaigns',
  '2 door knocking sessions',
  '1 phone call campaign',
  '1 community event or pop-by',
];

type CreateFarmDialogTone = 'default' | 'warning' | 'destructive';

type CreateFarmDialogState = {
  title: string;
  description: string;
  tone: CreateFarmDialogTone;
  actionLabel: string;
};

type CreatedFarm = {
  id: string;
  linked_campaign_id?: string | null;
  workspace_id?: string | null;
  start_date: string;
  touches_interval?: FarmTouchInterval | null;
  frequency?: number | null;
};

type FarmWizardStep = 'details' | 'template' | 'meta';
type FarmTemplateChoice = 'flyr' | 'custom';

type MetaConnectionStatus = {
  connected: boolean;
  id?: string;
  meta_user_id?: string | null;
  token_expires_at?: string | null;
};

type MetaAdAccount = {
  meta_ad_account_id: string;
  name?: string | null;
  currency?: string | null;
};

type MetaCampaign = {
  id: string;
  name: string;
  status?: string | null;
};

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string; details?: string | null; hint?: string | null };
    return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' | ') || 'Failed to create farm';
  }
  return 'Failed to create farm';
}

function getCustomPlanTouchCount(counts: Record<CustomFarmTouchOptionValue, number>, extras: CustomExtraTouch[] = []): number {
  const optionCount = CUSTOM_FARM_TOUCH_OPTIONS.reduce((sum, option) => sum + Math.max(0, counts[option.value] || 0), 0);
  const extraCount = extras.reduce((sum, touch) => sum + Math.max(0, touch.count || 0), 0);
  return optionCount + extraCount;
}

export default function CreateFarmPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v11'),
    [mapPreset, theme],
  );
  const [name, setName] = useState('');
  const [startDate] = useState(() => formatDateInput(new Date()));
  const [touchesPerInterval, setTouchesPerInterval] = useState(DEFAULT_TOUCHES_PER_YEAR);
  const [customTouchCounts, setCustomTouchCounts] = useState<Record<CustomFarmTouchOptionValue, number>>(DEFAULT_CUSTOM_TOUCH_COUNTS);
  const [customOtherInput, setCustomOtherInput] = useState('');
  const [customExtraTouches, setCustomExtraTouches] = useState<CustomExtraTouch[]>([]);
  const [monthlySpend, setMonthlySpend] = useState('');
  const [includeSocialAdsInSpend, setIncludeSocialAdsInSpend] = useState(false);
  const [wizardStep, setWizardStep] = useState<FarmWizardStep>('details');
  const [farmTemplate, setFarmTemplate] = useState<FarmTemplateChoice>('flyr');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [syncingFarm, setSyncingFarm] = useState(false);
  const [createdFarm, setCreatedFarm] = useState<CreatedFarm | null>(null);
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupFailed, setSetupFailed] = useState(false);
  const [setupStatusText, setSetupStatusText] = useState('');
  const [hasNavigatedToFarm, setHasNavigatedToFarm] = useState(false);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [generatedHomes, setGeneratedHomes] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isSatellite, setIsSatellite] = useState(false);
  const [isDrawingActive, setIsDrawingActive] = useState(true);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedbackDialog, setFeedbackDialog] = useState<CreateFarmDialogState | null>(null);
  const [metaConnection, setMetaConnection] = useState<MetaConnectionStatus | null>(null);
  const [metaAdAccounts, setMetaAdAccounts] = useState<MetaAdAccount[]>([]);
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [selectedMetaAdAccountId, setSelectedMetaAdAccountId] = useState('');
  const [selectedMetaCampaignId, setSelectedMetaCampaignId] = useState('');
  const [metaLinkCount, setMetaLinkCount] = useState(0);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingMetaCampaigns, setLoadingMetaCampaigns] = useState(false);
  const [linkingMeta, setLinkingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const formScrollRef = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const appliedBaseStyleKeyRef = useRef<string | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const feedbackDialogResolveRef = useRef<(() => void) | null>(null);
  const createdFarmRef = useRef<CreatedFarm | null>(null);
  const detailsSavedRef = useRef(false);
  const setupCompleteRef = useRef(false);
  const finalizingRef = useRef(false);
  const touchPlanCreatedRef = useRef(false);
  const customTouchCountsRef = useRef(customTouchCounts);
  const customExtraTouchesRef = useRef(customExtraTouches);
  const farmTemplateRef = useRef<FarmTemplateChoice>(farmTemplate);
  const isDark = theme === 'dark';

  const setupInProgress = loading || provisioning || syncingFarm;
  const showingDetailsStep = Boolean(createdFarm);
  const customPlanTouchCount = useMemo(
    () => getCustomPlanTouchCount(customTouchCounts, customExtraTouches),
    [customTouchCounts, customExtraTouches]
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    const el = formScrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    return () => {
      feedbackDialogResolveRef.current?.();
      feedbackDialogResolveRef.current = null;
    };
  }, []);

  useEffect(() => {
    createdFarmRef.current = createdFarm;
  }, [createdFarm]);

  useEffect(() => {
    detailsSavedRef.current = detailsSaved;
  }, [detailsSaved]);

  useEffect(() => {
    setupCompleteRef.current = setupComplete;
  }, [setupComplete]);

  useEffect(() => {
    customTouchCountsRef.current = customTouchCounts;
  }, [customTouchCounts]);

  useEffect(() => {
    customExtraTouchesRef.current = customExtraTouches;
  }, [customExtraTouches]);

  useEffect(() => {
    farmTemplateRef.current = farmTemplate;
  }, [farmTemplate]);

  useEffect(() => {
    if (createdFarmRef.current && detailsSavedRef.current) {
      setDetailsSaved(false);
    }
  }, [name, startDate, touchesPerInterval, customTouchCounts, customOtherInput, customExtraTouches, monthlySpend, includeSocialAdsInSpend, farmTemplate]);

  const dismissFeedbackDialog = () => {
    setFeedbackDialog(null);
    const resolve = feedbackDialogResolveRef.current;
    feedbackDialogResolveRef.current = null;
    resolve?.();
  };

  const showFeedbackDialog = ({
    title,
    description,
    tone = 'default',
    actionLabel = 'OK',
  }: {
    title: string;
    description: string;
    tone?: CreateFarmDialogTone;
    actionLabel?: string;
  }) =>
    new Promise<void>((resolve) => {
      feedbackDialogResolveRef.current?.();
      feedbackDialogResolveRef.current = resolve;
      setFeedbackDialog({ title, description, tone, actionLabel });
    });

  const add2DBuildingsLayer = (m: mapboxgl.Map) => {
    const buildingLayerId = '2d-buildings';
    if (m.getLayer(buildingLayerId)) return;
    const buildingFill = isDark ? '#111111' : '#c8c1b2';
    const buildingOutline = isDark ? '#0a0a0a' : '#b5ad9d';

    const layers = m.getStyle().layers;

    applyPresetVisualTweaks(m, resolvedMapStyle, {
      preserveLayerIds: [buildingLayerId],
      preserveLayerPrefixes: ['gl-draw-'],
    });

    hideBaseBuildingLayers(m, { preserveLayerIds: [buildingLayerId] });

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

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = getMapboxToken();
    if (!token) {
      setMapError('Mapbox token not configured.');
      return;
    }

    mapboxgl.accessToken = token;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: resolvedMapStyle.style,
      config: resolvedMapStyle.config as mapboxgl.MapboxOptions['config'],
      center: [-79.35, 43.65],
      zoom: 15,
    });
    appliedBaseStyleKeyRef.current = resolvedMapStyle.key;

    map.current.on('load', () => {
      setMapLoaded(true);
      setMapError(null);
      if (!isSatellite) {
        add2DBuildingsLayer(map.current!);
      }
    });

    map.current.on('error', () => {
      setMapError('Unable to load the map. Check the Mapbox token and style access.');
    });

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'draw_polygon',
      styles: [
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
        {
          id: 'gl-draw-polygon-midpoint',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#ef4444',
          },
        },
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
        const suppressAbort = (e: PromiseRejectionEvent) => {
          if (e.reason?.name === 'AbortError') e.preventDefault();
        };
        window.addEventListener('unhandledrejection', suppressAbort);
        map.current.remove();
        map.current = null;
        setTimeout(() => window.removeEventListener('unhandledrejection', suppressAbort), 0);
      }
    };
  }, []);

  const savedFeaturesRef = useRef<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const expectedStyleKey = isSatellite ? 'satellite' : resolvedMapStyle.key;
    if (appliedBaseStyleKeyRef.current === expectedStyleKey && drawRef.current) return;

    if (drawRef.current) {
      try {
        savedFeaturesRef.current = drawRef.current.getAll();
        map.current.removeControl(drawRef.current);
        drawRef.current = null;
      } catch (e) {
        console.log('Error saving/removing draw:', e);
      }
    }

    boundaryLayerIdsRef.current = [];
    if (isSatellite) {
      map.current.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else {
      applyResolvedMapStyle(map.current, resolvedMapStyle);
    }

    map.current.once('style.load', () => {
      if (!map.current) return;
      appliedBaseStyleKeyRef.current = expectedStyleKey;

      if (!isSatellite) {
        add2DBuildingsLayer(map.current);
      }

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

      const savedFeatures = savedFeaturesRef.current;
      if (savedFeatures && (savedFeatures.features?.length ?? 0) > 0) {
        newDraw.set(savedFeatures);
        newDraw.changeMode('simple_select');
      } else {
        newDraw.changeMode('draw_polygon');
      }
    });
  }, [isSatellite, mapLoaded, resolvedMapStyle]);

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
        } catch {}
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
      duration: 1500,
    });
    setSearchOpen(false);
  };

  const getDrawnFarmPolygon = async (): Promise<{
    polygon: { type: 'Polygon'; coordinates: number[][][] };
    bbox?: number[];
  } | null> => {
    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    let bbox: number[] | undefined;
    const features = drawRef.current?.getAll();
    if (!features || features.features.length === 0) {
      await showFeedbackDialog({
        title: 'Draw a boundary',
        description: 'Draw a territory boundary on the map before creating this farm.',
        tone: 'warning',
      });
      return null;
    }

    const polygonFeature = features.features.find(
      (feature: GeoJSON.Feature) => feature.geometry?.type === 'Polygon' && feature.geometry.coordinates?.[0]?.length >= 3
    );
    if (!polygonFeature) {
      await showFeedbackDialog({
        title: 'Finish the boundary',
        description: 'Double-click to finish your shape, then try creating the farm again.',
        tone: 'warning',
      });
      return null;
    }
    polygon = polygonFeature.geometry as { type: 'Polygon'; coordinates: number[][][] };

    const ring = polygon.coordinates[0];
    if (!ring || ring.length < 3) {
      await showFeedbackDialog({
        title: 'Boundary is too small',
        description: 'Draw a proper territory with at least 3 corners.',
        tone: 'warning',
      });
      return null;
    }

    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      polygon = {
        ...polygon,
        coordinates: [[...ring, [first[0], first[1]]]],
      };
    }

    try {
      const turfPolygon = turf.polygon(polygon.coordinates);
      const calculatedBbox = turf.bbox(turfPolygon);
      bbox = [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
    } catch (bboxError) {
      console.error('Error calculating bbox from polygon:', bboxError);
    }

    return { polygon, bbox };
  };

  const getAnnualizedMonthlySpendCents = async (): Promise<number | null | undefined> => {
    const trimmedBudget = monthlySpend.trim();
    const monthlyBudgetCents = trimmedBudget
      ? Math.round(Number(trimmedBudget.replace(/,/g, '')) * 100)
      : null;
    if (
      trimmedBudget &&
      (!Number.isFinite(monthlyBudgetCents ?? Number.NaN) || (monthlyBudgetCents ?? 0) < 0)
    ) {
      await showFeedbackDialog({
        title: 'Monthly spend is invalid',
        description: 'Enter a valid monthly spend or leave the field empty.',
        tone: 'warning',
      });
      return undefined;
    }
    return monthlyBudgetCents === null ? null : monthlyBudgetCents * 12;
  };

  const buildFlyrFarmTemplatePlan = (farm: CreatedFarm): Array<{
    mode: FarmSessionMode;
    title: string;
    scheduledDate: string;
  }> => {
    const start = new Date(`${String(farm.start_date).slice(0, 10)}T12:00:00`);
    const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
    const atMonth = (monthOffset: number) => formatDateInput(addMonths(safeStart, monthOffset));

    return [
      { mode: 'flyer' as FarmSessionMode, title: 'Flyer run 1', scheduledDate: atMonth(0) },
      { mode: 'social_ad' as FarmSessionMode, title: 'Social media ad campaign 1', scheduledDate: atMonth(1) },
      { mode: 'doorknock' as FarmSessionMode, title: 'Door knocking session 1', scheduledDate: atMonth(2) },
      { mode: 'flyer' as FarmSessionMode, title: 'Flyer run 2', scheduledDate: atMonth(3) },
      { mode: 'social_ad' as FarmSessionMode, title: 'Social media ad campaign 2', scheduledDate: atMonth(4) },
      { mode: 'phone_call' as FarmSessionMode, title: 'Phone call campaign', scheduledDate: atMonth(5) },
      { mode: 'flyer' as FarmSessionMode, title: 'Flyer run 3', scheduledDate: atMonth(6) },
      { mode: 'social_ad' as FarmSessionMode, title: 'Social media ad campaign 3', scheduledDate: atMonth(7) },
      { mode: 'doorknock' as FarmSessionMode, title: 'Door knocking session 2', scheduledDate: atMonth(8) },
      { mode: 'flyer' as FarmSessionMode, title: 'Flyer run 4', scheduledDate: atMonth(9) },
      { mode: 'social_ad' as FarmSessionMode, title: 'Social media ad campaign 4', scheduledDate: atMonth(10) },
      { mode: 'event' as FarmSessionMode, title: 'Community event or pop-by', scheduledDate: atMonth(11) },
    ];
  };

  const updateCustomTouchCount = (value: CustomFarmTouchOptionValue, nextCount: number) => {
    setCustomTouchCounts((current) => {
      const next = {
        ...current,
        [value]: Math.max(0, Number.isFinite(nextCount) ? Math.floor(nextCount) : 0),
      };
      const nextTotal = getCustomPlanTouchCount(next, customExtraTouchesRef.current);
      setTouchesPerInterval(nextTotal);
      return next;
    });
  };

  const updateCustomExtraTouchCount = (id: string, nextCount: number) => {
    setCustomExtraTouches((current) => {
      const next = current.map((touch) =>
        touch.id === id
          ? { ...touch, count: Math.max(0, Number.isFinite(nextCount) ? Math.floor(nextCount) : 0) }
          : touch
      );
      setTouchesPerInterval(getCustomPlanTouchCount(customTouchCountsRef.current, next));
      return next;
    });
  };

  const addCustomOtherTouch = () => {
    const label = customOtherInput.trim();
    if (!label) return;
    setCustomExtraTouches((current) => {
      const existing = current.find((touch) => touch.label.toLowerCase() === label.toLowerCase());
      const next = existing
        ? current.map((touch) => (touch.id === existing.id ? { ...touch, count: touch.count + 1 } : touch))
        : [...current, { id: `custom-${Date.now()}`, label, count: 1 }];
      setTouchesPerInterval(getCustomPlanTouchCount(customTouchCountsRef.current, next));
      return next;
    });
    setCustomOtherInput('');
  };

  const buildCustomFarmTouchPlan = (farm: CreatedFarm): Array<{
    mode: FarmSessionMode;
    title: string;
    scheduledDate: string;
  }> => {
    const counts = customTouchCountsRef.current;
    const plannedTouches = CUSTOM_FARM_TOUCH_OPTIONS.flatMap((option) => {
      const count = Math.max(0, counts[option.value] || 0);
      return Array.from({ length: count }, (_, index) => ({
        mode: option.mode,
        title: count > 1 ? `${option.sessionTitle} ${index + 1}` : option.sessionTitle,
      }));
    }).concat(
      customExtraTouchesRef.current.flatMap((touch) =>
        Array.from({ length: Math.max(0, touch.count || 0) }, (_, index) => ({
          mode: 'event' as FarmSessionMode,
          title: touch.count > 1 ? `${touch.label} ${index + 1}` : touch.label,
        }))
      )
    );
    const totalTouches = Math.max(1, plannedTouches.length);
    const start = new Date(`${String(farm.start_date).slice(0, 10)}T12:00:00`);
    const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
    const spacingDays = Math.max(1, Math.floor(365 / totalTouches));

    return plannedTouches.map((plannedTouch, index) => {
      return {
        ...plannedTouch,
        scheduledDate: formatDateInput(addDays(safeStart, index * spacingDays)),
      };
    });
  };

  const createPlannedFarmTouches = async (farm: CreatedFarm) => {
    if (touchPlanCreatedRef.current) return;
    touchPlanCreatedRef.current = true;
    const autoPlan =
      farmTemplateRef.current === 'flyr'
        ? buildFlyrFarmTemplatePlan(farm)
        : buildCustomFarmTouchPlan(farm);

    for (const [index, plannedTouch] of autoPlan.entries()) {
      await FarmTouchService.createSession({
        farmId: farm.id,
        workspaceId: farm.workspace_id ?? currentWorkspaceId ?? undefined,
        cycleNumber: index + 1,
        mode: plannedTouch.mode,
        title: plannedTouch.title,
        scheduledDate: new Date(`${plannedTouch.scheduledDate}T12:00:00`).toISOString(),
      });
    }
  };

  const finalizeFarmSetupAndOpen = async () => {
    const farm = createdFarmRef.current;
    if (!farm || finalizingRef.current || hasNavigatedToFarm) return;
    finalizingRef.current = true;
    try {
      setSetupStatusText('Creating touch plan...');
      await createPlannedFarmTouches(farm);
      setHasNavigatedToFarm(true);
      router.push(`/farms/${farm.id}`);
    } catch (error) {
      console.error('Error creating farm touch plan:', error);
      finalizingRef.current = false;
      setSetupFailed(true);
      setSetupStatusText('Farm was created, but touch sessions need another try.');
      await showFeedbackDialog({
        title: 'Touch plan incomplete',
        description: 'Farm details were saved, but the starter touch plan could not be created. You can add sessions from the farm later.',
        tone: 'warning',
      });
      router.push(`/farms/${farm.id}`);
    }
  };

  const runBackgroundFarmSetup = async (farm: CreatedFarm, campaignId: string) => {
    let insertedCount = 0;
    setSetupFailed(false);
    setSetupComplete(false);
    setupCompleteRef.current = false;
    setProvisioning(true);
    setSetupStatusText('Scanning map data and linking homes...');
    let progressStep = 'Scanning 3D Shapes...';

    const progressInterval = setInterval(() => {
      if (progressStep === 'Scanning 3D Shapes...') {
        progressStep = 'Matching Addresses...';
        setSetupStatusText('Matching addresses in the farm...');
        return;
      }
      if (progressStep === 'Matching Addresses...') {
        progressStep = 'Finalizing Mission Territory...';
        setSetupStatusText('Finalizing farm territory...');
      }
    }, 2000);

    try {
      const provisionResponse = await fetch('/api/campaigns/provision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
        }),
      });

      clearInterval(progressInterval);
      setSetupStatusText('Finalizing farm territory...');

      if (!provisionResponse.ok) {
        const error = await provisionResponse.json().catch(() => ({}));
        throw new Error(error.error || `Failed to provision farm homes (${provisionResponse.status})`);
      }

      const result = await provisionResponse.json();
      insertedCount = result.addresses_saved || 0;
      setAddressCount(insertedCount);
      const { addresses_saved = 0, links_created = 0 } = result;
      if (links_created < addresses_saved) {
        setSetupStatusText(`Linking: ${links_created} / ${addresses_saved} addresses...`);
      }
      if (result.warning) {
        setSetupStatusText(result.warning);
      }
      await new Promise((resolve) => setTimeout(resolve, 800));

      setProvisioning(false);
      setSyncingFarm(true);
      setSetupStatusText('Syncing farm homes...');
      const syncResponse = await fetch(`/api/farms/${farm.id}/sync-addresses`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!syncResponse.ok) {
        const error = await syncResponse.json().catch(() => ({}));
        throw new Error(error.error || `Failed to sync farm homes (${syncResponse.status})`);
      }

      const syncResult = await syncResponse.json();
      setGeneratedHomes(syncResult.inserted_count || insertedCount || 0);
      setSetupStatusText('Farm homes are ready.');
      setSetupComplete(true);
      setupCompleteRef.current = true;

      if (detailsSavedRef.current) {
        await finalizeFarmSetupAndOpen();
      }
    } catch (error) {
      console.error('Error setting up farm:', error);
      setSetupFailed(true);
      setSetupStatusText('Farm was created, but setup needs another try.');
      await showFeedbackDialog({
        title: 'Setup incomplete',
        description: 'Farm was created, but home linking or sync failed. You can retry later from the farm.',
        tone: 'warning',
      });
      setSetupComplete(true);
      setupCompleteRef.current = true;
      if (detailsSavedRef.current) {
        await finalizeFarmSetupAndOpen();
      }
    } finally {
      clearInterval(progressInterval);
      setProvisioning(false);
      setSyncingFarm(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId || createdFarm) return;

    const drawn = await getDrawnFarmPolygon();
    if (!drawn) return;

    setLoading(true);
    try {
      const createRes = await fetch('/api/farms', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled Farm',
          description: undefined,
          polygon: JSON.stringify(drawn.polygon),
          start_date: startDate,
          end_date: formatDateInput(addDays(new Date(`${startDate}T12:00:00`), DEFAULT_FARM_DURATION_DAYS)),
          frequency: 1,
          touches_per_interval: 1,
          touches_interval: 'year',
          goal_type: 'touches_per_year',
          goal_target: DEFAULT_TOUCHES_PER_YEAR,
          cycle_completion_window_days: null,
          touch_types: [],
          annual_budget_cents: null,
          include_social_ads_in_spend: false,
          workspace_id: currentWorkspaceId ?? undefined,
          area_label: drawn.bbox ? `Area ${drawn.bbox[1].toFixed(3)}, ${drawn.bbox[0].toFixed(3)}` : undefined,
          home_limit: DEFAULT_HOME_LIMIT,
        }),
      });
      if (!createRes.ok) {
        const error = await createRes.json().catch(() => ({}));
        throw new Error(error.error || `Failed to create farm (${createRes.status})`);
      }

      const farm = await createRes.json();
      const campaignId = farm.linked_campaign_id as string | undefined;
      if (!campaignId) {
        throw new Error('Linked campaign id was not returned for this farm');
      }

      const nextFarm = farm as CreatedFarm;
      setCreatedFarm(nextFarm);
      createdFarmRef.current = nextFarm;
      setSetupStatusText('Starting farm setup...');
      void runBackgroundFarmSetup(nextFarm, campaignId);
    } catch (error) {
      console.error('Error creating farm:', error);
      await showFeedbackDialog({
        title: 'Couldn’t create farm',
        description: getErrorMessage(error),
        tone: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const validateFarmDetailsStep = async (): Promise<boolean> => {
    if (!name.trim()) {
      await showFeedbackDialog({
        title: 'Farm name required',
        description: 'Name this farm before continuing.',
        tone: 'warning',
      });
      return false;
    }
    if (!startDate) {
      await showFeedbackDialog({
        title: 'Start date required',
        description: 'Choose a start date before saving this farm.',
        tone: 'warning',
      });
      return false;
    }
    if (!Number.isFinite(touchesPerInterval) || touchesPerInterval < 1) {
      await showFeedbackDialog({
        title: 'Touch frequency required',
        description: 'Enter at least 1 planned touch per year before continuing.',
        tone: 'warning',
      });
      return false;
    }

    const annualBudgetCents = await getAnnualizedMonthlySpendCents();
    if (annualBudgetCents === undefined) return false;
    return true;
  };

  const handleFarmDetailsNext = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (await validateFarmDetailsStep()) {
      setWizardStep('template');
    }
  };

  const resolveTouchTypesForSave = (): FarmTouchType[] => {
    const nextTypes =
      farmTemplate === 'flyr'
        ? (['event', 'phone_call', 'flyer', 'doorknock', 'social_ad'] as FarmTouchType[])
        : CUSTOM_FARM_TOUCH_OPTIONS
            .filter((option) => (customTouchCounts[option.value] || 0) > 0 && option.touchType)
            .map((option) => option.touchType as FarmTouchType)
            .concat(customExtraTouches.some((touch) => touch.count > 0) ? (['event'] as FarmTouchType[]) : []);
    const next = new Set(nextTypes);
    if (includeSocialAdsInSpend) next.add('social_ad');
    return Array.from(next);
  };

  const loadMetaCampaigns = async (adAccountId: string) => {
    if (!adAccountId) return;
    setLoadingMetaCampaigns(true);
    setMetaError(null);
    try {
      const response = await fetch(`/api/meta/campaigns?adAccountId=${encodeURIComponent(adAccountId)}`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to load Meta campaigns.');
      const campaigns = (payload?.campaigns ?? []) as MetaCampaign[];
      setMetaCampaigns(campaigns);
      setSelectedMetaCampaignId(campaigns[0]?.id ?? '');
    } catch (error) {
      setMetaCampaigns([]);
      setSelectedMetaCampaignId('');
      setMetaError(getErrorMessage(error));
    } finally {
      setLoadingMetaCampaigns(false);
    }
  };

  const loadMetaSetup = async (): Promise<number> => {
    const farm = createdFarmRef.current;
    if (!farm) return 0;
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [connectionResponse, linksResponse] = await Promise.all([
        fetch('/api/meta/connection', { credentials: 'include' }),
        fetch(`/api/farms/${farm.id}/meta-campaign-links`, { credentials: 'include' }),
      ]);
      const connectionPayload = await connectionResponse.json().catch(() => null);
      const linksPayload = await linksResponse.json().catch(() => null);
      if (!connectionResponse.ok) throw new Error(connectionPayload?.error || 'Failed to load Meta connection.');
      if (!linksResponse.ok) throw new Error(linksPayload?.error || 'Failed to load linked Meta campaigns.');

      setMetaConnection(connectionPayload as MetaConnectionStatus);
      const nextLinkCount = Array.isArray(linksPayload?.links) ? linksPayload.links.length : 0;
      setMetaLinkCount(nextLinkCount);

      if (connectionPayload?.connected) {
        const accountsResponse = await fetch('/api/meta/ad-accounts', { credentials: 'include' });
        const accountsPayload = await accountsResponse.json().catch(() => null);
        if (!accountsResponse.ok) throw new Error(accountsPayload?.error || 'Failed to load Meta ad accounts.');
        const accounts = (accountsPayload?.ad_accounts ?? []) as MetaAdAccount[];
        setMetaAdAccounts(accounts);
        const firstAccount = accounts[0]?.meta_ad_account_id ?? '';
        setSelectedMetaAdAccountId(firstAccount);
        if (firstAccount) {
          await loadMetaCampaigns(firstAccount);
        }
      }

      return nextLinkCount;
    } catch (error) {
      setMetaError(getErrorMessage(error));
      return 0;
    } finally {
      setLoadingMeta(false);
    }
  };

  const handleMetaConnect = () => {
    const farm = createdFarmRef.current;
    if (!farm) return;
    const params = new URLSearchParams({ farmId: farm.id });
    if (farm.workspace_id ?? currentWorkspaceId) {
      params.set('workspaceId', (farm.workspace_id ?? currentWorkspaceId)!);
    }
    const popup = window.open(
      `/api/meta/oauth/start?${params.toString()}`,
      'flyr-meta-connect',
      'width=720,height=820'
    );
    if (!popup) {
      setMetaError('Allow pop-ups for this site, then connect Meta Ads again.');
      return;
    }
    setMetaError(null);
    const refreshWhenClosed = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(refreshWhenClosed);
      void loadMetaSetup();
    }, 1000);
  };

  const handleMetaAccountChange = (adAccountId: string) => {
    setSelectedMetaAdAccountId(adAccountId);
    void loadMetaCampaigns(adAccountId);
  };

  const handleLinkMetaCampaign = async () => {
    const farm = createdFarmRef.current;
    const campaign = metaCampaigns.find((candidate) => candidate.id === selectedMetaCampaignId);
    if (!farm || !selectedMetaAdAccountId || !campaign) return;

    setLinkingMeta(true);
    setMetaError(null);
    try {
      const response = await fetch(`/api/farms/${farm.id}/meta-campaign-links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_ad_account_id: selectedMetaAdAccountId,
          meta_campaign_id: campaign.id,
          meta_campaign_name: campaign.name,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to link Meta campaign.');

      const nextLinkCount = await loadMetaSetup();
      if (nextLinkCount > 0) {
        setDetailsSaved(true);
        detailsSavedRef.current = true;
        if (setupCompleteRef.current) {
          await finalizeFarmSetupAndOpen();
        }
      }
    } catch (error) {
      setMetaError(getErrorMessage(error));
    } finally {
      setLinkingMeta(false);
    }
  };

  const handleDetailsSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    const farm = createdFarmRef.current;
    if (!farm || detailsSaving || hasNavigatedToFarm) return;
    if (!(await validateFarmDetailsStep())) return;
    if (farmTemplate === 'custom' && customPlanTouchCount < 1) {
      await showFeedbackDialog({
        title: 'Add at least one touch',
        description: 'Set a count for at least one custom touch or use the FLYR FARM template.',
        tone: 'warning',
      });
      return;
    }
    const annualBudgetCents = await getAnnualizedMonthlySpendCents();
    if (annualBudgetCents === undefined) return;
    const resolvedTouchTypes = resolveTouchTypesForSave();
    const resolvedTouchesPerYear = farmTemplate === 'flyr' ? FLYR_FARM_TOUCH_COUNT : customPlanTouchCount;

    setDetailsSaving(true);
    try {
      const response = await fetch(`/api/farms/${farm.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: farmTemplate === 'flyr' ? 'FLYR FARM proven annual template.' : null,
          start_date: startDate,
          end_date: formatDateInput(addDays(new Date(`${startDate}T12:00:00`), DEFAULT_FARM_DURATION_DAYS)),
          touches_per_interval: 1,
          touches_interval: 'year',
          goal_type: 'touches_per_year',
          goal_target: resolvedTouchesPerYear,
          cycle_completion_window_days: null,
          touch_types: resolvedTouchTypes,
          annual_budget_cents: annualBudgetCents,
          include_social_ads_in_spend: includeSocialAdsInSpend,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Failed to save farm details (${response.status})`);
      }
      const updatedFarm = await response.json();
      const nextFarm = {
        ...farm,
        ...updatedFarm,
      } as CreatedFarm;
      setCreatedFarm(nextFarm);
      createdFarmRef.current = nextFarm;

      setDetailsSaved(true);
      detailsSavedRef.current = true;

      if (setupCompleteRef.current) {
        await finalizeFarmSetupAndOpen();
      }
    } catch (error) {
      console.error('Error saving farm details:', error);
      await showFeedbackDialog({
        title: 'Couldn’t save farm details',
        description: getErrorMessage(error),
        tone: 'destructive',
      });
    } finally {
      setDetailsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-gray-50 dark:bg-background overflow-hidden">
      {showingDetailsStep ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4 backdrop-blur-md">
          <div className="relative z-[60] flex max-h-[calc(100vh-4rem)] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl">
            <div ref={formScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 pb-10">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Farm</p>
                <h2 className="text-xl font-semibold text-foreground">
                  {wizardStep === 'details'
                    ? 'Farm Details'
                    : wizardStep === 'template'
                      ? 'Farm Template'
                      : 'Link Social Ads'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {wizardStep === 'details'
                    ? 'Name the farm and set the yearly rhythm.'
                    : wizardStep === 'template'
                      ? 'Choose the proven FLYR FARM plan or build your own.'
                      : 'Link Meta data to keep farm data and finances in one place.'}
                </p>
              </div>

              {wizardStep === 'details' ? (
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Farm name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoFocus
                      placeholder="Downtown Repeat Farm"
                      disabled={detailsSaving}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="touchesPerYear">Frequency of touches</Label>
                    <Input
                      id="touchesPerYear"
                      type="number"
                      min="1"
                      value={touchesPerInterval < 1 ? '' : String(touchesPerInterval)}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          setTouchesPerInterval(0);
                          return;
                        }
                        const parsed = parseInt(e.target.value, 10);
                        setTouchesPerInterval(Number.isFinite(parsed) ? Math.max(1, parsed) : 0);
                      }}
                      disabled={detailsSaving}
                    />
                    <p className="text-xs text-muted-foreground">Total planned touches per year.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="monthlySpend">Monthly spend</Label>
                    <Input
                      id="monthlySpend"
                      type="number"
                      min="0"
                      step="0.01"
                      value={monthlySpend}
                      onChange={(e) => setMonthlySpend(e.target.value)}
                      placeholder="Optional"
                      disabled={detailsSaving}
                    />
                    <p className="text-xs text-muted-foreground">Saved as an annualized farm budget.</p>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Include social media ads in spend</p>
                      <p className="text-xs text-muted-foreground">
                        We need to link Meta data to keep farm data and finances in one place.
                      </p>
                    </div>
                    <Switch
                      checked={includeSocialAdsInSpend}
                      onCheckedChange={setIncludeSocialAdsInSpend}
                      disabled={detailsSaving}
                    />
                  </div>
                </div>
              ) : null}

              {wizardStep === 'template' ? (
                <div className="mt-6 space-y-4">
                  <button
                    type="button"
                    onClick={() => {
                      setFarmTemplate('flyr');
                      setTouchesPerInterval(FLYR_FARM_TOUCH_COUNT);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      farmTemplate === 'flyr'
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/20 hover:bg-muted/40'
                    }`}
                    disabled={detailsSaving}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">FLYR FARM 12</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          One touch per month to stay visible in your farm.
                        </p>
                      </div>
                      <Badge variant="secondary">12 touches</Badge>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {FLYR_FARM_TEMPLATE_SUMMARY.map((item) => (
                        <div key={item} className="rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground">
                          {item}
                        </div>
                      ))}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFarmTemplate('custom');
                      setTouchesPerInterval(customPlanTouchCount);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      farmTemplate === 'custom'
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-muted/20 hover:bg-muted/40'
                    }`}
                    disabled={detailsSaving}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">Custom plan</p>
                        <p className="mt-1 text-sm text-muted-foreground">Choose what this farm should do.</p>
                      </div>
                      <Badge variant="secondary">
                        {customPlanTouchCount.toLocaleString()} {customPlanTouchCount === 1 ? 'touch' : 'touches'}
                      </Badge>
                    </div>
                  </button>

                  {farmTemplate === 'custom' ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {CUSTOM_FARM_TOUCH_OPTIONS.map((option) => {
                        const count = customTouchCounts[option.value] || 0;
                        const selected = count > 0;
                        return (
                          <div
                            key={option.value}
                            className={`rounded-md border bg-background/60 px-2.5 py-2 text-sm transition ${
                              selected
                                ? 'border-primary/70'
                                : 'border-border'
                            }`}
                          >
                            <div className="flex min-h-8 items-center justify-between gap-2">
                              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{option.label}</p>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  className="size-7"
                                  disabled={detailsSaving || count < 1}
                                  onClick={() => updateCustomTouchCount(option.value, count - 1)}
                                >
                                  <Minus className="size-4" />
                                </Button>
                                <Input
                                  aria-label={`${option.label} count`}
                                  className="h-7 w-10 text-center"
                                  type="number"
                                  min="0"
                                  value={String(count)}
                                  disabled={detailsSaving}
                                  onChange={(event) => updateCustomTouchCount(option.value, Number(event.target.value))}
                                />
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  className="size-7"
                                  disabled={detailsSaving}
                                  onClick={() => updateCustomTouchCount(option.value, count + 1)}
                                >
                                  <Plus className="size-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {customExtraTouches.map((touch) => (
                        <div
                          key={touch.id}
                          className={`rounded-md border bg-background/60 px-2.5 py-2 text-sm transition ${
                            touch.count > 0 ? 'border-primary/70' : 'border-border'
                          }`}
                        >
                          <div className="flex min-h-8 items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{touch.label}</p>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="outline"
                                className="size-7"
                                disabled={detailsSaving || touch.count < 1}
                                onClick={() => updateCustomExtraTouchCount(touch.id, touch.count - 1)}
                              >
                                <Minus className="size-4" />
                              </Button>
                              <Input
                                aria-label={`${touch.label} count`}
                                className="h-7 w-10 text-center"
                                type="number"
                                min="0"
                                value={String(touch.count)}
                                disabled={detailsSaving}
                                onChange={(event) => updateCustomExtraTouchCount(touch.id, Number(event.target.value))}
                              />
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="outline"
                                className="size-7"
                                disabled={detailsSaving}
                                onClick={() => updateCustomExtraTouchCount(touch.id, touch.count + 1)}
                              >
                                <Plus className="size-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="rounded-md border border-border bg-background/60 px-2.5 py-2 text-sm">
                        <div className="flex min-h-8 items-center gap-2">
                          <Input
                            className="h-7 min-w-0 flex-1"
                            value={customOtherInput}
                            onChange={(event) => setCustomOtherInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                addCustomOtherTouch();
                              }
                            }}
                            placeholder="Other touch"
                            disabled={detailsSaving}
                          />
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            className="size-7"
                            disabled={detailsSaving || !customOtherInput.trim()}
                            onClick={addCustomOtherTouch}
                          >
                            <Plus className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {wizardStep === 'meta' ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {loadingMeta ? (
                          <Loader2 className="size-5 animate-spin text-primary" />
                        ) : metaLinkCount > 0 ? (
                          <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <TriangleAlert className="size-5 text-amber-600 dark:text-amber-400" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-foreground">
                          {metaLinkCount > 0 ? 'Meta campaign linked' : 'Meta data connection'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Link Meta data to keep farm data and finances in one place.
                        </p>
                      </div>
                    </div>
                  </div>

                  {metaError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {metaError}
                    </div>
                  ) : null}

                  {!loadingMeta && !metaConnection?.connected ? (
                    <Button type="button" className="w-full" onClick={handleMetaConnect}>
                      Connect Meta Ads
                    </Button>
                  ) : null}

                  {metaConnection?.connected ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Ad account</Label>
                        <Select
                          value={selectedMetaAdAccountId}
                          onValueChange={handleMetaAccountChange}
                          disabled={loadingMeta || linkingMeta || metaAdAccounts.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select an ad account" />
                          </SelectTrigger>
                          <SelectContent>
                            {metaAdAccounts.map((account) => (
                              <SelectItem key={account.meta_ad_account_id} value={account.meta_ad_account_id}>
                                {account.name || account.meta_ad_account_id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Meta campaign</Label>
                        <Select
                          value={selectedMetaCampaignId}
                          onValueChange={setSelectedMetaCampaignId}
                          disabled={loadingMetaCampaigns || linkingMeta || metaCampaigns.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={loadingMetaCampaigns ? 'Loading campaigns...' : 'Select a campaign'} />
                          </SelectTrigger>
                          <SelectContent>
                            {metaCampaigns.map((campaign) => (
                              <SelectItem key={campaign.id} value={campaign.id}>
                                {campaign.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        className="w-full"
                        disabled={!selectedMetaAdAccountId || !selectedMetaCampaignId || linkingMeta}
                        onClick={handleLinkMetaCampaign}
                      >
                        {linkingMeta ? 'Linking...' : metaLinkCount > 0 ? 'Link Another Campaign' : 'Link Campaign'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

            </div>

            <div className="shrink-0 border-t border-border bg-card px-6 py-4">
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (wizardStep === 'template') {
                      setWizardStep('details');
                      return;
                    }
                    if (wizardStep === 'meta') {
                      setWizardStep('template');
                      return;
                    }
                    router.back();
                  }}
                  disabled={loading || detailsSaving || linkingMeta || hasNavigatedToFarm}
                >
                  {wizardStep === 'details' ? 'Cancel' : 'Back'}
                </Button>
                {wizardStep === 'details' ? (
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={loading || detailsSaving || hasNavigatedToFarm}
                    onClick={handleFarmDetailsNext}
                  >
                    Next
                  </Button>
                ) : wizardStep === 'template' ? (
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={loading || detailsSaving || hasNavigatedToFarm}
                    onClick={handleDetailsSubmit}
                  >
                    {detailsSaving
                      ? 'Saving...'
                      : setupInProgress
                          ? detailsSaved
                            ? 'Details Saved'
                            : 'Save Details'
                          : detailsSaved
                            ? 'Open Farm'
                            : 'Save & Open'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={loadingMeta || linkingMeta || metaLinkCount < 1}
                    onClick={async () => {
                      setDetailsSaved(true);
                      detailsSavedRef.current = true;
                      if (setupCompleteRef.current) {
                        await finalizeFarmSetupAndOpen();
                      }
                    }}
                  >
                    {setupInProgress ? 'Finish After Setup' : 'Open Farm'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 relative">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <MapInfoButton show={mapLoaded} />
        {mapLoaded && map.current && (
          <UserLocationLayer
            map={map.current}
            mapLoaded={mapLoaded}
            showUserLocation={true}
            onLocationFound={(lng, lat) => {
              if (!hasCenteredOnUserLocationRef.current) {
                hasCenteredOnUserLocationRef.current = true;
                map.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
              }
            }}
            onLocationError={() => {}}
          />
        )}

        {!mapLoaded && !mapError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
            <div className="text-sm text-muted-foreground">Loading map...</div>
          </div>
        ) : null}

        {mapError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-lg border border-border bg-background/95 p-4 text-center shadow-sm">
              <p className="text-sm font-medium text-foreground">Map unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">{mapError}</p>
            </div>
          </div>
        ) : null}

        {mapLoaded && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-10">
            {!showingDetailsStep ? (
              <Button
                type="button"
                size="lg"
                className="h-14 justify-start gap-3 rounded-xl border border-red-600 bg-red-500 px-6 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-red-600 hover:shadow-xl"
                disabled={loading || detailsSaving || hasNavigatedToFarm}
                onClick={handleSubmit}
              >
                {loading ? 'Creating...' : 'Create Territory'}
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
                  Search for an address, then draw the farm boundary.
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

            {!showingDetailsStep ? (
              <>
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

                <button
                  type="button"
                  onClick={clearDrawing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-lg shadow-lg hover:shadow-xl hover:bg-muted/50 transition-all duration-200 text-sm font-medium text-foreground border border-border"
                >
                  <Trash2 className="w-5 h-5" />
                  <span>Clear</span>
                </button>
              </>
            ) : null}
          </div>
        )}

        {mapLoaded && !showingDetailsStep && (
          <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-5 py-2.5 shadow-lg">
            <p className="text-sm text-foreground whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}

        {showingDetailsStep && (setupInProgress || setupFailed || !setupComplete) ? (
          <div className="absolute bottom-6 right-6 z-50 w-[min(360px,calc(100%-3rem))] rounded-lg border border-border bg-card/95 p-4 text-sm shadow-xl backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {setupInProgress ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : setupFailed ? (
                  <TriangleAlert className="size-5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">
                  {setupInProgress ? 'Setting up in the background' : setupFailed ? 'Setup needs attention' : 'Setup queued'}
                </p>
                <p className="text-muted-foreground">
                  {setupStatusText || 'Homes and map data will continue loading while you finish these details.'}
                </p>
                {addressCount !== null ? (
                  <p className="text-muted-foreground">{addressCount.toLocaleString()} homes linked.</p>
                ) : null}
                {generatedHomes !== null ? (
                  <p className="text-muted-foreground">{generatedHomes.toLocaleString()} farm homes synced.</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Dialog open={!!feedbackDialog} onOpenChange={(open) => !open && dismissFeedbackDialog()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          {feedbackDialog ? (
            <>
              <DialogHeader className="text-left sm:text-left">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border ${
                      feedbackDialog.tone === 'destructive'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : feedbackDialog.tone === 'warning'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'border-primary/30 bg-primary/10 text-primary'
                    }`}
                  >
                    {feedbackDialog.tone === 'destructive' ? (
                      <CircleAlert className="size-5" />
                    ) : (
                      <TriangleAlert className="size-5" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <DialogTitle className="text-lg leading-6">{feedbackDialog.title}</DialogTitle>
                    <DialogDescription className="text-sm leading-6">
                      {feedbackDialog.description}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant={feedbackDialog.tone === 'destructive' ? 'destructive' : 'default'}
                  onClick={dismissFeedbackDialog}
                >
                  {feedbackDialog.actionLabel}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
