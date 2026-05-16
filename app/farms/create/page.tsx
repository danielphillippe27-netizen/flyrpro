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
import {
  CreateTerritoryCta,
  TerritoryDrawHint,
  TerritoryNamingSheet,
  showMapControlsForPhase,
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
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { UserLocationLayer } from '@/components/map/UserLocationLayer';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import { CircleAlert, Map, Pencil, Satellite, Search, Trash2, TriangleAlert } from 'lucide-react';
import * as turf from '@turf/turf';
import Lottie from 'lottie-react';
import { FarmTouchService } from '@/lib/services/FarmService';
import { buildCadenceTouchPlan } from '@/lib/farms/plan';
import type { FarmTouchInterval, FarmTouchType } from '@/types/database';

const DEFAULT_HOME_LIMIT = 5000;
const DEFAULT_TOUCHES_PER_INTERVAL = 2;
const DEFAULT_FARM_DURATION_DAYS = 365;

type CreateFarmDialogTone = 'default' | 'warning' | 'destructive';

type CreateFarmDialogState = {
  title: string;
  description: string;
  tone: CreateFarmDialogTone;
  actionLabel: string;
};

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
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v11'),
    [mapPreset, theme],
  );
  const [farmName, setFarmName] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const description =
    'Repeat this area for doorknocks, flyers, Canada Post, pop-bys, or letters.';
  const [startDate, setStartDate] = useState(() => formatDateInput(new Date()));
  const [touchesPerInterval, setTouchesPerInterval] = useState(DEFAULT_TOUCHES_PER_INTERVAL);
  const [touchesInterval, setTouchesInterval] = useState<FarmTouchInterval>('month');
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
  const [feedbackDialog, setFeedbackDialog] = useState<CreateFarmDialogState | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const boundaryLayerIdsRef = useRef<string[]>([]);
  const appliedBaseStyleKeyRef = useRef<string | null>(null);
  const hasCenteredOnUserLocationRef = useRef(false);
  const feedbackDialogResolveRef = useRef<(() => void) | null>(null);
  const isDark = theme === 'dark';
  const lottieSrc = useMemo(
    () => (isDark ? '/loading/white.json' : '/loading/black.json'),
    [isDark]
  );
  const { phase, setPhase, startCreating } = useTerritoryCreatePhase({ map, mapLoaded });
  const isBusy = loading || provisioning || generatingAddresses || syncingFarm;

  const currentStepText = syncingFarm
    ? 'Step 5/5: Syncing farm homes'
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
      config: resolvedMapStyle.config,
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
    startCreating();
    drawRef.current?.changeMode('draw_polygon');
  };

  const clearDrawing = () => {
    const nextPhase = clearTerritoryDrawing(drawRef.current, phase);
    setPhase(nextPhase);
  };

  const startDrawing = () => {
    drawRef.current?.changeMode('draw_polygon');
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
    setSearchOpen(false);
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (!userId) return;
    if (!farmName.trim() || !campaignName.trim()) return;
    if (!startDate) {
      await showFeedbackDialog({
        title: 'Start date required',
        description: 'Choose a start date before creating this farm.',
        tone: 'warning',
      });
      return;
    }
    if (!Number.isFinite(touchesPerInterval) || touchesPerInterval < 1) {
      await showFeedbackDialog({
        title: 'Cycle workload required',
        description: 'Enter at least 1 target home for each cycle before continuing.',
        tone: 'warning',
      });
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
      await showFeedbackDialog({
        title: 'Budget is invalid',
        description: 'Enter a valid yearly budget or leave the field empty.',
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
          campaign_name: campaignName.trim(),
          description: description.trim() || undefined,
          polygon: JSON.stringify(polygon),
          start_date: startDate,
          end_date: formatDateInput(addDays(new Date(`${startDate}T12:00:00`), DEFAULT_FARM_DURATION_DAYS)),
          frequency: 1,
          touches_per_interval: 1,
          touches_interval: touchesInterval,
          goal_type: 'homes_per_cycle',
          goal_target: touchesPerInterval,
          cycle_completion_window_days: null,
          touch_types: touchTypes,
          annual_budget_cents: annualBudgetCents,
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

      let insertedCount = 0;
      try {
        setProvisioning(true);
        setProvisionProgress('Scanning 3D Shapes...');

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
              campaign_id: campaignId,
            }),
          });

          clearInterval(progressInterval);
          setProvisionProgress('Finalizing Mission Territory...');

          if (!provisionResponse.ok) {
            const error = await provisionResponse.json().catch(() => ({}));
            throw new Error(error.error || `Failed to provision farm homes (${provisionResponse.status})`);
          }

          const result = await provisionResponse.json();
          insertedCount = result.addresses_saved || 0;
          setAddressCount(insertedCount);
          if (result.warning) {
            await showFeedbackDialog({
              title: 'Coverage limit reached',
              description: result.warning,
              tone: 'warning',
            });
          }
          const { addresses_saved = 0, links_created = 0 } = result;
          if (links_created < addresses_saved) {
            setProvisionProgress(`Linking: ${links_created} / ${addresses_saved} addresses...`);
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        } finally {
          clearInterval(progressInterval);
        }
      } catch (provisionError) {
        console.error('Error provisioning farm campaign:', provisionError);
        await showFeedbackDialog({
          title: 'Provisioning incomplete',
          description: 'Farm was created, but staged campaign provisioning failed. You can retry later from the linked campaign.',
          tone: 'warning',
        });
      } finally {
        setProvisioning(false);
        setProvisionProgress('');
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

      const defaultMode = touchTypes[0] ?? 'doorknock';
      const autoPlan = buildCadenceTouchPlan(
        {
          start_date: farm.start_date,
          touches_interval: farm.touches_interval ?? touchesInterval,
          frequency: farm.frequency,
        },
        12,
      );

      for (const plannedTouch of autoPlan) {
        await FarmTouchService.createSession({
          farmId: farm.id,
          workspaceId: farm.workspace_id ?? currentWorkspaceId ?? undefined,
          cycleNumber: plannedTouch.cycleNumber,
          mode: defaultMode,
          scheduledDate: new Date(`${plannedTouch.suggestedDate}T12:00:00`).toISOString(),
        });
      }

      router.push(`/farms/${farm.id}`);
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

        {phase === 'idle' && mapLoaded ? (
          <CreateTerritoryCta onClick={handleStartCreating} disabled={isBusy} />
        ) : null}

        {mapLoaded && showMapControlsForPhase(phase) ? (
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen((current) => !current)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-lg transition-all duration-200 hover:bg-muted/50 hover:shadow-xl"
            >
              <Search className="h-5 w-5" />
              <span>Search</span>
            </button>

            {searchOpen ? (
              <div className="w-[min(24rem,calc(100vw-7rem))] space-y-2 rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
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
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-lg transition-all duration-200 hover:bg-muted/50 hover:shadow-xl"
            >
              {isSatellite ? (
                <>
                  <Map className="h-5 w-5" />
                  <span>Map</span>
                </>
              ) : (
                <>
                  <Satellite className="h-5 w-5" />
                  <span>Satellite</span>
                </>
              )}
            </button>

            {phase === 'drawing' ? (
              <>
                <button
                  type="button"
                  onClick={startDrawing}
                  className="flex items-center gap-2 rounded-lg border border-red-600 bg-red-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:bg-red-600 hover:shadow-xl"
                >
                  <Pencil className="h-5 w-5" />
                  <span>Draw</span>
                </button>
                <button
                  type="button"
                  onClick={clearDrawing}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-lg transition-all duration-200 hover:bg-muted/50 hover:shadow-xl"
                >
                  <Trash2 className="h-5 w-5" />
                  <span>Clear</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <TerritoryDrawHint visible={mapLoaded && phase === 'drawing'} />

        <TerritoryNamingSheet
          open={phase === 'naming'}
          title="Name your campaign and farm"
          description="Your territory is drawn. Name the linked campaign and the farm you will revisit."
          onCancel={handleNamingBack}
          onSubmit={() => void handleSubmit()}
          submitLabel="Create Farm"
          submitDisabled={!campaignName.trim() || !farmName.trim()}
          isSubmitting={isBusy}
        >
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Spring door knock"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="farm-name">Farm name</Label>
            <Input
              id="farm-name"
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              placeholder="Downtown Repeat Farm"
            />
          </div>
        </TerritoryNamingSheet>
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

      {(provisioning || generatingAddresses || syncingFarm) && (
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
