'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
import {
  TerritoryDrawHint,
} from '@/components/territory/TerritoryCreateFlow';
import { getDrawnPolygon } from '@/lib/territory/create-polygon';
import {
  applyDrawModeForPhase,
  clearTerritoryDrawing,
  useTerritoryCreatePhase,
} from '@/lib/territory/use-territory-create-phase';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, hideBaseBuildingLayers, resolveMapStyle } from '@/lib/map-styles';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { FarmOutreachQuestions } from './FarmOutreachQuestions';
import { defaultOutreachSettings, forecastOutreach } from '@/lib/farms/outreach-schedule';
import { FarmBoundaryAddressCount } from './FarmBoundaryAddressCount';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { UserLocationLayer } from '@/components/map/UserLocationLayer';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { CircleAlert, Map, Pencil, Satellite, Search, Trash2, TriangleAlert } from 'lucide-react';
import * as turf from '@turf/turf';
import Lottie from 'lottie-react';
import { FarmTouchService } from '@/lib/services/FarmService';
import { useStormTerritoryAddressCount } from '@/components/storm-maps/useStormTerritoryAddressCount';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

const DEFAULT_HOME_LIMIT = 5000;
const DEFAULT_FARM_DURATION_DAYS = 365;

type CreateFarmDialogTone = 'default' | 'warning' | 'destructive';

type CreateFarmDialogState = {
  title: string;
  description: string;
  tone: CreateFarmDialogTone;
  actionLabel: string;
};

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
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

