'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import * as turf from '@turf/turf';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDot,
  DoorOpen,
  MapPinned,
  MessageSquare,
  MousePointer2,
  Pentagon,
  Phone,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import type { AddressSuggestion } from '@/lib/services/MapboxAutocompleteService';
import {
  buildDemoLiveChoreography,
  type DemoBuildingCandidate,
  type DemoLiveChoreography,
} from '@/lib/demo/team-live-map-choreography';
import { initTracking, track } from '@/lib/demo/analytics/track';
import type { SelfServeDoorOutcome } from '@/lib/demo/selfServeDoorOutcomes';
import {
  DEMO100_MEMBERS,
  DEMO100_SESSION_STORAGE_KEY,
  SELF_SERVE_CAMPAIGN_DRAFT_KEY,
  SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY,
  getDemo100Metrics,
  getDemo100Outcomes,
  getDemo100StageNumber,
  nextDemo100Stage,
  parseDemo100StoredState,
  type Demo100Metrics,
  type Demo100Stage,
} from '@/lib/demo100/flow';
import { CloudflareChapterPlayer } from './CloudflareChapterPlayer';

const BUILDING_SOURCE_ID = 'demo100-buildings';
const BUILDING_LAYER_ID = 'demo100-buildings-extrusion';
const REP_SOURCE_ID = 'demo100-reps';
const REP_LAYER_ID = 'demo100-rep-pucks';
const REP_LABEL_LAYER_ID = 'demo100-rep-labels';
const MIN_HOMES = 4;
const MAX_HOMES = 1000;
const RESULT_DURATION_MS = 4200;
const LIVE_DURATION_MS = 18_000;

type Demo100Building = DemoBuildingCandidate & {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
};

type VideoUids = {
  intro?: string;
  postCreate?: string;
  iphone?: string;
  outro?: string;
};

type Demo100ExperienceProps = {
  customerCode?: string;
  videoUids: VideoUids;
  founderCallHref: string;
  referralCode?: string;
};

const OUTCOME_COLORS: Record<SelfServeDoorOutcome, string> = {
  no_answer: '#ef4444',
  answered: '#22c55e',
  lead: '#3b82f6',
  appointment: '#facc15',
};

const OUTCOME_LABELS: Record<SelfServeDoorOutcome, string> = {
  no_answer: 'No answer',
  answered: 'Conversation',
  lead: 'Lead',
  appointment: 'Appointment',
};

const VIDEO_STAGES: Partial<Record<Demo100Stage, {
  uidKey: keyof VideoUids;
  title: string;
  eyebrow: string;
}>> = {
  intro_video: { uidKey: 'intro', title: 'Meet WolfGrid', eyebrow: 'Chapter 1 · The field, connected' },
  post_create_video: { uidKey: 'postCreate', title: 'From territory to outcomes', eyebrow: 'Chapter 3 · Your campaign' },
  iphone_video: { uidKey: 'iphone', title: 'WolfGrid in the field', eyebrow: 'Chapter 8 · Work at the door' },
  outro_video: { uidKey: 'outro', title: 'One system from map to CRM', eyebrow: 'Final chapter · Put it to work' },
};

