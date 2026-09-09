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
  DoorOpen,
  MapPinned,
  MessageSquare,
  MousePointer2,
  Pentagon,
  Phone,
  RotateCcw,
  Target,
  UserRoundPlus,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { DEMO_100_TRIAL_OFFER } from '@/lib/demo/demo100Trial';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { buildSmartTerritoryClusters } from '@/lib/services/BlockRoutingService';
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
  DEMO100_STAGES,
  SELF_SERVE_CAMPAIGN_DRAFT_KEY,
  SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY,
  getDemo100Metrics,
  getDemo100Outcomes,
  getDemo100StageNumber,
  nextDemo100Stage,
  parseDemo100StoredState,
  type Demo100Member,
  type Demo100Metrics,
  type Demo100Stage,
} from '@/lib/demo100/flow';
import { CloudflareChapterPlayer } from './CloudflareChapterPlayer';
import { IphoneChapterExperience, type IphoneChapter } from './IphoneChapterExperience';

const BUILDING_SOURCE_ID = 'demo100-buildings';
const BUILDING_LAYER_ID = 'demo100-buildings-extrusion';
const REP_SOURCE_ID = 'demo100-reps';
const REP_LAYER_ID = 'demo100-rep-pucks';
const REP_LABEL_LAYER_ID = 'demo100-rep-labels';
const MIN_HOMES = 4;
const MAX_HOMES = 1000;
const RESULT_DURATION_MS = 4200;
const LIVE_DURATION_MS = 18_000;
const TERRITORY_ORBIT_DURATION_MS = 8_000;

type Demo100Building = DemoBuildingCandidate & {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
};

type VideoUids = {
  intro?: string;
  postCreate?: string;
  fieldGuideIntro?: string;
  iphone?: string;
  outro?: string;
};

type Demo100ExperienceProps = {
  customerCode?: string;
  videoUids: VideoUids;
  founderCallHref: string;
  referralCode?: string;
};

type BoundaryPracticeStep = 'first_point' | 'move_cursor' | 'second_point' | 'double_click' | 'complete';

const BOUNDARY_PRACTICE_STEPS = [
  { key: 'first_point', label: 'Click a spot', instruction: 'Click once to place your first point.' },
  { key: 'move_cursor', label: 'Move cursor', instruction: 'Move your cursor to stretch the boundary line.' },
  { key: 'second_point', label: 'Click again', instruction: 'Click another spot to add the next point.' },
  { key: 'double_click', label: 'Double-click', instruction: 'Move to a final spot, then double-click to finish.' },
] as const satisfies readonly { key: Exclude<BoundaryPracticeStep, 'complete'>; label: string; instruction: string }[];

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
  field_guide_intro_video: { uidKey: 'fieldGuideIntro', title: 'WolfGrid at the door', eyebrow: 'Chapter 8 · Take it into the field' },
  outro_video: { uidKey: 'outro', title: 'One system from map to CRM', eyebrow: 'Final chapter · Put it to work' },
};

const IPHONE_CHAPTERS = [
  { title: 'Build a Campaign', summary: 'Create a campaign, draw the territory, and name the job.', startSeconds: 0 },
  { title: 'Open a Home', summary: 'Start the session and tap a home to open its activity card.', startSeconds: 13 },
  { title: 'Log No Answer', summary: 'Mark an unanswered door red so the map stays readable.', startSeconds: 16 },
  { title: 'Record an Answer', summary: 'Turn an answered door green and record the conversation.', startSeconds: 18 },
  { title: 'Capture a Lead', summary: 'Add contact details and mark the promising home blue.', startSeconds: 20 },
  { title: 'Set a Follow-Up', summary: 'Schedule the next call and turn the home yellow.', startSeconds: 24 },
  { title: 'Track the Goal', summary: 'Watch the campaign percentage increase as doors are completed.', startSeconds: 32 },
  { title: 'Watch Progress Build', summary: 'See the finished route and color-coded results across the map.', startSeconds: 41 },
  { title: 'Share Activity', summary: 'Export a polished summary of the completed field session.', startSeconds: 52 },
] as const satisfies readonly IphoneChapter[];

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

function getLiveDrawnPolygon(draw: MapboxDraw | null): GeoJSON.Polygon | null {
  const geometry = draw?.getAll().features.find((feature) => feature.geometry.type === 'Polygon')?.geometry;
  if (geometry?.type !== 'Polygon') return null;
  const ring = geometry.coordinates[0]?.filter(
    (coordinate): coordinate is GeoJSON.Position =>
      Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]),
  );
  if (!ring || ring.length < 3) return null;
  const normalized = ring.slice();
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) normalized.push([...first]);
  if (normalized.length < 4) return null;
  return { type: 'Polygon', coordinates: [normalized] };
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

