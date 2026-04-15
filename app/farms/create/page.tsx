'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
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
import { FarmService } from '@/lib/services/FarmService';
import { FARM_GOAL_TYPE_OPTIONS, FARM_TOUCH_INTERVAL_OPTIONS, formatFarmGoal } from '@/lib/farms/config';
import { FarmTouchTypePicker } from '@/components/farms/FarmTouchTypePicker';
import type { FarmGoalType, FarmTouchInterval, FarmTouchType } from '@/types/database';

const MAP_STYLES = {
  light: 'mapbox://styles/mapbox/streets-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;

const DEFAULT_HOME_LIMIT = 5000;
const DEFAULT_TOUCHES_PER_INTERVAL = 2;
const DEFAULT_FARM_DURATION_DAYS = 365;

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
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

export default function CreateFarmPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(() => formatDateInput(new Date()));
  const [touchesPerInterval, setTouchesPerInterval] = useState(DEFAULT_TOUCHES_PER_INTERVAL);
  const [touchesInterval, setTouchesInterval] = useState<FarmTouchInterval>('month');
  const [goalType, setGoalType] = useState<FarmGoalType>('touches_per_cycle');
  const [goalTarget, setGoalTarget] = useState(DEFAULT_TOUCHES_PER_INTERVAL);
  const [cycleCompletionWindowDays, setCycleCompletionWindowDays] = useState('');
  const [touchTypes, setTouchTypes] = useState<FarmTouchType[]>([]);
  const [annualBudget, setAnnualBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState('');
  const [generatingAddresses, setGeneratingAddresses] = useState(false);
  const [syncingFarm, setSyncingFarm] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [generatedHomes, setGeneratedHomes] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [snappingBoundary, setSnappingBoundary] = useState(false);
  const [boundaryRaw, setBoundaryRaw] = useState<{ type: 'Polygon'; coordinates: number[][][] } | null>(null);
  const [boundarySnapped, setBoundarySnapped] = useState<{ type: 'Polygon'; coordinates: number[][][] } | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const hasCenteredOnUserLocationRef = useRef(false);
  const isDark = theme === 'dark';
  const lottieSrc = useMemo(
    () => (isDark ? '/loading/white.json' : '/loading/black.json'),
    [isDark]
  );

  const currentStepText = syncingFarm
    ? 'Step 5/5: Syncing farm homes'
    : snappingBoundary
        ? 'Step 1/5: Snapping boundary to roads'
        : generatingAddresses
            ? 'Step 3/5: Fetching addresses'
            : provisionProgress.includes('Scanning')
                ? 'Step 4/5: Fetching buildings'
                : provisionProgress.includes('Matching') || provisionProgress.includes('Linking')
                    ? 'Step 4/5: Linking addresses to buildings'
                    : 'Step 5/5: Finishing farm setup';

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

  const add2DBuildingsLayer = (m: mapboxgl.Map) => {
    const buildingLayerId = '2d-buildings';
    if (m.getLayer(buildingLayerId)) return;
    const buildingFill = isDark ? '#111111' : '#c8c1b2';
    const buildingOutline = isDark ? '#0a0a0a' : '#b5ad9d';

    const layers = m.getStyle().layers;

    for (const layer of layers) {
      const layerId = layer.id.toLowerCase();
      if ((layerId.includes('building') || layerId.includes('structure')) && layer.id !== buildingLayerId) {
        try {
          m.setLayoutProperty(layer.id, 'visibility', 'none');
        } catch {}
      }
    }

    let labelLayerId: string | undefined;
    for (const layer of layers) {
      if (layer.type === 'symbol' && (layer as any).layout?.['text-field']) {
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
      style: MAP_STYLES[theme] ?? MAP_STYLES.light,
      center: [-79.35, 43.65],
      zoom: 15,
    });

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

  const savedFeaturesRef = useRef<any>(null);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const expectedStyle = isSatellite
      ? 'mapbox://styles/mapbox/satellite-streets-v12'
      : (MAP_STYLES[theme] ?? MAP_STYLES.light);

    const currentStyle = map.current.getStyle()?.name || '';
    const isCurrentlySatellite = currentStyle.toLowerCase().includes('satellite');
    if (isSatellite === isCurrentlySatellite && drawRef.current) return;

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
    map.current.setStyle(expectedStyle);

    map.current.once('style.load', () => {
      if (!map.current) return;

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

      if (savedFeaturesRef.current?.features?.length > 0) {
        newDraw.set(savedFeaturesRef.current);
        newDraw.changeMode('simple_select');
      } else {
        newDraw.changeMode('draw_polygon');
      }
    });
  }, [isSatellite, theme, mapLoaded]);

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
      duration: 1500,
    });
    setSearchOpen(false);
  };

  const safeGetLayer = (m: mapboxgl.Map, layerId: string): boolean => {
    try {
      if (!m.isStyleLoaded()) return false;
      return !!m.getLayer(layerId);
    } catch {
      return false;
    }
  };

  const addBoundaryLayersAndCrossFade = (
    raw: { type: 'Polygon'; coordinates: number[][][] },
    snapped: { type: 'Polygon'; coordinates: number[][][] }
  ) => {
    const m = map.current;
    if (!m || !m.getStyle() || !m.isStyleLoaded()) return;

    const rawSourceId = 'campaign-boundary-raw';
    const snappedSourceId = 'campaign-boundary-snapped';
    const rawFillId = 'campaign-boundary-raw-fill';
    const rawLineId = 'campaign-boundary-raw-line';
    const snappedFillId = 'campaign-boundary-snapped-fill';
    const snappedLineId = 'campaign-boundary-snapped-line';

    const removeExisting = () => {
      const ids = boundaryLayerIdsRef.current.filter((id): id is string => typeof id === 'string' && id.length > 0);
      ids.forEach((id) => {
        try {
          if (safeGetLayer(m, id)) m.removeLayer(id);
        } catch {}
      });
      try {
        if (m.getSource(rawSourceId)) m.removeSource(rawSourceId);
        if (m.getSource(snappedSourceId)) m.removeSource(snappedSourceId);
      } catch {}
      boundaryLayerIdsRef.current = [];
    };
    removeExisting();

    const rawFeature: GeoJSON.Feature<GeoJSON.Polygon> = { type: 'Feature', geometry: raw, properties: {} };
    const snappedFeature: GeoJSON.Feature<GeoJSON.Polygon> = { type: 'Feature', geometry: snapped, properties: {} };

    m.addSource(rawSourceId, { type: 'geojson', data: rawFeature });
    m.addSource(snappedSourceId, { type: 'geojson', data: snappedFeature });

    m.addLayer({
      id: rawFillId,
      type: 'fill',
      source: rawSourceId,
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.08 },
    });
    m.addLayer({
      id: rawLineId,
      type: 'line',
      source: rawSourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 2,
        'line-opacity': 0.3,
        'line-dasharray': [1, 1.5],
      },
    });
    m.addLayer({
      id: snappedFillId,
      type: 'fill',
      source: snappedSourceId,
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 },
    });
    m.addLayer({
      id: snappedLineId,
      type: 'line',
      source: snappedSourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 3,
        'line-opacity': 0,
      },
    });

    boundaryLayerIdsRef.current = [rawFillId, rawLineId, snappedFillId, snappedLineId];

    const duration = 600;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const opacity = Math.min(1, elapsed / duration);
      if (safeGetLayer(m, snappedLineId) && safeGetLayer(m, snappedFillId)) {
        m.setPaintProperty(snappedLineId, 'line-opacity', opacity);
        m.setPaintProperty(snappedFillId, 'fill-opacity', 0.08 + 0.07 * opacity);
      }
      if (opacity < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    const m = map.current;
    if (!m || !boundaryRaw || !boundarySnapped || !m.isStyleLoaded()) return;
    const rawLineId = 'campaign-boundary-raw-line';
    const snappedLineId = 'campaign-boundary-snapped-line';
    if (!safeGetLayer(m, rawLineId) || !safeGetLayer(m, snappedLineId)) return;
    m.setPaintProperty(rawLineId, 'line-opacity', 0.3);
    m.setPaintProperty(snappedLineId, 'line-opacity', 1);
  }, [boundaryRaw, boundarySnapped]);

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId) return;
    if (!name.trim()) return;
    if (!startDate) {
      alert('Please choose a start date.');
      return;
    }
    if (!Number.isFinite(touchesPerInterval) || touchesPerInterval < 1) {
      alert('Please enter at least 1 touch.');
      return;
    }
    if (!Number.isFinite(goalTarget) || goalTarget < 1) {
      alert('Please enter a valid goal target.');
      return;
    }

    const trimmedCycleWindow = cycleCompletionWindowDays.trim();
    const parsedCycleWindow = trimmedCycleWindow ? parseInt(trimmedCycleWindow, 10) : null;
    if (
      trimmedCycleWindow &&
      (!Number.isFinite(parsedCycleWindow ?? Number.NaN) || (parsedCycleWindow ?? 0) < 1)
    ) {
      alert('Please enter a valid completion window in days.');
      return;
    }

    const trimmedBudget = annualBudget.trim();
    const annualBudgetCents = trimmedBudget
      ? Math.round(Number(trimmedBudget.replace(/,/g, '')) * 100)
      : null;
    if (
      trimmedBudget &&
      (!Number.isFinite(annualBudgetCents ?? Number.NaN) || (annualBudgetCents ?? 0) < 0)
    ) {
      alert('Please enter a valid yearly budget.');
      return;
    }

    let polygon: { type: 'Polygon'; coordinates: number[][][] } | null = null;
    let bbox: number[] | undefined;
    const features = drawRef.current?.getAll();
    if (!features || features.features.length === 0) {
      alert('Please draw a territory boundary on the map');
      return;
    }

    const polygonFeature = features.features.find(
      (feature) => feature.geometry?.type === 'Polygon' && feature.geometry.coordinates?.[0]?.length >= 3
    );
    if (!polygonFeature) {
      alert('Please draw a territory boundary on the map. Double-click to finish your shape.');
      return;
    }
    polygon = polygonFeature.geometry as { type: 'Polygon'; coordinates: number[][][] };

    const ring = polygon.coordinates[0];
    if (!ring || ring.length < 3) {
      alert('Please draw a proper territory with at least 3 corners. The shape you drew has too few points.');
      return;
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

    setLoading(true);
    try {
      const farm = await FarmService.createFarm(userId, {
        name: name.trim(),
        description: description.trim() || undefined,
        polygon: JSON.stringify(polygon),
        start_date: startDate,
        end_date: formatDateInput(addDays(new Date(`${startDate}T12:00:00`), DEFAULT_FARM_DURATION_DAYS)),
        frequency: touchesPerInterval,
        touches_per_interval: touchesPerInterval,
        touches_interval: touchesInterval,
        goal_type: goalType,
        goal_target: goalTarget,
        cycle_completion_window_days: parsedCycleWindow,
        touch_types: touchTypes,
        annual_budget_cents: annualBudgetCents,
        workspace_id: currentWorkspaceId ?? undefined,
        area_label: bbox ? `Area ${bbox[1].toFixed(3)}, ${bbox[0].toFixed(3)}` : undefined,
        home_limit: DEFAULT_HOME_LIMIT,
      });

      const campaignResponse = await fetch(`/api/farms/${farm.id}/campaign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!campaignResponse.ok) {
        const error = await campaignResponse.json().catch(() => ({}));
        throw new Error(error.error || `Failed to create linked campaign (${campaignResponse.status})`);
      }

      const campaignResult = await campaignResponse.json();
      const campaignId = campaignResult.linked_campaign_id as string | undefined;
      if (!campaignId) {
        throw new Error('Linked campaign id was not returned for this farm');
      }

      setSnappingBoundary(true);
      let polygonForAddresses = polygon;
      try {
        const snapResponse = await fetch(`/api/campaigns/${campaignId}/snap`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (snapResponse.ok) {
          const snapResult = await snapResponse.json();
          polygonForAddresses = snapResult.polygon ?? polygon;
          if (snapResult.wasSnapped && snapResult.polygon) {
            setBoundaryRaw(polygon);
            setBoundarySnapped(snapResult.polygon);
            addBoundaryLayersAndCrossFade(polygon, snapResult.polygon);
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
        }
      } catch (snapError) {
        console.error('Snap to roads failed, using drawn polygon for farm:', snapError);
      } finally {
        setSnappingBoundary(false);
      }

      fetch(`/api/campaigns/${campaignId}/roads/prepare`, { method: 'POST' }).catch(() => {});

      setGeneratingAddresses(true);
      let insertedCount = 0;
      try {
        const addressResponse = await fetch('/api/campaigns/generate-address-list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignId,
            polygon: polygonForAddresses,
            address_limit: DEFAULT_HOME_LIMIT,
          }),
        });

        if (!addressResponse.ok) {
          const error = await addressResponse.json().catch(() => ({}));
          throw new Error(error.error || `Failed to generate farm homes (${addressResponse.status})`);
        }

        const addressResult = await addressResponse.json();
        insertedCount = addressResult.inserted_count || 0;
        setAddressCount(insertedCount);
        if (addressResult.warning) {
          alert(addressResult.warning);
        }

        if (insertedCount > 0) {
          setGeneratingAddresses(false);
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

            const provisionResponse = await fetch('/api/campaigns/provision', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaign_id: campaignId,
              }),
            });

            clearInterval(progressInterval);
            setProvisionProgress('Finalizing Mission Territory...');

            if (!provisionResponse.ok) {
              const error = await provisionResponse.json().catch(() => ({}));
              alert(
                error.error
                  ? `Farm homes were generated, but building provisioning failed: ${error.error}`
                  : 'Farm homes were generated, but building provisioning failed.'
              );
            } else {
              const result = await provisionResponse.json();
              const { addresses_saved = 0, links_created = 0 } = result;
              if (links_created < addresses_saved) {
                setProvisionProgress(`Linking: ${links_created} / ${addresses_saved} addresses...`);
              }
              await new Promise((resolve) => setTimeout(resolve, 800));
            }
          } catch (provisionError) {
            console.error('Error provisioning buildings:', provisionError);
            alert('Addresses saved but building provisioning failed. You can provision later.');
          } finally {
            setProvisioning(false);
            setProvisionProgress('');
          }
        } else {
          alert('No addresses found in the drawn polygon. Please try a different area.');
        }
      } finally {
        setGeneratingAddresses(false);
      }

      setSyncingFarm(true);
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
      router.push(`/farms/${farm.id}`);
    } catch (error) {
      console.error('Error creating farm:', error);
      alert(getErrorMessage(error));
    } finally {
      setSyncingFarm(false);
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-background overflow-hidden">
      <div className="w-full max-w-[360px] xl:max-w-[400px] shrink-0 border-r border-border bg-card">
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Farm</p>
              <h1 className="text-2xl font-semibold text-foreground truncate">
                {name.trim() || 'New Farm'}
              </h1>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Farm name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Downtown Repeat Farm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Repeat this area for doorknocks, flyers, Canada Post, pop-bys, or letters."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Touch plan</p>
                <p className="text-sm text-muted-foreground">
                  Set how often this farm should be worked.
                </p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr),150px] gap-3">
                <div className="space-y-2">
                  <Label htmlFor="touchesPerInterval"># of touches</Label>
                  <Input
                    id="touchesPerInterval"
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
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cadence</Label>
                  <Select
                    value={touchesInterval}
                    onValueChange={(value) => setTouchesInterval(value as FarmTouchInterval)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FARM_TOUCH_INTERVAL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Goal tracking</p>
                <p className="text-sm text-muted-foreground">
                  Add a success target and optional completion window for each cycle.
                </p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr),140px] gap-3">
                <div className="space-y-2">
                  <Label>Goal type</Label>
                  <Select value={goalType} onValueChange={(value) => setGoalType(value as FarmGoalType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FARM_GOAL_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goalTarget">Target</Label>
                  <Input
                    id="goalTarget"
                    type="number"
                    min="1"
                    value={goalTarget < 1 ? '' : String(goalTarget)}
                    onChange={(e) => {
                      if (e.target.value === '') {
                        setGoalTarget(0);
                        return;
                      }

                      const parsed = parseInt(e.target.value, 10);
                      setGoalTarget(Number.isFinite(parsed) ? Math.max(1, parsed) : 0);
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycleCompletionWindowDays">Target completion window</Label>
                <Input
                  id="cycleCompletionWindowDays"
                  type="number"
                  min="1"
                  value={cycleCompletionWindowDays}
                  onChange={(e) => setCycleCompletionWindowDays(e.target.value)}
                  placeholder="Optional, e.g. 14 days"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Goal: {formatFarmGoal({
                  goal_type: goalType,
                  goal_target: goalTarget,
                  touches_per_interval: touchesPerInterval,
                  touches_interval: touchesInterval,
                  frequency: touchesPerInterval,
                })}
                {cycleCompletionWindowDays.trim()
                  ? `. Complete each cycle within ${cycleCompletionWindowDays.trim()} day${cycleCompletionWindowDays.trim() === '1' ? '' : 's'}.`
                  : '.'}
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Type of touches</p>
                <p className="text-sm text-muted-foreground">
                  Choose the touch types you expect to run in this farm.
                </p>
              </div>
              <FarmTouchTypePicker value={touchTypes} onChange={setTouchTypes} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="annualBudget">Budget for year</Label>
              <Input
                id="annualBudget"
                type="number"
                min="0"
                step="0.01"
                value={annualBudget}
                onChange={(e) => setAnnualBudget(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
              <p className="font-medium text-foreground">Farm home limit</p>
              <p className="text-muted-foreground">
                Each farm can include up to{' '}
                <span className="font-semibold text-foreground">
                  {DEFAULT_HOME_LIMIT.toLocaleString()}
                </span>{' '}
                homes.
              </p>
              {generatedHomes !== null ? (
                <p className="text-muted-foreground">
                  Last generated: {generatedHomes.toLocaleString()} homes.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
              <p className="font-medium text-foreground">Draw a reusable farm area</p>
              <p className="text-muted-foreground">
                Use the map to outline the neighborhood once, then revisit it through repeatable
                farm sessions.
              </p>
              <p className="text-muted-foreground">
                Modes are chosen per session later, including Canada Post runs.
              </p>
              {addressCount !== null ? (
                <p className="font-medium text-green-600 dark:text-green-400">
                  {addressCount} homes loaded
                </p>
              ) : null}
            </div>
          </div>

          <div className="border-t border-border px-4 py-4 bg-card">
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => router.back()}
                disabled={loading || snappingBoundary || provisioning || generatingAddresses || syncingFarm}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={
                  loading ||
                  snappingBoundary ||
                  provisioning ||
                  generatingAddresses ||
                  syncingFarm ||
                  !name.trim()
                }
                onClick={handleSubmit}
              >
                {loading
                  ? 'Creating...'
                  : snappingBoundary
                    ? 'Snapping...'
                    : generatingAddresses
                      ? 'Finding...'
                      : provisioning
                        ? 'Provisioning...'
                        : syncingFarm
                          ? 'Syncing...'
                          : 'Create Farm'}
              </Button>
            </div>
          </div>
        </div>
      </div>

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

            <button
              type="button"
              onClick={startDrawing}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500 text-white rounded-lg shadow-lg hover:shadow-xl hover:bg-red-600 transition-all duration-200 text-sm font-medium border border-red-600"
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
          </div>
        )}

        {mapLoaded && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card rounded-full px-5 py-2.5 shadow-lg border border-border z-10">
            <p className="text-sm text-foreground whitespace-nowrap">
              <span className="font-semibold">Click</span> to draw • <span className="font-semibold">Double-click</span> to finish
            </p>
          </div>
        )}
      </div>

      {(snappingBoundary || provisioning || generatingAddresses || syncingFarm) && (
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
                Generating Farm
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