function drawStyles(): mapboxgl.AnyLayer[] {
  return [
    {
      id: 'gl-draw-polygon-fill',
      type: 'fill',
      filter: ['all', ['==', '$type', 'Polygon']],
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.14 },
    },
    {
      id: 'gl-draw-polygon-stroke-active',
      type: 'line',
      filter: ['all', ['==', '$type', 'Polygon']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ef4444', 'line-width': 3 },
    },
    {
      id: 'gl-draw-line-active',
      type: 'line',
      filter: ['all', ['==', '$type', 'LineString']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-dasharray': [0.2, 2] },
    },
    {
      id: 'gl-draw-polygon-and-line-vertex-active',
      type: 'circle',
      filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
      paint: { 'circle-radius': 5, 'circle-color': '#ef4444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
    },
    {
      id: 'gl-draw-polygon-midpoint',
      type: 'circle',
      filter: ['all', ['==', 'meta', 'midpoint']],
      paint: { 'circle-radius': 4, 'circle-color': '#ef4444' },
    },
  ] as unknown as mapboxgl.AnyLayer[];
}

function featureCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  try {
    const center = turf.centerOfMass({ type: 'Feature', properties: {}, geometry });
    return [center.geometry.coordinates[0], center.geometry.coordinates[1]];
  } catch {
    return null;
  }
}

function polygonBbox(polygon: GeoJSON.Polygon): number[] {
  return turf.bbox({ type: 'Feature', properties: {}, geometry: polygon });
}

function getDrawnPolygon(draw: MapboxDraw | null): GeoJSON.Polygon | null {
  const geometry = draw?.getAll().features.find((feature) => feature.geometry.type === 'Polygon')?.geometry;
  return geometry?.type === 'Polygon' ? geometry : null;
}

function metricsFromOutcomes(outcomes: SelfServeDoorOutcome[]): Demo100Metrics {
  const noAnswers = outcomes.filter((outcome) => outcome === 'no_answer').length;
  const appointments = outcomes.filter((outcome) => outcome === 'appointment').length;
  const leads = outcomes.filter((outcome) => outcome === 'lead' || outcome === 'appointment').length;
  const conversations = outcomes.length - noAnswers;
  return {
    doors: outcomes.length,
    noAnswers,
    conversations,
    leads,
    appointments,
    conversationRate: outcomes.length > 0 ? conversations / outcomes.length : 0,
  };
}

function stableBuildingId(feature: mapboxgl.MapboxGeoJSONFeature, center: [number, number]) {
  return String(feature.id ?? feature.properties?.id ?? feature.properties?.mapbox_id ?? `${center[0].toFixed(7)}:${center[1].toFixed(7)}`);
}

function createTrialHref(referralCode?: string) {
  const params = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: 'self-serve-campaign',
    resumeCampaign: '1',
    entry: 'demo100',
  });
  if (referralCode?.trim()) params.set('referralCode', referralCode.trim());
  return `/onboarding?${params.toString()}`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function StageProgress({ stage }: { stage: Demo100Stage }) {
  const step = getDemo100StageNumber(stage);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2.5 text-white shadow-2xl backdrop-blur-xl">
        <span className="text-xs font-black tracking-[0.14em]">WOLFGRID</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-red-500 transition-[width] duration-500" style={{ width: `${(step / 9) * 100}%` }} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">{step}/9</span>
      </div>
    </div>
  );
}

function MetricTile({ label, value, icon: Icon, accent = 'text-white' }: { label: string; value: string; icon: typeof DoorOpen; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
      <Icon className={`size-4 ${accent}`} />
      <p className="mt-3 text-2xl font-black tracking-tight text-white">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
    </div>
  );
}