export function CreateFarmFlow({ onBack, initialBoundary, initialName = '', onCreated }: {
  onCreated?: () => void;
  onBack?: () => void;
  initialBoundary?: GeoJSON.Polygon | null;
  initialName?: string;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v11'),
    [mapPreset, theme],
  );
  const [farmName, setFarmName] = useState(initialName);
  const [excludeCommercial, setExcludeCommercial] = useState(false);
  const [nameValidationAttempted, setNameValidationAttempted] = useState(false);
  const farmNameInput = useRef<HTMLInputElement>(null);
  const [outreach, setOutreach] = useState(defaultOutreachSettings);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [planWeeks, setPlanWeeks] = useState(52);
  const [boundary, setBoundary] = useState<GeoJSON.Polygon | null>(null);
  const farmLocation = useMemo(() => {
    if (!boundary) return null;
    try { const [longitude, latitude] = turf.pointOnFeature(turf.polygon(boundary.coordinates)).geometry.coordinates; return { latitude, longitude }; }
    catch { return null; }
  }, [boundary]);
  const homeCount = useStormTerritoryAddressCount(currentWorkspaceId ?? '', boundary, '/api/farms/address-count');
  const description =
    'Repeat this area for doorknocks, flyers, Canada Post, pop-bys, or letters.';
  const [startDate, setStartDate] = useState(() => formatDateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [syncingFarm, setSyncingFarm] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [feedbackDialog, setFeedbackDialog] = useState<CreateFarmDialogState | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const appliedBaseStyleKeyRef = useRef<string | null>(null);
  const hasCenteredOnUserLocationRef = useRef(!!initialBoundary);
  const feedbackDialogResolveRef = useRef<(() => void) | null>(null);
  const isDark = theme === 'dark';
  const lottieSrc = useMemo(
    () => (isDark ? '/loading/white.json' : '/loading/black.json'),
    [isDark]
  );
  const { phase, setPhase, startCreating } = useTerritoryCreatePhase({ map, mapLoaded });
  const isBusy = loading || syncingFarm;
  const panelScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelScrollRef.current;
    if (!panel) return;
    // Handle native wheel events before the surrounding page's scroll lock.
    const wheel = (event: WheelEvent) => handleWheelScrollContainer(event, panel);
    panel.addEventListener('wheel', wheel, { passive: false });
    return () => panel.removeEventListener('wheel', wheel);
  }, [mapLoaded]);

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

  useEffect(() => {
    return () => {
      feedbackDialogResolveRef.current?.();
      feedbackDialogResolveRef.current = null;
    };
  }, []);

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
    const buildingFill = isDark ? '#475569' : '#cfd8e3';
    const buildingOutline = isDark ? '#334155' : '#94a3b8';

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
      config: resolvedMapStyle.config,
      center: [-79.35, 43.65],
      zoom: 15,
    });
    appliedBaseStyleKeyRef.current = resolvedMapStyle.key;

    map.current.on('load', () => {
      setMapLoaded(true);
      setMapError(null);
      if (initialBoundary && drawRef.current) {
        drawRef.current.set({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: initialBoundary }] });
        setBoundary(initialBoundary);
        setPhase('naming');
        const bounds = turf.bbox(initialBoundary);
        map.current!.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 80, duration: 0 });
      }
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
      defaultMode: 'simple_select',
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
    const updateBoundary = () => setBoundary(getDrawnPolygon(drawRef.current));
    map.current.on('draw.create', updateBoundary);
    map.current.on('draw.update', updateBoundary);
    map.current.on('draw.delete', updateBoundary);

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
        defaultMode: 'simple_select',
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
      const hasSavedFeatures = (savedFeatures?.features?.length ?? 0) > 0;
      if (hasSavedFeatures && savedFeatures) {
        newDraw.set(savedFeatures);
      }
      applyDrawModeForPhase(newDraw, phase, hasSavedFeatures);
    });
  }, [isSatellite, mapLoaded, phase, resolvedMapStyle]);

  useEffect(() => {
    if (!mapLoaded || !drawRef.current) return;
    const hasSavedFeatures = (drawRef.current.getAll()?.features?.length ?? 0) > 0;
    applyDrawModeForPhase(drawRef.current, phase, hasSavedFeatures);
  }, [mapLoaded, phase]);

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

  const toggleSatelliteView = () => {
    setIsSatellite(!isSatellite);
  };

  const handleStartCreating = () => {
    drawRef.current?.deleteAll();
    savedFeaturesRef.current = null;
    setBoundary(null);
    startCreating();
    drawRef.current?.changeMode('draw_polygon');
  };

  const handlePrimaryCreateAction = async () => {
    if (phase === 'idle') {
      handleStartCreating();
      return;
    }

    if (phase === 'drawing') {
      const polygon = getDrawnPolygon(drawRef.current);
      if (!polygon) {
        await showFeedbackDialog({
          title: 'Finish the boundary',
          description: 'Double-click to finish your shape, then try creating the farm again.',
          tone: 'warning',
        });
        return;
      }
      setPhase('naming');
      drawRef.current?.changeMode('simple_select');
      return;
    }

    void handleSubmit();
  };

  const clearDrawing = () => {
    setBoundary(null);
    const nextPhase = clearTerritoryDrawing(drawRef.current, phase);
    setPhase(nextPhase);
  };

  const startDrawing = () => {
    if (phase === 'idle') {
      handleStartCreating();
      return;
    }
    drawRef.current?.changeMode('draw_polygon');
    setPhase('drawing');
  };

  const handleNamingBack = () => {
    setPhase('drawing');
    drawRef.current?.changeMode('simple_select');
  };

  const handleMapSearchSelect = (suggestion: AddressSuggestion) => {
    if (!map.current || !mapLoaded) return;

    map.current.flyTo({
      center: [suggestion.coordinate.longitude, suggestion.coordinate.latitude],
      zoom: 18,
      duration: 1500,
    });
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId) {
      await showFeedbackDialog({ title: 'Sign in required', description: 'Sign in before creating a farm.', tone: 'warning' });
      return;
    }
    setNameValidationAttempted(true);
    if (!farmName.trim()) {
      farmNameInput.current?.focus();
      return;
    }
    try {
      forecastOutreach(homeCount.data?.count ?? 0, startDate, planWeeks, outreach);
    } catch (error) {
      await showFeedbackDialog({ title: 'Check your plan', description: getErrorMessage(error), tone: 'warning' });
      return;
    }
    if (!startDate) {
      await showFeedbackDialog({
        title: 'Start date required',
        description: 'Choose a start date before creating this farm.',
        tone: 'warning',
      });
      return;
    }
    const polygon = getDrawnPolygon(drawRef.current);
    if (!polygon) {
      await showFeedbackDialog({
        title: 'Finish the boundary',
        description: 'Double-click to finish your shape, then try creating the farm again.',
        tone: 'warning',
      });
      return;
    }

    let bbox: number[] | undefined;

    try {
      const turfPolygon = turf.polygon(polygon.coordinates);
      const calculatedBbox = turf.bbox(turfPolygon);
      bbox = [calculatedBbox[0], calculatedBbox[1], calculatedBbox[2], calculatedBbox[3]];
    } catch (bboxError) {
      console.error('Error calculating bbox from polygon:', bboxError);
    }

    setLoading(true);
    try {
      const createRes = await fetch('/api/farms', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: farmName.trim(),
          campaign_name: farmName.trim(),
          description: description.trim() || undefined,
          polygon: JSON.stringify(polygon),
          start_date: startDate,
          end_date: formatDateInput(addDays(new Date(`${startDate}T12:00:00`), DEFAULT_FARM_DURATION_DAYS)),
          frequency: 1,
          touches_per_interval: 1,
          touches_interval: 'month',
          goal_type: 'homes_per_cycle',
          goal_target: homeCount.data?.count ?? outreach.doorsPerDay,
          cycle_completion_window_days: null,
          touch_types: [...(outreach.doorPasses ? ['doorknock'] : []), ...(outreach.callPasses ? ['phone_call'] : [])],
          coverage_settings: { startDate, weeksInPlan: planWeeks, homesPerWeek: outreach.doorsPerDay * outreach.workingDays.length, weeksOff: [], outreach },
          annual_budget_cents: null,
          workspace_id: currentWorkspaceId ?? undefined,
          area_label: bbox ? `Area ${bbox[1].toFixed(3)}, ${bbox[0].toFixed(3)}` : undefined,
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

      setSyncingFarm(true);
      const importResponse = await fetch(`/api/farms/${farm.id}/import-homes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excludeCommercial }) });
      const imported = await importResponse.json();
      if (!importResponse.ok) {
        await showFeedbackDialog({ title: 'Farm saved — homes need importing', description: imported.error || 'Retry importing homes from the Dashboard.', tone: 'warning' });
      } else if (imported.totalCount > 0) {
        const planResponse = await fetch(`/api/farms/${farm.id}/annual-coverage`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, weeksInPlan: planWeeks, homesPerWeek: outreach.doorsPerDay * outreach.workingDays.length, weeksOff: [], outreach }),
        });
        if (!planResponse.ok) {
          const result = await planResponse.json().catch(() => ({}));
          await showFeedbackDialog({ title: 'Farm saved — review your plan', description: result.error || 'Open Annual farm coverage on the Dashboard to finish the plan.', tone: 'warning' });
        }
        if (homeCount.data && imported.totalCount !== homeCount.data.count) {
          await showFeedbackDialog({ title: 'Farm plan updated', description: `The map estimated ${homeCount.data.count.toLocaleString()} addresses; ${imported.totalCount.toLocaleString()} were imported. Your saved plan uses the imported homes.`, tone: 'warning' });
        }
      }
      if (importResponse.ok && excludeCommercial) {
        await showFeedbackDialog({ title: 'Business filter applied', description: `${imported.excludedCount ?? 0} matched addresses were excluded. You can review and restore them from the farm dashboard.`, tone: 'default' });
      }
      if (importResponse.ok && imported.totalCount > 0) {
        const schedule = forecastOutreach(imported.totalCount, startDate, planWeeks, outreach);
        try {
          const rounds = [
            ...schedule.doorRoundDates.map((date, index) => ({ date, mode: 'doorknock' as const, title: `Door-knocking round ${index + 1}` })),
            ...schedule.callRoundDates.map((date, index) => ({ date, mode: 'phone_call' as const, title: `Calling round ${index + 1}` })),
          ].filter(round => round.date).sort((a, b) => a.date!.localeCompare(b.date!));
          for (const [index, round] of rounds.entries()) {
            await FarmTouchService.createSession({ farmId: farm.id, workspaceId: farm.workspace_id ?? currentWorkspaceId, mode: round.mode, title: round.title,
              cycleNumber: index + 1, scheduledDate: `${round.date}T12:00:00`, homesTarget: imported.totalCount });
          }
        } catch (error) {
          await showFeedbackDialog({ title: 'Farm saved — touchpoints need attention', description: `Your plan is saved. Add any missing touchpoints on the Dashboard. ${getErrorMessage(error)}`, tone: 'warning' });
        }
      }
      try { localStorage.setItem(`wolfgrid:farm-plan-mode:${farm.id}`, 'annual'); } catch {}
      onCreated?.();

      router.push(`/farms/${farm.id}?tab=plan`);
      window.dispatchEvent(new CustomEvent('flyr-farms-refresh'));
    } catch (error) {
      console.error('Error creating farm:', error);
      await showFeedbackDialog({
        title: 'Couldn’t create farm',
        description: getErrorMessage(error),
        tone: 'destructive',
      });
    } finally {
      setSyncingFarm(false);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 dark:bg-background">
      <div className="relative min-h-0 flex-1">
        <div ref={mapContainer} className="absolute inset-0 h-full w-full" />
        <MapInfoButton show={mapLoaded} />
        {onBack ? <div className="absolute left-5 top-3 z-30 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={isBusy} onClick={onBack}>← Campaign</Button>
          <span className="rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white">Farm</span>
          <Button variant="outline" asChild><Link href="/farms">Saved farms</Link></Button>
        </div> : null}
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

        {mapLoaded ? (
          <div className={`absolute right-5 top-5 z-20 flex w-[min(22rem,calc(100%-2.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background/92 shadow-2xl backdrop-blur-md ${phase === 'naming' ? 'bottom-5' : 'max-h-[calc(100%-2.5rem)]'}`}>
            <div ref={panelScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [touch-action:pan-y]">
              {phase !== 'naming' && <button
                type="button"
                disabled={isBusy}
                onClick={() => void handlePrimaryCreateAction()}
                className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-red-500 px-5 text-lg font-semibold text-white shadow-xl transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-2xl leading-none">+</span>
                <span>{isBusy ? 'Creating...' : 'Create farm'}</span>
              </button>}

              {phase === 'naming' ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="farm-name">Farm name</Label>
                    <Input
                      id="farm-name"
                      ref={farmNameInput}
                      required
                      aria-invalid={nameValidationAttempted && !farmName.trim()}
                      aria-describedby={nameValidationAttempted && !farmName.trim() ? "farm-name-error" : undefined}
                      value={farmName}
                      onChange={(e) => setFarmName(e.target.value)}
                      placeholder="Downtown Repeat Farm"
                      className="h-11 bg-background"
                    />
                    {nameValidationAttempted && !farmName.trim() && <p id="farm-name-error" role="alert" className="text-sm text-destructive">Enter a farm name.</p>}
                  </div>
                  <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Plan dates</summary><div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label htmlFor="farm-start">Start date</Label>
                      <Input id="farm-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="farm-weeks">Plan length (weeks)</Label>
                      <Input id="farm-weeks" type="number" min={1} max={52} value={planWeeks || ''} onChange={e => setPlanWeeks(Number(e.target.value))} /></div>
                  </div></details>
                  <FarmOutreachQuestions value={outreach} onChange={setOutreach} totalHomes={homeCount.data?.count ?? null} startDate={startDate} weeks={planWeeks} estimated location={farmLocation} onHolidayLoadingChange={setHolidayLoading} />
                  <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
                    <input type="checkbox" checked={excludeCommercial} onChange={e => setExcludeCommercial(e.target.checked)} className="mt-1" />
                    <span><span className="font-medium">Remove matching businesses</span><span className="mt-1 block text-muted-foreground">Durham only. Review and restore matches after creation.</span></span>
                  </label>
                  {homeCount.error && <div className="text-sm text-amber-500" role="alert">Address count unavailable. <button type="button" onClick={homeCount.retry} className="underline">Retry</button></div>}
                </div>
              ) : null}

              {phase !== 'naming' && <><div className="space-y-2">
                <Label htmlFor="farm-map-search" className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search address
                </Label>
                <AddressAutocomplete
                  value={mapSearchQuery}
                  onChange={setMapSearchQuery}
                  onSelect={handleMapSearchSelect}
                  placeholder="Search an address..."
                  className="flex-1"
                  inputClassName="h-11 bg-background"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={toggleSatelliteView}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted/50"
                >
                  {isSatellite ? <Map className="h-5 w-5" /> : <Satellite className="h-5 w-5" />}
                  <span>{isSatellite ? 'Map' : 'Satellite'}</span>
                </button>
                <button
                  type="button"
                  onClick={startDrawing}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-red-600 bg-red-500 px-3 text-sm font-medium text-white transition hover:bg-red-600"
                >
                  <Pencil className="h-5 w-5" />
                  <span>Draw</span>
                </button>
              </div>

              <button
                type="button"
                onClick={clearDrawing}
                disabled={phase === 'idle'}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-5 w-5" />
                <span>Clear boundary</span>
              </button>

              <FarmBoundaryAddressCount map={map} draw={drawRef} mapLoaded={mapLoaded} workspaceId={currentWorkspaceId} /></>}
            </div>
            {phase === 'naming' && <div className="shrink-0 space-y-2 border-t border-border bg-background p-4">
              <button type="button" disabled={isBusy || holidayLoading || !homeCount.data} onClick={() => void handlePrimaryCreateAction()} className="flex h-12 w-full items-center justify-center rounded-xl bg-[#FA263C] px-5 font-semibold text-white hover:bg-red-600 disabled:opacity-50">{isBusy ? 'Creating…' : 'Create farm'}</button>
              <button type="button" onClick={handleNamingBack} disabled={isBusy} className="text-sm font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-60">Back to drawing</button>
            </div>}
          </div>
        ) : null}

        <TerritoryDrawHint visible={mapLoaded && phase === 'drawing'} />
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

      {(loading || syncingFarm) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
          <div className="mx-4 w-full max-w-lg text-center">
            <div className="flex h-80 w-full items-center justify-center">
              {loadingAnimationData ? (
                <Lottie
                  animationData={loadingAnimationData}
                  loop
                  className="h-full w-full"
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                />
              ) : (
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
              )}
            </div>
            <div className="pt-3">
              <h3 className="mb-3 text-lg font-semibold text-white">Generating Farm</h3>
              <div className="space-y-2">
                <p className="text-sm font-medium text-white/95">{syncingFarm ? 'Importing all addresses and building your weekday plan…' : 'Saving farm boundary…'}</p>
                <p className="text-sm text-white/90">Syncing property data...</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