function buildingsFromGeoJSON(collection: GeoJSON.FeatureCollection): Demo100Building[] {
  const unique = new Map<string, Demo100Building>();
  collection.features.forEach((candidate, index) => {
    if (candidate.geometry?.type !== 'Polygon' && candidate.geometry?.type !== 'MultiPolygon') return;
    const geometry = candidate.geometry;
    const center = featureCenter(geometry);
    if (!center) return;
    const properties = (candidate.properties ?? {}) as Record<string, unknown>;
    const id = String(
      candidate.id
      ?? properties.building_id
      ?? properties.gers_id
      ?? properties.id
      ?? `geojson-${center[0].toFixed(7)}:${center[1].toFixed(7)}:${index}`,
    );
    if (unique.has(id)) return;
    unique.set(id, {
      id,
      center,
      geometry,
      streetName: typeof properties.street_name === 'string' ? properties.street_name : null,
      houseNumber: typeof properties.house_number === 'string' || typeof properties.house_number === 'number'
        ? properties.house_number
        : typeof properties.number === 'string' || typeof properties.number === 'number'
          ? properties.number
          : null,
      feature: {
        type: 'Feature',
        id,
        properties: { ...properties, id, building_id: id },
        geometry,
      },
    });
  });
  return Array.from(unique.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function createTrialHref(referralCode?: string) {
  const params = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: 'self-serve-campaign',
    resumeCampaign: '1',
    entry: 'demo100',
    offer: DEMO_100_TRIAL_OFFER,
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
  const selectionFrameRef = useRef(0);
  const livePolygonTimerRef = useRef(0);
  const preserveDraftOnDrawDeleteRef = useRef(false);
  const boundaryPracticeActiveRef = useRef(false);
  const boundaryPracticeCompleteRef = useRef(false);
  const boundaryPracticeStepRef = useRef<BoundaryPracticeStep>('first_point');
  const boundaryPracticeClickCountRef = useRef(0);
  const isolatedLayerOpacitiesRef = useRef(new Map<string, { property: string; value: unknown }>());
  const [stage, setStage] = useState<Demo100Stage>('intro_video');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [builderStep, setBuilderStep] = useState<'location' | 'selection'>('location');
  const [searchValue, setSearchValue] = useState('');
  const [campaignName, setCampaignName] = useState('FIRST CAMPAIGN');
  const [polygon, setPolygon] = useState<GeoJSON.Polygon | null>(null);
  const [buildings, setBuildings] = useState<Demo100Building[]>([]);
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [boundaryPracticeComplete, setBoundaryPracticeComplete] = useState(false);
  const [boundaryPracticeStep, setBoundaryPracticeStep] = useState<BoundaryPracticeStep>('first_point');
  const [territoryOrbitComplete, setTerritoryOrbitComplete] = useState(false);
  const [generatedBuildings, setGeneratedBuildings] = useState<Demo100Building[] | null>(null);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedBuildingsApplied, setGeneratedBuildingsApplied] = useState(false);
  const [resultRevealCount, setResultRevealCount] = useState(0);
  const [assignmentConfirmed, setAssignmentConfirmed] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<'shared' | 'split'>('split');
  const [liveProgress, setLiveProgress] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const outcomes = useMemo(() => getDemo100Outcomes(buildings.length), [buildings.length]);
  const finalMetrics = useMemo(() => getDemo100Metrics(buildings.length), [buildings.length]);
  const performanceRatios = useMemo(() => [
    ['Conversation rate', `${Math.round(finalMetrics.conversationRate * 100)}%`],
    ['Conversation → lead', `${finalMetrics.conversations > 0 ? Math.round((finalMetrics.leads / finalMetrics.conversations) * 100) : 0}%`],
    ['Doors / conversation', finalMetrics.conversations > 0 ? (finalMetrics.doors / finalMetrics.conversations).toFixed(1) : '0'],
    ['Lead → appointment', `${finalMetrics.leads > 0 ? Math.round((finalMetrics.appointments / finalMetrics.leads) * 100) : 0}%`],
  ] as const, [finalMetrics]);
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
  const selectedMemberIdSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const sharedMapColor = useMemo(
    () => DEMO100_MEMBERS.find((member) => selectedMemberIdSet.has(member.id))?.color ?? DEMO100_MEMBERS[0].color,
    [selectedMemberIdSet],
  );
  const allMembersSelected = selectedMemberIds.length === DEMO100_MEMBERS.length;
  const liveElapsedMs = liveProgress * (choreography?.assignmentDurationMs ?? 0);
  const completedLiveHomeIds = useMemo(
    () => new Set(
      (choreography?.assignedHomes ?? [])
        .filter((home) => home.completeAtMs !== null && home.completeAtMs <= liveElapsedMs)
        .map((home) => home.id),
    ),
    [choreography, liveElapsedMs],
  );
  const activeLiveHomeIds = useMemo(() => {
    if (!choreography || liveProgress >= 1) return new Set<string>();
    return new Set(DEMO100_MEMBERS.flatMap((member) => {
      const route = choreography.assignedHomes
        .filter((home) => home.assigneeId === member.id)
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
      const activeHome = route.find((home) => home.completeAtMs !== null && home.completeAtMs > liveElapsedMs);
      return activeHome ? [activeHome.id] : [];
    }));
  }, [choreography, liveElapsedMs, liveProgress]);
  const completedLiveCount = completedLiveHomeIds.size;
  const assignmentPreviewById = useMemo(() => {
    const assigned = new Map<string, Demo100Member>();
    const selectedMembers = DEMO100_MEMBERS.filter((member) => selectedMemberIdSet.has(member.id));
    if (selectedMembers.length === 0 || buildings.length === 0) return assigned;
    if (assignmentMode === 'shared') {
      buildings.forEach((building) => assigned.set(building.id, selectedMembers[0]));
      return assigned;
    }

    const depot = buildings.reduce(
      (center, building) => ({
        lat: center.lat + building.center[1] / buildings.length,
        lon: center.lon + building.center[0] / buildings.length,
      }),
      { lat: 0, lon: 0 },
    );
    const clusters = buildSmartTerritoryClusters(
      buildings.map((building) => ({
        id: building.id,
        lat: building.center[1],
        lon: building.center[0],
        house_number: building.houseNumber == null ? undefined : String(building.houseNumber),
        street_name: building.streetName ?? undefined,
      })),
      selectedMembers.length,
      depot,
    );
    clusters.forEach((cluster, index) => {
      const member = selectedMembers[index];
      if (!member) return;
      cluster.addresses.forEach((address) => assigned.set(address.id, member));
    });
    return assigned;
  }, [assignmentMode, buildings, selectedMemberIdSet]);

  const setAndTrackStage = useCallback((next: Demo100Stage, event?: string) => {
    setStage(next);
    if (event) track(event, getDemo100StageNumber(next), { stage: next });
  }, []);

  const generateCompleteBuildingGeoJSON = useCallback(async (territory: GeoJSON.Polygon) => {
    setGenerationStatus('building');
    setGenerationError(null);
    setGeneratedBuildings(null);
    setGeneratedBuildingsApplied(false);
    setTerritoryOrbitComplete(false);
    try {
      const response = await fetch('/api/demo100/buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polygon: territory }),
      });
      const payload = await response.json().catch(() => ({})) as GeoJSON.FeatureCollection & { error?: string };
      if (!response.ok) throw new Error(payload.error || `3D map creation failed (${response.status})`);
      const completeBuildings = buildingsFromGeoJSON(payload);
      if (completeBuildings.length < MIN_HOMES) throw new Error('Fewer than four complete homes were found.');
      setGeneratedBuildings(completeBuildings);
      setGenerationStatus('ready');
      track('territory_geojson_ready', 3, { homes: completeBuildings.length });
    } catch (error) {
      setGenerationStatus('error');
      setGenerationError(error instanceof Error ? error.message : 'WolfGrid could not finish this 3D map.');
      track('territory_geojson_failed', 3);
    }
  }, []);

  const selectBuildings = useCallback((nextPolygon: GeoJSON.Polygon) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setSelectionBusy(true);
    setSelectionError(null);

    window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      try {
        const bbox = polygonBbox(nextPolygon);
        const southWest = map.project([bbox[0], bbox[1]]);
        const northEast = map.project([bbox[2], bbox[3]]);
        const canvas = map.getCanvas();
        const queryBounds: [[number, number], [number, number]] = [
          [
            Math.max(0, Math.min(canvas.clientWidth, Math.min(southWest.x, northEast.x))),
            Math.max(0, Math.min(canvas.clientHeight, Math.min(southWest.y, northEast.y))),
          ],
          [
            Math.max(0, Math.min(canvas.clientWidth, Math.max(southWest.x, northEast.x))),
            Math.max(0, Math.min(canvas.clientHeight, Math.max(southWest.y, northEast.y))),
          ],
        ];
        const candidateLayers = map.getLayer('demo100-base-buildings')
          ? ['demo100-base-buildings']
          : (map.getStyle().layers ?? [])
              .filter((layer) => layer.id.toLowerCase().includes('building') && layer.type !== 'symbol')
              .map((layer) => layer.id)
              .filter((id) => map.getLayer(id));
        const features = candidateLayers.length > 0
          ? map.queryRenderedFeatures(
              queryBounds,
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

  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !mapLoaded || stage !== 'campaign_builder' || builderStep !== 'selection') return;

    const container = map.getContainer();
    container.classList.add('flyr-territory-draw-cursor');
    const readLiveBoundary = () => {
      if (boundaryPracticeActiveRef.current) return;
      window.clearTimeout(livePolygonTimerRef.current);
      livePolygonTimerRef.current = window.setTimeout(() => {
        const livePolygon = getLiveDrawnPolygon(draw);
        if (livePolygon) selectBuildings(livePolygon);
      }, 60);
    };

    map.on('draw.render', readLiveBoundary);
    return () => {
      window.clearTimeout(livePolygonTimerRef.current);
      map.off('draw.render', readLiveBoundary);
      container.classList.remove('flyr-territory-draw-cursor');
    };
  }, [builderStep, mapLoaded, selectBuildings, stage]);

  useEffect(() => {
    const draw = drawRef.current;
    if (
      !draw
      || !mapLoaded
      || stage !== 'campaign_builder'
      || builderStep !== 'selection'
      || polygon
      || boundaryPracticeComplete
    ) return;
    draw.changeMode('draw_polygon');
  }, [boundaryPracticeComplete, builderStep, mapLoaded, polygon, stage]);

  const addBaseBuildings = useCallback((map: mapboxgl.Map) => {
    if (map.getLayer('demo100-base-buildings') || !map.getSource('composite')) return;
    const label = map.getStyle().layers?.find((layer) => layer.type === 'symbol' && Boolean((layer as mapboxgl.SymbolLayer).layout?.['text-field']))?.id;
    map.addLayer({
      id: 'demo100-base-buildings',
      type: 'fill',
      source: 'composite',
      'source-layer': 'building',
      minzoom: 12,
      paint: {
        'fill-color': '#64748b',
        'fill-opacity': 0.72,
        'fill-outline-color': '#94a3b8',
      },
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
      version: 2,
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
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });
    mapRef.current = map;
    const draw = new MapboxDraw({ displayControlsDefault: false, defaultMode: 'simple_select', styles: drawStyles() });
    drawRef.current = draw;
    map.addControl(draw);

    const updateBoundaryPracticeStep = (nextStep: BoundaryPracticeStep) => {
      boundaryPracticeStepRef.current = nextStep;
      setBoundaryPracticeStep(nextStep);
    };
    const handlePracticeClick = () => {
      if (!boundaryPracticeActiveRef.current) return;
      if (boundaryPracticeStepRef.current === 'first_point') {
        boundaryPracticeClickCountRef.current = 1;
        updateBoundaryPracticeStep('move_cursor');
      } else if (boundaryPracticeStepRef.current === 'second_point') {
        boundaryPracticeClickCountRef.current = 2;
        updateBoundaryPracticeStep('double_click');
      }
    };
    const handlePracticeMove = () => {
      if (!boundaryPracticeActiveRef.current || boundaryPracticeStepRef.current !== 'move_cursor') return;
      updateBoundaryPracticeStep('second_point');
    };
    const handleSelection = () => {
      if (boundaryPracticeActiveRef.current) {
        window.clearTimeout(livePolygonTimerRef.current);
        window.cancelAnimationFrame(selectionFrameRef.current);
        boundaryPracticeActiveRef.current = false;
        boundaryPracticeCompleteRef.current = true;
        boundaryPracticeClickCountRef.current = 0;
        setBoundaryPracticeComplete(true);
        updateBoundaryPracticeStep('complete');
        preserveDraftOnDrawDeleteRef.current = true;
        draw.deleteAll();
        preserveDraftOnDrawDeleteRef.current = false;
        setPolygon(null);
        setBuildings([]);
        setDiscoveredCount(0);
        track('boundary_practice_complete', 2);
        return;
      }
      const nextPolygon = getDrawnPolygon(draw);
      if (nextPolygon) selectBuildings(nextPolygon);
    };
    const handleDelete = () => {
      if (preserveDraftOnDrawDeleteRef.current) return;
      setPolygon(null);
      setBuildings([]);
      setDiscoveredCount(0);
    };
    map.on('draw.create', handleSelection);
    map.on('draw.update', handleSelection);
    map.on('draw.delete', handleDelete);
    map.on('click', handlePracticeClick);
    map.on('mousemove', handlePracticeMove);
    map.on('load', () => {
      addBaseBuildings(map);
      setMapLoaded(true);
      const stored = pendingRestoreRef.current;
      if (stored?.polygon && stored.selectedCount >= MIN_HOMES) {
        boundaryPracticeActiveRef.current = false;
        boundaryPracticeCompleteRef.current = true;
        boundaryPracticeStepRef.current = 'complete';
        setBoundaryPracticeComplete(true);
        setBoundaryPracticeStep('complete');
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
      map.off('draw.delete', handleDelete);
      map.off('click', handlePracticeClick);
      map.off('mousemove', handlePracticeMove);
      removeMapboxMapWhenSafe(map);
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [addBaseBuildings, selectBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource(BUILDING_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: buildings.map((building, index) => {
        const assignment = choreographyById.get(building.id);
        const assignmentPreview = assignmentPreviewById.get(building.id);
        let color = stage === 'territory_preview' ? '#cbd5e1' : '#64748b';
        if (stage === 'campaign_results' || stage === 'team_stats') {
          color = index < resultRevealCount || stage === 'team_stats' ? OUTCOME_COLORS[outcomes[index]] : '#64748b';
        } else if (stage === 'assignments') {
          color = assignmentPreview?.color ?? '#475569';
        } else if (stage === 'live_map') {
          color = completedLiveHomeIds.has(building.id)
            ? '#22c55e'
            : assignmentMode === 'shared'
              ? sharedMapColor
              : assignment?.assigneeColor ?? '#64748b';
          if (activeLiveHomeIds.has(building.id)) color = '#ffffff';
        }
        return {
          ...building.feature,
          properties: { ...building.feature.properties, display_color: color },
        };
      }),
    };

    if (source) {
      source.setData(data);
      if (map.getLayer(BUILDING_LAYER_ID)) {
        map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-height-transition', { duration: 1_400, delay: 0 });
        map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-opacity-transition', { duration: 450, delay: 0 });
        map.setPaintProperty(
          BUILDING_LAYER_ID,
          'fill-extrusion-opacity',
          stage === 'territory_preview' && !generatedBuildingsApplied ? 0 : 0.9,
        );
        map.setPaintProperty(
          BUILDING_LAYER_ID,
          'fill-extrusion-height',
          stage === 'campaign_builder' ? 0.25 : stage === 'territory_preview' ? 7 : 5.5,
        );
      }
    } else if (buildings.length > 0) {
      map.addSource(BUILDING_SOURCE_ID, { type: 'geojson', data });
      const label = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
      map.addLayer({
        id: BUILDING_LAYER_ID,
        type: 'fill-extrusion',
        source: BUILDING_SOURCE_ID,
        paint: {
          'fill-extrusion-color': ['get', 'display_color'],
          'fill-extrusion-height': stage === 'campaign_builder' ? 0.25 : stage === 'territory_preview' ? 7 : 5.5,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': stage === 'territory_preview' && !generatedBuildingsApplied ? 0 : 0.9,
        },
      }, label);
    }
  }, [activeLiveHomeIds, assignmentMode, assignmentPreviewById, buildings, choreographyById, completedLiveHomeIds, generatedBuildingsApplied, mapLoaded, outcomes, resultRevealCount, selectedMemberIds.length, selectedMemberIdSet, sharedMapColor, stage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const isolateSelectedHomes = DEMO100_STAGES.indexOf(stage) >= DEMO100_STAGES.indexOf('territory_preview');
    const duration = stage === 'territory_preview' ? 1_500 : 0;
    preserveDraftOnDrawDeleteRef.current = isolateSelectedHomes;

    for (const layer of map.getStyle().layers ?? []) {
      const sourceLayer = (layer as mapboxgl.AnyLayer & { 'source-layer'?: string })['source-layer'];
      const isDrawLayer = layer.id.startsWith('gl-draw-');
      const isSurroundingBuildingLayer = layer.id !== BUILDING_LAYER_ID
        && (layer.id.toLowerCase().includes('building') || sourceLayer === 'building');
      if (!isDrawLayer && !isSurroundingBuildingLayer) continue;
      const opacityProperty = layer.type === 'fill'
        ? 'fill-opacity'
        : layer.type === 'fill-extrusion'
          ? 'fill-extrusion-opacity'
        : layer.type === 'line'
          ? 'line-opacity'
          : layer.type === 'circle'
            ? 'circle-opacity'
            : null;
      if (!opacityProperty) continue;
      const opacityKey = `${layer.id}:${opacityProperty}`;
      if (!isolatedLayerOpacitiesRef.current.has(opacityKey)) {
        isolatedLayerOpacitiesRef.current.set(opacityKey, {
          property: opacityProperty,
          value: map.getPaintProperty(layer.id, opacityProperty) ?? 1,
        });
      }
      const originalOpacity = isolatedLayerOpacitiesRef.current.get(opacityKey)?.value ?? 1;
      map.setPaintProperty(layer.id, `${opacityProperty}-transition`, { duration, delay: 0 });
      map.setPaintProperty(layer.id, opacityProperty, isolateSelectedHomes ? 0 : originalOpacity as never);
    }

    let removeBoundaryTimer = 0;
    if (isolateSelectedHomes) {
      removeBoundaryTimer = window.setTimeout(() => drawRef.current?.deleteAll(), duration);
    }

    return () => window.clearTimeout(removeBoundaryTimer);
  }, [mapLoaded, stage]);

  useEffect(() => {
    if (stage !== 'territory_preview' || generationStatus !== 'ready' || !generatedBuildings) return;
    setBuildings(generatedBuildings);
    setDiscoveredCount(generatedBuildings.length);
    setResultRevealCount(0);
    setGeneratedBuildingsApplied(true);
  }, [generatedBuildings, generationStatus, stage]);

  useEffect(() => {
    if (!polygon || generationStatus !== 'idle') return;
    if (DEMO100_STAGES.indexOf(stage) < DEMO100_STAGES.indexOf('territory_preview')) return;
    void generateCompleteBuildingGeoJSON(polygon);
  }, [generateCompleteBuildingGeoJSON, generationStatus, polygon, stage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (stage === 'intro_video' || stage === 'campaign_builder') {
      map.easeTo({ pitch: 0, bearing: 0, duration: stage === 'campaign_builder' ? 700 : 0 });
      return;
    }
    if (stage !== 'territory_preview' && map.getPitch() < 45) {
      map.jumpTo({ pitch: 55 });
    }
  }, [mapLoaded, stage]);

  useEffect(() => {
    const map = mapRef.current;
    if (stage !== 'territory_preview' || !generatedBuildingsApplied || !map || !mapLoaded || !polygon || buildings.length === 0) return;

    setTerritoryOrbitComplete(false);
    map.resize();
    const bbox = polygonBbox(polygon);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 120, right: 90, bottom: 220, left: 90 },
      maxZoom: 17.5,
      pitch: 0,
      duration: 0,
    });

    const startingBearing = map.getBearing();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      map.jumpTo({ bearing: startingBearing, pitch: 62 });
      setTerritoryOrbitComplete(true);
      track('territory_preview_complete', 2, { homes: buildings.length, reducedMotion: true });
      return;
    }

    const startedAt = performance.now();
    let animationFrame = 0;
    const orbit = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / TERRITORY_ORBIT_DURATION_MS);
      const tiltProgress = Math.min(1, progress / 0.22);
      const easedTilt = 1 - Math.pow(1 - tiltProgress, 3);
      map.jumpTo({ bearing: startingBearing + progress * 360, pitch: easedTilt * 62 });
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(orbit);
        return;
      }
      map.jumpTo({ bearing: startingBearing, pitch: 62 });
      setTerritoryOrbitComplete(true);
      track('territory_preview_complete', 2, { homes: buildings.length });
    };
    animationFrame = window.requestAnimationFrame(orbit);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [buildings.length, generatedBuildingsApplied, mapLoaded, polygon, stage]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || stage !== 'live_map' || !choreography) return;
    const repFeatures = DEMO100_MEMBERS.flatMap((member) => {
      const homes = choreography.assignedHomes
        .filter((home) => home.assigneeId === member.id)
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
      if (homes.length === 0) return [];
      const home = homes.find((candidate) => candidate.completeAtMs !== null && candidate.completeAtMs > liveElapsedMs)
        ?? homes[homes.length - 1];
      return [{
        type: 'Feature' as const,
        properties: { name: member.name, color: assignmentMode === 'shared' ? sharedMapColor : member.color },
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
  }, [assignmentMode, choreography, liveElapsedMs, mapLoaded, sharedMapColor, stage]);

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
    boundaryPracticeActiveRef.current = true;
    boundaryPracticeCompleteRef.current = false;
    boundaryPracticeStepRef.current = 'first_point';
    boundaryPracticeClickCountRef.current = 0;
    setBoundaryPracticeComplete(false);
    setBoundaryPracticeStep('first_point');
    setBuilderStep('selection');
    mapRef.current?.flyTo({ center, zoom: 16, pitch: 0, bearing: 0, duration: 1100 });
    track('builder_location_selected', 2, { label: suggestion.title });
  };

  const startPolygon = () => {
    window.clearTimeout(livePolygonTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    setSelectionError(null);
    setSelectionBusy(false);
    if (!boundaryPracticeCompleteRef.current) {
      boundaryPracticeActiveRef.current = true;
      boundaryPracticeStepRef.current = 'first_point';
      boundaryPracticeClickCountRef.current = 0;
      setBoundaryPracticeStep('first_point');
    } else {
      boundaryPracticeActiveRef.current = false;
    }
    drawRef.current?.deleteAll();
    setPolygon(null);
    setBuildings([]);
    setDiscoveredCount(0);
    drawRef.current?.changeMode('draw_polygon');
    track('selection_tool_changed', 2, { tool: boundaryPracticeCompleteRef.current ? 'polygon' : 'polygon_practice' });
  };

  const resetBoundary = () => {
    window.clearTimeout(livePolygonTimerRef.current);
    window.cancelAnimationFrame(selectionFrameRef.current);
    setSelectionError(null);
    setSelectionBusy(false);
    drawRef.current?.deleteAll();
    setPolygon(null);
    setBuildings([]);
    setDiscoveredCount(0);
    if (boundaryPracticeCompleteRef.current) {
      boundaryPracticeActiveRef.current = false;
      boundaryPracticeStepRef.current = 'complete';
      setBoundaryPracticeStep('complete');
    } else {
      boundaryPracticeActiveRef.current = true;
      boundaryPracticeStepRef.current = 'first_point';
      boundaryPracticeClickCountRef.current = 0;
      setBoundaryPracticeStep('first_point');
    }
    drawRef.current?.changeMode('draw_polygon');
    track('boundary_reset', 2, { practiceComplete: boundaryPracticeCompleteRef.current });
  };

  const createDraft = useCallback(() => {
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
    void generateCompleteBuildingGeoJSON(polygon);
    setAndTrackStage('territory_preview', 'territory_generation_started');
  }, [buildings.length, campaignName, generateCompleteBuildingGeoJSON, polygon, referralCode, setAndTrackStage]);

  const video = VIDEO_STAGES[stage];
  const iphoneChapters = IPHONE_CHAPTERS;
  const boundaryPracticeStepIndex = boundaryPracticeStep === 'complete'
    ? BOUNDARY_PRACTICE_STEPS.length
    : BOUNDARY_PRACTICE_STEPS.findIndex((step) => step.key === boundaryPracticeStep);
  const boundaryPracticeInstruction = boundaryPracticeStep === 'complete'
    ? 'Practice complete. Select Draw boundary, then outline your real campaign.'
    : BOUNDARY_PRACTICE_STEPS[boundaryPracticeStepIndex]?.instruction;

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

  const toggleMemberSelection = useCallback((memberId: string) => {
    setSelectedMemberIds((current) => {
      const selected = current.includes(memberId);
      const next = selected
        ? current.filter((id) => id !== memberId)
        : DEMO100_MEMBERS.map((member) => member.id).filter((id) => current.includes(id) || id === memberId);
      track('assignment_member_toggled', 5, { memberId, selected: !selected, mode: assignmentMode });
      return next;
    });
  }, [assignmentMode]);

  const assignCampaign = useCallback(() => {
    if (assignmentConfirmed || !allMembersSelected) return;
    setAssignmentConfirmed(true);
    track('assignment_complete', 5, { homes: buildings.length, reps: 4, mode: assignmentMode });
    window.setTimeout(() => setAndTrackStage('live_map', 'stage_enter'), 450);
  }, [allMembersSelected, assignmentConfirmed, assignmentMode, buildings.length, setAndTrackStage]);

  const advanceDemo = useCallback(() => {
    if (video) {
      track('video_skipped', getDemo100StageNumber(stage), { chapter: stage });
      setAndTrackStage(nextDemo100Stage(stage), 'stage_enter');
      return;
    }
    if (stage === 'campaign_builder') {
      createDraft();
      return;
    }
    if (stage === 'territory_preview') {
      setAndTrackStage('post_create_video', 'territory_preview_continue');
      return;
    }
    if (stage === 'campaign_results') {
      setAndTrackStage('assignments', 'assignments_viewed');
      return;
    }
    if (stage === 'assignments') {
      if (!allMembersSelected) {
        setSelectedMemberIds(DEMO100_MEMBERS.map((member) => member.id));
      }
      setAssignmentConfirmed(true);
      track('assignment_complete', 5, { homes: buildings.length, reps: 4, mode: assignmentMode, advancedWithNext: true });
      setAndTrackStage('live_map', 'stage_enter');
      return;
    }
    if (stage === 'live_map') {
      setAndTrackStage('team_stats', 'team_stats_viewed');
      return;
    }
    if (stage === 'team_stats') setAndTrackStage('field_guide_intro_video', 'stage_enter');
  }, [allMembersSelected, assignmentMode, buildings.length, createDraft, setAndTrackStage, stage, video]);

  const resetDemo = () => {
    window.localStorage.removeItem(DEMO100_SESSION_STORAGE_KEY);
    window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY);
    window.localStorage.removeItem(SELF_SERVE_CAMPAIGN_DRAFT_KEY);
    drawRef.current?.deleteAll();
    setPolygon(null);
    setBuildings([]);
    setDiscoveredCount(0);
    setTerritoryOrbitComplete(false);
    setGeneratedBuildings(null);
    setGenerationStatus('idle');
    setGenerationError(null);
    setGeneratedBuildingsApplied(false);
    setResultRevealCount(0);
    setAssignmentConfirmed(false);
    setSelectedMemberIds([]);
    setAssignmentMode('split');
    setLiveProgress(0);
    boundaryPracticeActiveRef.current = false;
    boundaryPracticeCompleteRef.current = false;
    boundaryPracticeStepRef.current = 'first_point';
    boundaryPracticeClickCountRef.current = 0;
    setBoundaryPracticeComplete(false);
    setBoundaryPracticeStep('first_point');
    setBuilderStep('location');
    setCampaignName('FIRST CAMPAIGN');
    setStage('intro_video');
    track('replay', 1);
  };

  const zoneRows = useMemo(() => DEMO100_MEMBERS.map((member) => {
    const assigned = choreography?.assignedHomes.filter((home) => home.assigneeId === member.id) ?? [];
    const memberOutcomes = assigned.map((home) => outcomeById.get(home.id)).filter((outcome): outcome is SelfServeDoorOutcome => Boolean(outcome));
    return {
      member,
      assigned: assigned.length,
      completed: assigned.filter((home) => completedLiveHomeIds.has(home.id)).length,
      metrics: metricsFromOutcomes(memberOutcomes),
    };
  }), [choreography, completedLiveHomeIds, outcomeById]);
  const assignmentRows = useMemo(() => DEMO100_MEMBERS.map((member, index) => ({
    member,
    assigned: selectedMemberIds.length === 0
      ? zoneRows[index]?.assigned ?? 0
      : Array.from(assignmentPreviewById.values()).filter((assignedMember) => assignedMember.id === member.id).length,
  })), [assignmentPreviewById, selectedMemberIds.length, zoneRows]);

  useEffect(() => {
    if (stage === 'cta') track('cta_view', 9, { homes: buildings.length });
  }, [buildings.length, stage]);

  return (
    <main className="relative h-[100dvh] min-h-[640px] overflow-hidden bg-[#07090d] text-white">
      <div className="absolute inset-0">
        <div ref={mapContainerRef} className="size-full" aria-label="Interactive campaign map" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,6,10,.34),transparent_38%,rgba(4,6,10,.62))]" />
      <StageProgress stage={stage} />

      {video ? (
        <CloudflareChapterPlayer
          key={stage}
          customerCode={customerCode}
          videoUid={videoUids[video.uidKey]}
          title={video.title}
          eyebrow={video.eyebrow}
          autoPlayWithSound={stage !== 'intro_video'}
          onStarted={handleVideoStarted}
          onComplete={handleVideoComplete}
        />
      ) : null}

      {stage === 'iphone_chapters' ? (
        <IphoneChapterExperience
          chapters={iphoneChapters}
          customerCode={customerCode}
          videoUid={videoUids.iphone}
          playbackEndSeconds={58}
          onChapterStarted={(chapterIndex) => track('iphone_chapter_started', 8, { chapter: chapterIndex + 1 })}
          onChapterCompleted={(chapterIndex) => track('iphone_chapter_completed', 8, { chapter: chapterIndex + 1 })}
          onComplete={() => setAndTrackStage('outro_video', 'stage_enter')}
        />
      ) : null}

      {stage !== 'cta' && stage !== 'campaign_builder' && stage !== 'iphone_chapters' ? (
        <Button
          type="button"
          onClick={advanceDemo}
          aria-label="Go to the next demo chapter"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[130] h-12 rounded-full border border-white/15 bg-white px-5 font-black text-zinc-950 shadow-2xl shadow-black/50 hover:bg-zinc-100"
        >
          Next <ArrowRight className="size-4" />
        </Button>
      ) : null}

      {stage === 'campaign_builder' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24 sm:items-center">
          {builderStep === 'location' ? (
            <section className="pointer-events-auto w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#090b10]/92 p-6 shadow-2xl backdrop-blur-2xl sm:-translate-y-12 sm:p-8">
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
              <section className="pointer-events-auto absolute inset-x-4 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#090b10]/90 p-2 shadow-2xl backdrop-blur-xl">
                <div className="grid grid-cols-[4fr_1fr] gap-2">
                  <Button type="button" onClick={startPolygon} className="h-12 rounded-xl bg-red-500 font-black hover:bg-red-400">
                    <Pentagon className="size-4" /> Draw boundary
                  </Button>
                  <Button
                    type="button"
                    onClick={resetBoundary}
                    aria-label="Reset boundary"
                    title="Reset boundary"
                    className="h-12 min-w-0 rounded-xl border border-white/10 bg-white/10 px-2 font-black text-white hover:bg-white/15"
                  >
                    <RotateCcw className="size-4" />
                    <span className="hidden sm:inline">Reset</span>
                  </Button>
                </div>
                <div aria-live="polite" className={`mt-2 rounded-xl border p-3 ${boundaryPracticeComplete ? 'border-emerald-400/25 bg-emerald-500/10' : 'border-red-400/25 bg-red-500/10'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full ${boundaryPracticeComplete ? 'bg-emerald-400 text-emerald-950' : 'bg-red-500 text-white'}`}>
                      {boundaryPracticeComplete ? <Check className="size-4" /> : <MousePointer2 className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[9px] font-black uppercase tracking-[0.18em] ${boundaryPracticeComplete ? 'text-emerald-300' : 'text-red-300'}`}>
                        {boundaryPracticeComplete ? 'Your turn' : 'Practice boundary first'}
                      </p>
                      <p className="mt-0.5 text-xs font-bold leading-4 text-white">{boundaryPracticeInstruction}</p>
                    </div>
                  </div>
                  {!boundaryPracticeComplete ? (
                    <div className="mt-3 grid grid-cols-4 gap-1.5" aria-label="Boundary practice steps">
                      {BOUNDARY_PRACTICE_STEPS.map((practiceStep, index) => {
                        const isComplete = index < boundaryPracticeStepIndex;
                        const isCurrent = index === boundaryPracticeStepIndex;
                        return (
                          <div
                            key={practiceStep.key}
                            className={`rounded-lg border px-1.5 py-2 text-center ${isCurrent ? 'border-red-400 bg-red-500/20 text-white' : isComplete ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-black/20 text-zinc-500'}`}
                          >
                            <span className="mx-auto grid size-4 place-items-center rounded-full bg-white/10 text-[9px] font-black">
                              {isComplete ? <Check className="size-3" /> : index + 1}
                            </span>
                            <p className="mt-1 truncate text-[9px] font-black">{practiceStep.label}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="pointer-events-auto absolute inset-x-4 bottom-[max(5rem,calc(env(safe-area-inset-bottom)+5rem))] mx-auto max-w-md rounded-[1.5rem] border border-white/10 bg-[#090b10]/94 p-4 shadow-2xl backdrop-blur-2xl sm:bottom-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Homes selected</p>
                    <p className="mt-1 text-4xl font-black tracking-tight">{buildings.length}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-black ${buildings.length >= MIN_HOMES && discoveredCount <= MAX_HOMES ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                    {!boundaryPracticeComplete ? 'Practice first' : selectionBusy ? 'Reading map…' : discoveredCount > MAX_HOMES ? 'Area too large' : buildings.length >= MIN_HOMES ? 'Ready' : `Choose ${MIN_HOMES}+`}
                  </span>
                </div>
                {selectionError ? <p className="mt-2 text-sm font-semibold text-red-300">{selectionError}</p> : null}
                <Button
                  type="button"
                  onClick={createDraft}
                  disabled={!boundaryPracticeComplete || !polygon || buildings.length < MIN_HOMES || discoveredCount > MAX_HOMES || selectionBusy}
                  className="mt-3 h-12 w-full rounded-xl bg-red-500 text-sm font-black hover:bg-red-400"
                >
                  {boundaryPracticeComplete ? 'Create 3D Prospecting Map' : 'Complete the practice first'} <ArrowRight className="size-4" />
                </Button>
              </section>
            </>
          )}
        </div>
      ) : null}

      {stage === 'territory_preview' ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-24">
          <section className="pointer-events-auto w-full max-w-lg rounded-[1.75rem] border border-white/10 bg-[#090b10]/92 p-5 text-center shadow-2xl backdrop-blur-2xl sm:p-6">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-red-500 shadow-lg shadow-red-950/40">
              <MapPinned className="size-5" />
            </div>
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-red-400">3D territory created</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">
              {generationStatus === 'ready' ? `${compactNumber(buildings.length)} homes are ready.` : 'Creating complete buildings…'}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-400">
              {generationStatus === 'error'
                ? generationError
                : territoryOrbitComplete
                ? 'Your complete campaign is mapped and ready for the next chapter.'
                : generationStatus === 'ready'
                  ? 'Taking one full look around your new campaign territory…'
                  : 'Joining every map-tile fragment into exact GeoJSON while you watch.'}
            </p>
            <Button
              type="button"
              onClick={() => {
                if (generationStatus === 'error' && polygon) {
                  void generateCompleteBuildingGeoJSON(polygon);
                  return;
                }
                setAndTrackStage('post_create_video', 'territory_preview_continue');
              }}
              className="mt-5 h-12 w-full rounded-xl bg-white font-black text-zinc-950 hover:bg-zinc-100"
            >
              {generationStatus === 'error' ? 'Retry 3D map' : 'Next'}
              {generationStatus === 'error' ? <RotateCcw className="size-4" /> : <ArrowRight className="size-4" />}
            </Button>
          </section>
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
              <MetricTile label="Leads" value={compactNumber(visibleMetrics.leads)} icon={UserRoundPlus} accent="text-blue-400" />
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
              <div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Assign your team</p><h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Select every rep.</h2></div>
              <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-black text-zinc-300">{selectedMemberIds.length}/4</span>
            </div>
            <div className="mt-5 space-y-2">
              {assignmentRows.map(({ member, assigned }) => {
                const selected = selectedMemberIdSet.has(member.id);
                const displayColor = assignmentMode === 'shared' ? sharedMapColor : member.color;
                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleMemberSelection(member.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition hover:bg-white/10 ${selected ? 'bg-white/10 text-white' : 'border-white/10 bg-white/[0.05] text-zinc-500'}`}
                    style={selected ? { borderColor: displayColor } : undefined}
                  >
                    <span className={`flex items-center gap-3 font-bold transition-colors ${selected ? 'text-white' : 'text-zinc-500'}`}>
                      <span
                        className="size-3 rounded-full border-2 transition-colors"
                        style={selected
                          ? { backgroundColor: displayColor, borderColor: displayColor }
                          : { backgroundColor: 'transparent', borderColor: '#71717a' }}
                      />
                      {member.name}
                    </span>
                    <span className={`flex items-center gap-2 text-sm font-black transition-colors ${selected ? 'text-white' : 'text-zinc-500'}`}>
                      {assignmentMode === 'shared' ? buildings.length : assigned} homes
                      {selected ? <Check className="size-4" style={{ color: displayColor }} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              {assignmentMode === 'shared'
                ? 'Every selected rep can see and work every home on one shared campaign map.'
                : 'WolfGrid gives each selected rep a contiguous zone and balances the workload automatically.'}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5" aria-label="Campaign map assignment mode">
              {([['shared', 'Shared map'], ['split', 'Split territory']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={assignmentMode === mode}
                  onClick={() => {
                    setAssignmentMode(mode);
                    track('assignment_mode_changed', 5, { mode });
                  }}
                  className={`h-10 rounded-lg text-xs font-black transition ${assignmentMode === mode ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:bg-white/10 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              onClick={assignCampaign}
              disabled={assignmentConfirmed || !allMembersSelected}
              className="mt-4 h-12 w-full rounded-xl bg-red-500 font-black hover:bg-red-400"
            >
              {assignmentConfirmed ? <Check className="size-4" /> : <UserRoundCheck className="size-4" />}
              {assignmentConfirmed
                ? 'Assignment sent'
                : allMembersSelected
                  ? 'Assign campaign'
                  : `${selectedMemberIds.length}/4 reps selected`}
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
              {zoneRows.map(({ member, assigned, completed }) => (
                <div key={member.id} className="rounded-xl bg-white/[0.05] p-3 text-xs font-bold text-zinc-300">
                  <span className="mb-2 block size-2.5 rounded-full" style={{ backgroundColor: assignmentMode === 'shared' ? sharedMapColor : member.color }} />
                  {member.name} · {completed}/{assigned}
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
            <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Team performance ratios">
              {performanceRatios.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/8 bg-white/[0.035] px-3 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</p>
                  <p className="mt-1 text-xl font-black text-white">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              {zoneRows.map(({ member, assigned, metrics }, index) => (
                <div key={member.id} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3.5 py-3 text-sm ${index > 0 ? 'border-t border-white/10' : ''}`}>
                  <span className="flex items-center gap-2 font-bold"><span className="size-2.5 rounded-full" style={{ backgroundColor: assignmentMode === 'shared' ? sharedMapColor : member.color }} />{member.name}</span>
                  <span className="text-zinc-400"><b className="text-white">{assigned}</b> doors</span>
                  <span className="text-zinc-400"><b className="text-white">{metrics.leads}</b> leads</span>
                  <span className="text-zinc-400"><b className="text-white">{metrics.appointments}</b> appts</span>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setAndTrackStage('field_guide_intro_video', 'stage_enter')} className="mt-5 h-12 w-full rounded-xl bg-red-500 font-black hover:bg-red-400">
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
              <Button asChild variant="outline" className="h-14 rounded-xl border-white/15 bg-white/[0.06] text-base font-black text-white hover:bg-white/[0.12] hover:text-white">
                <a href={founderCallHref} target="_blank" rel="noreferrer" onClick={() => track('book_call_click', 10, { homes: buildings.length })}>
                  <CalendarDays className="size-5 text-red-500" /> Book a Call
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