export function Demo100Experience({ customerCode, videoUids, founderCallHref, referralCode }: Demo100ExperienceProps) {
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const selectedLocationRef = useRef<[number, number]>([-79.3832, 43.6532]);
  const pendingRestoreRef = useRef<ReturnType<typeof parseDemo100StoredState>>(null);
  const videoStartedStageRef = useRef<Demo100Stage | null>(null);
  const [stage, setStage] = useState<Demo100Stage>('intro_video');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [builderStep, setBuilderStep] = useState<'location' | 'selection'>('location');
  const [selectionTool, setSelectionTool] = useState<'polygon' | 'radius'>('polygon');
  const [radiusMeters, setRadiusMeters] = useState(225);
  const [searchValue, setSearchValue] = useState('');
  const [campaignName, setCampaignName] = useState('FIRST CAMPAIGN');
  const [polygon, setPolygon] = useState<GeoJSON.Polygon | null>(null);
  const [buildings, setBuildings] = useState<Demo100Building[]>([]);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [resultRevealCount, setResultRevealCount] = useState(0);
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [liveProgress, setLiveProgress] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const outcomes = useMemo(() => getDemo100Outcomes(buildings.length), [buildings.length]);
  const finalMetrics = useMemo(() => getDemo100Metrics(buildings.length), [buildings.length]);
  const visibleMetrics = useMemo(
    () => metricsFromOutcomes(outcomes.slice(0, resultRevealCount)),
    [outcomes, resultRevealCount],
  );
  const choreography = useMemo<DemoLiveChoreography | null>(() => {
    if (buildings.length === 0) return null;
    return buildDemoLiveChoreography(
      buildings,
      DEMO100_MEMBERS.map((member) => ({ user_id: member.id, display_name: member.name, color: member.color })),
      buildings.length,
    );
  }, [buildings]);
  const choreographyById = useMemo(
    () => new Map((choreography?.buildings ?? []).map((building) => [building.id, building])),
    [choreography],
  );
  const outcomeById = useMemo(
    () => new Map(buildings.map((building, index) => [building.id, outcomes[index]])),
    [buildings, outcomes],
  );
  const completedLiveCount = Math.min(buildings.length, Math.floor(liveProgress * buildings.length));

  const setAndTrackStage = useCallback((next: Demo100Stage, event?: string) => {
    setStage(next);
    if (event) track(event, getDemo100StageNumber(next), { stage: next });
  }, []);

  const selectBuildings = useCallback((nextPolygon: GeoJSON.Polygon) => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    setSelectionBusy(true);
    setSelectionError(null);

    window.requestAnimationFrame(() => {
      try {
        const bbox = polygonBbox(nextPolygon);
        const southWest = map.project([bbox[0], bbox[1]]);
        const northEast = map.project([bbox[2], bbox[3]]);
        const candidateLayers = map.getLayer('demo100-base-buildings')
          ? ['demo100-base-buildings']
          : (map.getStyle().layers ?? [])
              .filter((layer) => layer.id.toLowerCase().includes('building') && layer.type !== 'symbol')
              .map((layer) => layer.id)
              .filter((id) => map.getLayer(id));
        const features = candidateLayers.length > 0
          ? map.queryRenderedFeatures(
              [[Math.min(southWest.x, northEast.x), Math.min(southWest.y, northEast.y)], [Math.max(southWest.x, northEast.x), Math.max(southWest.y, northEast.y)]],
              { layers: candidateLayers },
            )
          : [];
        const territory = turf.feature(nextPolygon);
        const unique = new Map<string, Demo100Building>();

        features.forEach((feature) => {
          if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return;
          const geometry = structuredClone(feature.geometry) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
          const center = featureCenter(geometry);
          if (!center || !turf.booleanPointInPolygon(turf.point(center), territory)) return;
          const id = stableBuildingId(feature, center);
          if (unique.has(id)) return;
          unique.set(id, {
            id,
            center,
            geometry,
            streetName: typeof feature.properties?.name === 'string' ? feature.properties.name : null,
            houseNumber: feature.properties?.house_num ?? feature.properties?.house_number ?? null,
            feature: { type: 'Feature', id, properties: { id }, geometry },
          });
        });

        const all = Array.from(unique.values()).sort((left, right) => left.id.localeCompare(right.id));
        setDiscoveredCount(all.length);
        setBuildings(all.slice(0, MAX_HOMES));
        setPolygon(nextPolygon);
        setResultRevealCount(0);
        setAssignmentConfirmed(false);
        if (all.length === 0) {
          setSelectionError('No visible homes were found. Zoom in or choose a nearby residential block.');
        }
      } catch {
        setSelectionError('WolfGrid could not read this boundary. Try drawing a smaller area.');
      } finally {
        setSelectionBusy(false);
      }
    });
  }, []);

  const addBaseBuildings = useCallback((map: mapboxgl.Map) => {
    if (map.getLayer('demo100-base-buildings') || !map.getSource('composite')) return;
    const label = map.getStyle().layers?.find((layer) => layer.type === 'symbol' && Boolean((layer as mapboxgl.SymbolLayer).layout?.['text-field']))?.id;
    map.addLayer({
      id: 'demo100-base-buildings',
      type: 'fill',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 12,
      paint: { 'fill-color': '#64748b', 'fill-opacity': 0.72, 'fill-outline-color': '#94a3b8' },
    }, label);
  }, []);

  useEffect(() => {
    initTracking('demo100');
    track('open', 1, { device: navigator.userAgent.includes('Mobi') ? 'mobile' : 'desktop' });
    const stored = parseDemo100StoredState(window.localStorage.getItem(DEMO100_SESSION_STORAGE_KEY));
    pendingRestoreRef.current = stored;
    if (stored?.stage === 'intro_video' || stored?.stage === 'campaign_builder') {
      setStage(stored.stage);
      setCampaignName(stored.campaignName);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(DEMO100_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      stage,
      selectedCount: buildings.length,
      campaignName,
      polygon,
      bbox: polygon ? polygonBbox(polygon) : null,
      createdAt: new Date().toISOString(),
    }));
  }, [buildings.length, campaignName, hydrated, polygon, stage]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const token = getMapboxToken();
    if (!token) {
      setSelectionError('Mapbox is not configured for this environment.');
      return;
    }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: selectedLocationRef.current,
      zoom: 15.3,
      pitch: 48,
      bearing: -18,
      attributionControl: false,
    });
    mapRef.current = map;
    const draw = new MapboxDraw({ displayControlsDefault: false, defaultMode: 'simple_select', styles: drawStyles() });
    drawRef.current = draw;
    map.addControl(draw);

    const handleSelection = () => {
      const nextPolygon = getDrawnPolygon(draw);
      if (nextPolygon) selectBuildings(nextPolygon);
    };
    map.on('draw.create', handleSelection);
    map.on('draw.update', handleSelection);
    map.on('draw.delete', () => {
      setPolygon(null);
      setBuildings([]);
      setDiscoveredCount(0);
    });
    map.on('load', () => {
      addBaseBuildings(map);
      setMapLoaded(true);
      const stored = pendingRestoreRef.current;
      if (stored?.polygon && stored.selectedCount >= MIN_HOMES) {
        draw.set({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: stored.polygon }] });
        const bbox = stored.bbox?.length === 4 ? stored.bbox : polygonBbox(stored.polygon);
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 100, duration: 0 });
        map.once('idle', () => {
          selectBuildings(stored.polygon!);
          setBuilderStep('selection');
          setCampaignName(stored.campaignName);
          setStage(stored.stage === 'intro_video' ? 'campaign_builder' : stored.stage);
        });
      }
    });

    return () => {
      map.off('draw.create', handleSelection);
      map.off('draw.update', handleSelection);
      removeMapboxMapWhenSafe(map);
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [addBaseBuildings, selectBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource(BUILDING_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const liveOrder = choreography?.assignedHomes ?? [];
    const completedIds = new Set(liveOrder.slice(0, completedLiveCount).map((building) => building.id));
    const activeId = liveOrder[Math.min(completedLiveCount, Math.max(0, liveOrder.length - 1))]?.id;
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: buildings.map((building, index) => {
        const assignment = choreographyById.get(building.id);
        let color = '#64748b';
        let opacity = 0.88;
        if (stage === 'campaign_results' || stage === 'team_stats') {
          color = index < resultRevealCount || stage === 'team_stats' ? OUTCOME_COLORS[outcomes[index]] : '#64748b';
        } else if (stage === 'assignments') {
          color = assignment?.assigneeColor ?? '#64748b';
        } else if (stage === 'live_map') {
          color = completedIds.has(building.id) ? '#22c55e' : assignment?.assigneeColor ?? '#64748b';
          if (building.id === activeId) color = '#ffffff';
          opacity = completedIds.has(building.id) ? 0.95 : 0.65;
        }
        return {
          ...building.feature,
          properties: { ...building.feature.properties, display_color: color, display_opacity: opacity },
        };
      }),
    };

    if (source) {
      source.setData(data);
    } else if (buildings.length > 0) {
      map.addSource(BUILDING_SOURCE_ID, { type: 'geojson', data });
      const label = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
      map.addLayer({
        id: BUILDING_LAYER_ID,
        type: 'fill-extrusion',
        source: BUILDING_SOURCE_ID,
        paint: {
          'fill-extrusion-color': ['get', 'display_color'],
          'fill-extrusion-height': 12,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': ['get', 'display_opacity'],
        },
      }, label);
    }
  }, [buildings, choreography, choreographyById, completedLiveCount, mapLoaded, outcomes, resultRevealCount, stage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || stage !== 'live_map' || !choreography) return;
    const repFeatures = DEMO100_MEMBERS.flatMap((member) => {
      const homes = choreography.assignedHomes.filter((home) => home.assigneeId === member.id);
      if (homes.length === 0) return [];
      const index = Math.min(homes.length - 1, Math.floor(liveProgress * homes.length));
      const home = homes[index];
      return [{
        type: 'Feature' as const,
        properties: { name: member.name, color: member.color },
        geometry: { type: 'Point' as const, coordinates: home.center },
      }];
    });
    const data: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features: repFeatures };
    const source = map.getSource(REP_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource(REP_SOURCE_ID, { type: 'geojson', data });
      map.addLayer({
        id: REP_LAYER_ID,
        type: 'circle',
        source: REP_SOURCE_ID,
        paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: REP_LABEL_LAYER_ID,
        type: 'symbol',
        source: REP_SOURCE_ID,
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.5], 'text-allow-overlap': true },
        paint: { 'text-color': '#fff', 'text-halo-color': '#111827', 'text-halo-width': 2 },
      });
    }
  }, [choreography, liveProgress, mapLoaded, stage]);

  useEffect(() => {
    if (stage !== 'campaign_results' || buildings.length === 0) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setResultRevealCount(buildings.length);
      track('results_complete', 4, { homes: buildings.length, reducedMotion: true });
      return;
    }
    setResultRevealCount(0);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / RESULT_DURATION_MS);
      const count = Math.floor(progress * buildings.length);
      setResultRevealCount(count);
      if (progress >= 1) {
        window.clearInterval(timer);
        track('results_complete', 4, { homes: buildings.length });
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [buildings.length, stage]);

  useEffect(() => {
    if (stage !== 'live_map' || buildings.length === 0) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setLiveProgress(1);
      track('live_map_complete', 6, { homes: buildings.length, reducedMotion: true });
      return;
    }
    setLiveProgress(0);
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / LIVE_DURATION_MS);
      setLiveProgress(progress);
      if (progress >= 1) {
        window.clearInterval(timer);
        track('live_map_complete', 6, { homes: buildings.length });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [buildings.length, stage]);

  const handleLocationSelect = (suggestion: AddressSuggestion) => {
    const center: [number, number] = [suggestion.coordinate.longitude, suggestion.coordinate.latitude];
    selectedLocationRef.current = center;
    setBuilderStep('selection');
    mapRef.current?.flyTo({ center, zoom: 16, pitch: 48, duration: 1100 });
    track('builder_location_selected', 2, { label: suggestion.title });
  };

  const startPolygon = () => {
    setSelectionTool('polygon');
    setSelectionError(null);
    drawRef.current?.deleteAll();
    setBuildings([]);
    drawRef.current?.changeMode('draw_polygon');
  };

  const applyRadius = useCallback((meters = radiusMeters) => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    setSelectionTool('radius');
    setSelectionError(null);
    const center = map.getCenter();
    const circle = turf.circle([center.lng, center.lat], meters / 1000, { steps: 72, units: 'kilometers' });
    const nextPolygon = circle.geometry;
    draw.set({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: nextPolygon }] });
    selectBuildings(nextPolygon);
  }, [radiusMeters, selectBuildings]);

  const createDraft = () => {
    if (!polygon || buildings.length < MIN_HOMES || buildings.length > MAX_HOMES) return;
    const draft = {
      draftId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `demo100-${Date.now()}`,
      name: campaignName.trim() || 'FIRST CAMPAIGN',
      polygon,
      bbox: polygonBbox(polygon),
      selectedCount: buildings.length,
      referralCode: referralCode?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    const serializedDraft = JSON.stringify(draft);
    window.localStorage.setItem(SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY, serializedDraft);
    window.localStorage.setItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY, serializedDraft);
    track('territory_created', 2, { homes: buildings.length });
    setAndTrackStage('post_create_video', 'stage_enter');
  };

  const handleVideoStarted = useCallback(() => {
    if (videoStartedStageRef.current === stage) return;
    videoStartedStageRef.current = stage;
    track('video_started', getDemo100StageNumber(stage), { chapter: stage });
  }, [stage]);

  const handleVideoComplete = useCallback(() => {
    track('video_complete', getDemo100StageNumber(stage), { chapter: stage });
    const next = nextDemo100Stage(stage);
    setAndTrackStage(next, 'stage_enter');
  }, [setAndTrackStage, stage]);

  const resetDemo = () => {
    window.localStorage.removeItem(DEMO100_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY);
    window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
    drawRef.current?.deleteAll();
    setPolygon(null);
    setBuildings([]);
    setDiscoveredCount(0);
    setResultRevealCount(0);
    setAssignmentConfirmed(false);
    setLiveProgress(0);
    setBuilderStep('location');
    setCampaignName('FIRST CAMPAIGN');
    setStage('intro_video');
    track('replay', 1);
  };

  const video = VIDEO_STAGES[stage];
  const zoneRows = useMemo(() => DEMO100_MEMBERS.map((member) => {
    const assigned = choreography?.assignedHomes.filter((home) => home.assigneeId === member.id) ?? [];
    const memberOutcomes = assigned.map((home) => outcomeById.get(home.id)).filter((outcome): outcome is SelfServeDoorOutcome => Boolean(outcome));
    return { member, assigned: assigned.length, metrics: metricsFromOutcomes(memberOutcomes) };
  }), [choreography, outcomeById]);

  useEffect(() => {
    if (stage === 'cta') track('cta_view', 9, { homes: buildings.length });
  }, [buildings.length, stage]);

  return (
    <main className="relative h-[100dvh] min-h-[640px] overflow-hidden bg-[#07090d] text-white">
      <div ref={mapContainerRef} className="absolute inset-0" aria-label="Interactive campaign map" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,10,.34),transparent_38%,rgba(4,6,10,.62))]" />
      <StageProgress stage={stage} />

      {video ? (
        <CloudflareChapterPlayer
          key={stage}
          customerCode={customerCode}
          videoUid={videoUids[video.uidKey]}
          title={video.title}
          eyebrow={video.eyebrow}
          onStarted={handleVideoStarted}
          onComplete={handleVideoComplete}
        />
      ) : null}

      {stage === 'campaign_builder' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:items-center">
          {builderStep === 'location' ? (
            <section className="pointer-events-auto w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#090b10]/92 p-6 shadow-2xl backdrop-blur-2xl sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-red-500 shadow-lg shadow-red-950/40"><MapPinned className="size-5" /></span>
                <span className="rounded-full bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">Real territory builder</span>
              </div>
              <h1 className="mt-8 text-4xl font-black tracking-[-0.05em] sm:text-5xl">Choose your market.</h1>
              <p className="mt-3 text-sm leading-6 text-zinc-400">Search a starting address, then draw the homes your team should work.</p>
              <AddressAutocomplete
                inputId="demo100-address"
                value={searchValue}
                onChange={setSearchValue}
                onSelect={handleLocationSelect}
                useCurrentLocation={false}
                placeholder="Search an address..."
                inputClassName="mt-7 h-14 rounded-2xl border-white/10 bg-white/10 px-4 text-base text-white placeholder:text-zinc-500"
              />
              {selectionError ? <p className="mt-3 text-sm font-semibold text-red-300">{selectionError}</p> : null}
            </section>
          ) : (
            <>
              <section className="pointer-events-auto absolute inset-x-4 top-24 mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#090b10]/90 p-3 shadow-2xl backdrop-blur-xl">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" onClick={startPolygon} className={`h-12 rounded-xl ${selectionTool === 'polygon' ? 'bg-red-500 hover:bg-red-400' : 'bg-white/10 hover:bg-white/15'}`}>
                    <Pentagon className="size-4" /> Draw boundary
                  </Button>
                  <Button type="button" onClick={() => applyRadius()} className={`h-12 rounded-xl ${selectionTool === 'radius' ? 'bg-red-500 hover:bg-red-400' : 'bg-white/10 hover:bg-white/15'}`}>
                    <CircleDot className="size-4" /> Use radius
                  </Button>
                </div>
                {selectionTool === 'radius' ? (
                  <div className="mt-3 flex items-center gap-3 px-2 pb-1">
                    <span className="text-xs font-bold text-zinc-400">150m</span>
                    <input
                      type="range"
                      min={150}
                      max={450}
                      step={25}
                      value={radiusMeters}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setRadiusMeters(next);
                        applyRadius(next);
                      }}
                      className="flex-1 accent-red-500"
                      aria-label="Territory radius"
                    />
                    <span className="text-xs font-bold text-white">{radiusMeters}m</span>
                  </div>
                ) : null}
              </section>

              <section className="pointer-events-auto w-full max-w-xl rounded-[1.75rem] border border-white/10 bg-[#090b10]/94 p-5 shadow-2xl backdrop-blur-2xl">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Homes selected</p>
                    <p className="mt-1 text-4xl font-black tracking-tight">{buildings.length}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-black ${buildings.length >= MIN_HOMES && discoveredCount <= MAX_HOMES ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                    {selectionBusy ? 'Reading map…' : discoveredCount > MAX_HOMES ? 'Area too large' : buildings.length >= MIN_HOMES ? 'Ready' : `Choose ${MIN_HOMES}+`}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {selectionTool === 'polygon' ? 'Select Draw boundary, then click around a residential block and close the shape.' : 'Move the map to position the circle, then adjust its size.'}
                </p>
                <label htmlFor="demo100-campaign-name" className="mt-4 block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Campaign name</label>
                <input
                  id="demo100-campaign-name"
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value.slice(0, 120))}
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3.5 text-sm font-bold text-white outline-none transition focus:border-red-400"
                  placeholder="FIRST CAMPAIGN"
                />
                {selectionError ? <p className="mt-2 text-sm font-semibold text-red-300">{selectionError}</p> : null}
                <Button
                  type="button"
                  onClick={createDraft}
                  disabled={!polygon || buildings.length < MIN_HOMES || discoveredCount > MAX_HOMES || selectionBusy}
                  className="mt-4 h-14 w-full rounded-2xl bg-red-500 text-sm font-black hover:bg-red-400"
                >
                  <Sparkles className="size-5" /> Create this campaign <ArrowRight className="size-4" />
                </Button>
              </section>
            </>
          )}
        </div>
      ) : null}

      {stage === 'campaign_results' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:items-center sm:justify-end sm:px-8">
          <section className="pointer-events-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-[#090b10]/94 p-5 shadow-2xl backdrop-blur-2xl sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Campaign results · Live preview</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Every door tells a story.</h2>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <MetricTile label="Doors" value={compactNumber(visibleMetrics.doors)} icon={DoorOpen} accent="text-red-400" />
              <MetricTile label="Conversations" value={compactNumber(visibleMetrics.conversations)} icon={MessageSquare} accent="text-emerald-400" />
              <MetricTile label="Leads" value={compactNumber(visibleMetrics.leads)} icon={TrendingUp} accent="text-blue-400" />
              <MetricTile label="Appointments" value={compactNumber(visibleMetrics.appointments)} icon={CalendarDays} accent="text-yellow-300" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.keys(OUTCOME_LABELS) as SelfServeDoorOutcome[]).map((outcome) => (
                <span key={outcome} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-zinc-400">
                  <span className="size-2 rounded-full" style={{ backgroundColor: OUTCOME_COLORS[outcome] }} /> {OUTCOME_LABELS[outcome]}
                </span>
              ))}
            </div>
            <Progress value={buildings.length ? (resultRevealCount / buildings.length) * 100 : 0} className="mt-5 h-2 bg-white/10 [&>[data-slot=progress-indicator]]:bg-red-500" />
            <Button
              type="button"
              disabled={resultRevealCount < buildings.length}
              onClick={() => setAndTrackStage('assignments', 'assignments_viewed')}
              className="mt-4 h-12 w-full rounded-xl bg-white font-black text-zinc-950 hover:bg-zinc-100"
            >
              Assign the team <Users className="size-4" />
            </Button>
          </section>
        </div>
      ) : null}

      {stage === 'assignments' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:items-center sm:justify-start sm:px-8">
          <section className="pointer-events-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-[#090b10]/94 p-5 shadow-2xl backdrop-blur-2xl sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Smart split</p><h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Four clear zones.</h2></div>
              <Users className="size-7 text-zinc-500" />
            </div>
            <div className="mt-5 space-y-2">
              {zoneRows.map(({ member, assigned }) => (
                <div key={member.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-3">
                  <span className="flex items-center gap-3 font-bold"><span className="size-3 rounded-full" style={{ backgroundColor: member.color }} />{member.name}</span>
                  <span className="text-sm font-black text-zinc-300">{assigned} homes</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">WolfGrid keeps each rep on a contiguous route and balances the workload automatically.</p>
            <Button
              type="button"
              onClick={() => {
                setAssignmentConfirmed(true);
                track('assignment_complete', 5, { homes: buildings.length, reps: 4 });
                window.setTimeout(() => setAndTrackStage('live_map', 'stage_enter'), 450);
              }}
              disabled={assignmentConfirmed}
              className="mt-4 h-12 w-full rounded-xl bg-red-500 font-black hover:bg-red-400"
            >
              {assignmentConfirmed ? <Check className="size-4" /> : <UserRoundCheck className="size-4" />}
              {assignmentConfirmed ? 'Assignment sent' : 'Assign campaign'}
            </Button>
          </section>
        </div>
      ) : null}

      {stage === 'live_map' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:justify-start sm:px-8">
          <section className="pointer-events-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-[#090b10]/94 p-5 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Live team map · 4 reps</p><h2 className="mt-2 text-2xl font-black tracking-tight">{completedLiveCount} of {buildings.length} complete</h2></div>
              {liveProgress >= 1 ? <CheckCircle2 className="size-7 text-emerald-400" /> : <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-black text-emerald-300">{Math.round(liveProgress * 100)}%</span>}
            </div>
            <Progress value={liveProgress * 100} className="mt-4 h-2.5 bg-white/10 [&>[data-slot=progress-indicator]]:bg-emerald-500" />
            <div className="mt-4 grid grid-cols-2 gap-2">
              {zoneRows.map(({ member, assigned }) => (
                <div key={member.id} className="rounded-xl bg-white/[0.05] p-3 text-xs font-bold text-zinc-300">
                  <span className="mb-2 block size-2.5 rounded-full" style={{ backgroundColor: member.color }} />
                  {member.name} · {Math.min(assigned, Math.floor(assigned * liveProgress))}/{assigned}
                </div>
              ))}
            </div>
            <Button
              type="button"
              disabled={liveProgress < 1}
              onClick={() => setAndTrackStage('team_stats', 'team_stats_viewed')}
              className="mt-4 h-12 w-full rounded-xl bg-white font-black text-zinc-950 hover:bg-zinc-100"
            >
              View team performance <BarChart3 className="size-4" />
            </Button>
          </section>
        </div>
      ) : null}

      {stage === 'team_stats' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:items-center sm:justify-end sm:px-8">
          <section className="pointer-events-auto max-h-[calc(100dvh-8rem)] w-full max-w-lg overflow-y-auto rounded-[1.75rem] border border-white/10 bg-[#090b10]/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Team performance</p>
            <div className="mt-2 flex items-end justify-between gap-4"><h2 className="text-3xl font-black tracking-[-0.04em]">Results, rep by rep.</h2><span className="text-sm font-black text-emerald-300">{Math.round(finalMetrics.conversationRate * 100)}% talked</span></div>
            <div className="mt-5 grid grid-cols-4 gap-2 text-center">
              {[['Doors', finalMetrics.doors], ['Convos', finalMetrics.conversations], ['Leads', finalMetrics.leads], ['Appts', finalMetrics.appointments]].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl bg-white/[0.05] px-2 py-3"><p className="text-xl font-black">{value}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500">{label}</p></div>
              ))}
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              {zoneRows.map(({ member, assigned, metrics }, index) => (
                <div key={member.id} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3.5 py-3 text-sm ${index > 0 ? 'border-t border-white/10' : ''}`}>
                  <span className="flex items-center gap-2 font-bold"><span className="size-2.5 rounded-full" style={{ backgroundColor: member.color }} />{member.name}</span>
                  <span className="text-zinc-400"><b className="text-white">{assigned}</b> doors</span>
                  <span className="text-zinc-400"><b className="text-white">{metrics.leads}</b> leads</span>
                  <span className="text-zinc-400"><b className="text-white">{metrics.appointments}</b> appts</span>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setAndTrackStage('iphone_video', 'stage_enter')} className="mt-5 h-12 w-full rounded-xl bg-red-500 font-black hover:bg-red-400">
              Take WolfGrid into the field <Phone className="size-4" />
            </Button>
          </section>
        </div>
      ) : null}

      {stage === 'cta' ? (
        <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-[#050505] px-5 py-20 text-center">
          <section className="w-full max-w-3xl">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-red-500 shadow-2xl shadow-red-950/50"><Target className="size-8" /></div>
            <p className="mt-7 text-xs font-black uppercase tracking-[0.24em] text-red-400">Your territory is ready</p>
            <h1 className="mt-4 text-balance text-5xl font-black tracking-[-0.06em] sm:text-7xl">Turn every door into momentum.</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">Save the campaign you just built, invite your team, and connect every field conversation to the rest of your sales system.</p>
            <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
              <Button
                type="button"
                onClick={() => {
                  track('free_trial_click', 10, { homes: buildings.length });
                  router.push(createTrialHref(referralCode));
                }}
                className="h-14 rounded-xl bg-red-500 text-base font-black hover:bg-red-400"
              >
                Start Free Trial <ArrowRight className="size-5" />
              </Button>
              <Button asChild variant="outline" className="h-14 rounded-xl border-white/15 bg-white text-base font-black text-zinc-950 hover:bg-zinc-100">
                <a href={founderCallHref} target="_blank" rel="noreferrer" onClick={() => track('zoom_call_click', 10, { homes: buildings.length })}>
                  <CalendarDays className="size-5 text-red-500" /> Book a Zoom Call
                </a>
              </Button>
            </div>
            <button type="button" onClick={resetDemo} className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-zinc-500 transition hover:text-white">
              <RotateCcw className="size-4" /> Replay the demo
            </button>
          </section>
        </div>
      ) : null}

      {!mapLoaded && !video ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#07090d] text-center">
          <div><MousePointer2 className="mx-auto size-7 animate-pulse text-red-400" /><p className="mt-3 text-sm font-bold text-zinc-400">Preparing the territory map…</p></div>
        </div>
      ) : null}
    </main>
  );
}
