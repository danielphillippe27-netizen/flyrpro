'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, getResolvedMapInitOptions, resolveMapStyle } from '@/lib/map-styles';
import { Card, CardContent } from '@/components/ui/card';

const ROUTES_SOURCE_ID = 'team-routes';
const ROUTES_LAYER_ID = 'team-routes-layer';
const KNOCKS_SOURCE_ID = 'team-knocks';
const KNOCKS_LAYER_ID = 'team-knocks-layer';
const LIVE_SOURCE_ID = 'team-live-presence';
const LIVE_LAYER_ID = 'team-live-presence-layer';
const LIVE_LABEL_LAYER_ID = 'team-live-presence-labels';
const DEMO_ASSIGNMENT_ROUTES_SOURCE_ID = 'team-demo-assignment-routes';
const DEMO_ASSIGNMENT_ROUTES_LAYER_ID = 'team-demo-assignment-routes-layer';
const DEMO_ASSIGNMENT_HOMES_SOURCE_ID = 'team-demo-assignment-homes';
const DEMO_ASSIGNMENT_HOMES_FILL_LAYER_ID = 'team-demo-assignment-homes-fill';
const DEMO_ASSIGNMENT_HOMES_LINE_LAYER_ID = 'team-demo-assignment-homes-line';
const DEMO_HOME_VISIT_DURATION_MS = 900;
const DEMO_ANIMATION_FRAME_MS = 120;
const DEMO_COMPLETED_COLOR = '#16A34A';
const MAX_DEMO_ASSIGNMENT_HOMES = 96;

type MapMember = { user_id: string; display_name: string; color: string };
type MapSession = {
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  distance_meters?: number;
  doors_hit?: number;
  conversations?: number;
  flyers_delivered?: number;
  path_geojson?: string | null;
};
type LivePresence = {
  user_id: string;
  display_name: string;
  color: string;
  campaign_id: string;
  campaign_name: string;
  session_id: string | null;
  lat: number;
  lng: number;
  status: string;
  updated_at: string | null;
  started_at: string | null;
  active_seconds: number;
  distance_meters: number;
  doors_hit: number;
  conversations: number;
  flyers_delivered: number;
};

type TeamMapTabProps = {
  range: { start: string; end: string };
  memberIds: string[];
  mapMode: 'routes' | 'knocked_homes' | 'live';
  demoLive?: boolean;
  campaignId?: string | null;
};

type DemoArea = {
  bbox: [number, number, number, number];
  polygon: GeoJSON.Polygon | null;
};

type DemoPathMember = {
  user_id: string;
  display_name: string;
  color: string;
  path: Array<[number, number]>;
};

type DemoAssignmentHome = {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  center: [number, number];
  assigneeId: string;
  assigneeName: string;
  assigneeColor: string;
  sequence: number;
};

type DemoMapBundle = {
  addresses?: GeoJSON.FeatureCollection<GeoJSON.Point>;
  buildings?: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
};

const FALLBACK_DEMO_PATHS = [
  {
    user_id: 'demo-maya',
    display_name: 'Maya',
    color: '#EF4444',
    path: [
      [-79.3928, 43.7047],
      [-79.3918, 43.7049],
      [-79.3907, 43.7052],
      [-79.3898, 43.7055],
      [-79.3889, 43.7058],
    ],
  },
  {
    user_id: 'demo-leo',
    display_name: 'Leo',
    color: '#2563EB',
    path: [
      [-79.3971, 43.7066],
      [-79.3961, 43.7068],
      [-79.3952, 43.7071],
      [-79.3941, 43.7074],
      [-79.3931, 43.7076],
    ],
  },
  {
    user_id: 'demo-ava',
    display_name: 'Ava',
    color: '#16A34A',
    path: [
      [-79.4003, 43.7029],
      [-79.3993, 43.7032],
      [-79.3984, 43.7035],
      [-79.3973, 43.7038],
      [-79.3962, 43.704],
    ],
  },
  {
    user_id: 'demo-noah',
    display_name: 'Noah',
    color: '#7C3AED',
    path: [
      [-79.3949, 43.7016],
      [-79.3939, 43.7019],
      [-79.3928, 43.7022],
      [-79.3917, 43.7025],
      [-79.3906, 43.7028],
    ],
  },
] as const satisfies ReadonlyArray<DemoPathMember>;

const DEMO_LIVE_MEMBERS = FALLBACK_DEMO_PATHS.map(({ user_id, display_name, color }) => ({
  user_id,
  display_name,
  color,
}));

function normalizeBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function bboxFromPolygon(polygon: GeoJSON.Polygon | null | undefined): [number, number, number, number] | null {
  if (!polygon?.coordinates?.length) return null;
  const points = polygon.coordinates.flat();
  const lngs = points.map((point) => point[0]).filter(Number.isFinite);
  const lats = points.map((point) => point[1]).filter(Number.isFinite);
  if (!lngs.length || !lats.length) return null;
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const crosses =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInDemoArea(point: [number, number], area?: DemoArea | null): boolean {
  if (!area) return true;
  const [minLng, minLat, maxLng, maxLat] = area.bbox;
  if (point[0] < minLng || point[0] > maxLng || point[1] < minLat || point[1] > maxLat) return false;
  const outerRing = area.polygon?.coordinates?.[0];
  return !outerRing?.length || pointInRing(point, outerRing);
}

function geometryCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  const points = rings.flat().filter(
    (point): point is [number, number] =>
      Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (points.length === 0) return null;
  const bounds = points.reduce(
    (current, point) => ({
      minLng: Math.min(current.minLng, point[0]),
      minLat: Math.min(current.minLat, point[1]),
      maxLng: Math.max(current.maxLng, point[0]),
      maxLat: Math.max(current.maxLat, point[1]),
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
    },
  );
  return [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
}

function fallbackDemoBbox(area?: DemoArea | null): [number, number, number, number] {
  if (area) return area.bbox;
  const points: Array<[number, number]> = FALLBACK_DEMO_PATHS.flatMap((member) =>
    member.path.map((point) => [point[0], point[1]] as [number, number]),
  );
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function homePolygonAround(
  center: [number, number],
  bbox: [number, number, number, number],
): GeoJSON.Polygon {
  const lngRadius = Math.max((bbox[2] - bbox[0]) * 0.011, 0.000025);
  const latRadius = Math.max((bbox[3] - bbox[1]) * 0.012, 0.000018);
  const [lng, lat] = center;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - lngRadius, lat - latRadius],
      [lng + lngRadius, lat - latRadius],
      [lng + lngRadius, lat + latRadius],
      [lng - lngRadius, lat + latRadius],
      [lng - lngRadius, lat - latRadius],
    ]],
  };
}

function fallbackDemoHomeCandidates(area?: DemoArea | null) {
  const bbox = fallbackDemoBbox(area);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const candidates: Array<{
    id: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    center: [number, number];
  }> = [];

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const lngProgress = 0.08 + (column / 11) * 0.84 + (row % 2 === 0 ? 0 : 0.008);
      const latProgress = 0.09 + (row / 7) * 0.82;
      const center: [number, number] = [
        lerp(minLng, maxLng, Math.min(0.94, lngProgress)),
        lerp(minLat, maxLat, latProgress),
      ];
      if (!pointInDemoArea(center, area)) continue;
      candidates.push({
        id: `demo-home-${row}-${column}`,
        center,
        geometry: homePolygonAround(center, bbox),
      });
    }
  }
  return candidates;
}

function orderNearestHomes<T extends { center: [number, number] }>(homes: T[]): T[] {
  if (homes.length <= 2) return homes;
  const remaining = [...homes].sort((a, b) => b.center[1] - a.center[1]);
  const ordered = [remaining.shift()!];
  while (remaining.length > 0) {
    const previous = ordered[ordered.length - 1].center;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((home, index) => {
      const lngDelta = home.center[0] - previous[0];
      const latDelta = home.center[1] - previous[1];
      const distance = lngDelta * lngDelta + latDelta * latDelta;
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    });
    ordered.push(remaining.splice(closestIndex, 1)[0]);
  }
  return ordered;
}

function buildDemoAssignmentHomes(bundle?: DemoMapBundle | null, area?: DemoArea | null): DemoAssignmentHome[] {
  let candidates: Array<{
    id: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    center: [number, number];
  }> = [];

  if (Array.isArray(bundle?.buildings?.features)) {
    candidates = bundle.buildings.features.flatMap((feature, index) => {
      if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return [];
      const center = geometryCenter(feature.geometry);
      if (!center || !pointInDemoArea(center, area)) return [];
      const properties = feature.properties ?? {};
      const id = String(properties.id ?? properties.building_id ?? feature.id ?? `bundle-home-${index}`);
      return [{ id, geometry: feature.geometry, center }];
    });
  }

  if (candidates.length === 0 && Array.isArray(bundle?.addresses?.features)) {
    const bbox = fallbackDemoBbox(area);
    candidates = bundle.addresses.features.flatMap((feature, index) => {
      if (feature.geometry?.type !== 'Point') return [];
      const [lng, lat] = feature.geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
      const center: [number, number] = [lng, lat];
      if (!pointInDemoArea(center, area)) return [];
      const properties = feature.properties ?? {};
      const id = String(properties.id ?? properties.address_id ?? feature.id ?? `bundle-address-home-${index}`);
      return [{ id, center, geometry: homePolygonAround(center, bbox) }];
    });
  }

  if (candidates.length === 0) candidates = fallbackDemoHomeCandidates(area);

  const spatiallySorted = [...candidates].sort(
    (a, b) => a.center[0] - b.center[0] || b.center[1] - a.center[1],
  );
  const sampled =
    spatiallySorted.length <= MAX_DEMO_ASSIGNMENT_HOMES
      ? spatiallySorted
      : Array.from({ length: MAX_DEMO_ASSIGNMENT_HOMES }, (_, index) =>
          spatiallySorted[Math.floor((index * spatiallySorted.length) / MAX_DEMO_ASSIGNMENT_HOMES)],
        );

  return DEMO_LIVE_MEMBERS.flatMap((member, memberIndex) => {
    const start = Math.floor((memberIndex * sampled.length) / DEMO_LIVE_MEMBERS.length);
    const end = Math.floor(((memberIndex + 1) * sampled.length) / DEMO_LIVE_MEMBERS.length);
    return orderNearestHomes(sampled.slice(start, end)).map((home, sequence) => ({
      ...home,
      assigneeId: member.user_id,
      assigneeName: member.display_name,
      assigneeColor: member.color,
      sequence,
    }));
  });
}

function completedDemoHomesForMember(homes: DemoAssignmentHome[], memberId: string, elapsedMs: number): number {
  return homes.filter(
    (home) => home.assigneeId === memberId && elapsedMs >= (home.sequence + 1) * DEMO_HOME_VISIT_DURATION_MS,
  ).length;
}

function isDemoHomeComplete(home: DemoAssignmentHome, elapsedMs: number): boolean {
  return elapsedMs >= (home.sequence + 1) * DEMO_HOME_VISIT_DURATION_MS;
}

function buildDemoPaths(area?: DemoArea | null): DemoPathMember[] {
  if (!area) return FALLBACK_DEMO_PATHS.map((member) => ({
    ...member,
    path: [...member.path],
  }));
  const [minLng, minLat, maxLng, maxLat] = area.bbox;
  const lngSpan = Math.max(maxLng - minLng, 0.0012);
  const latSpan = Math.max(maxLat - minLat, 0.0012);
  const safeMinLng = minLng + lngSpan * 0.16;
  const safeMaxLng = maxLng - lngSpan * 0.16;
  const safeMinLat = minLat + latSpan * 0.16;
  const safeMaxLat = maxLat - latSpan * 0.16;
  const rows = [0.72, 0.56, 0.38, 0.24];
  const startColumns = [0.18, 0.34, 0.52, 0.68];

  return DEMO_LIVE_MEMBERS.map((member, memberIndex) => ({
    ...member,
    path: Array.from({ length: 5 }, (_, step) => {
      const progress = (startColumns[memberIndex] + step * 0.08) % 0.82;
      const wiggle = Math.sin((step + memberIndex) * 1.35) * 0.045;
      const lng = lerp(safeMinLng, safeMaxLng, progress);
      const lat = lerp(safeMinLat, safeMaxLat, Math.min(0.92, Math.max(0.08, rows[memberIndex] + wiggle)));
      return [lng, lat] as [number, number];
    }),
  }));
}

function buildDemoLivePresence(
  elapsedMs: number,
  homes: DemoAssignmentHome[],
  area?: DemoArea | null,
): LivePresence[] {
  const now = new Date().toISOString();
  const fallbackPaths = buildDemoPaths(area);
  return DEMO_LIVE_MEMBERS.map((member, index) => {
    const assignment = homes
      .filter((home) => home.assigneeId === member.user_id)
      .sort((a, b) => a.sequence - b.sequence);
    const rawStep = elapsedMs / DEMO_HOME_VISIT_DURATION_MS;
    const hasFinishedAssignment = assignment.length > 0 && rawStep >= assignment.length;
    const step = Math.min(Math.floor(rawStep), Math.max(assignment.length - 1, 0));
    const progress = hasFinishedAssignment
      ? 1
      : Math.min(1, Math.max(0, rawStep - Math.floor(rawStep)));
    const eased = progress * progress * (3 - 2 * progress);
    const target = assignment[step]?.center ?? fallbackPaths[index].path[0];
    const previous =
      hasFinishedAssignment
        ? target
        : step > 0
        ? assignment[step - 1].center
        : fallbackPaths[index].path[0] ?? target;
    const lng = lerp(previous[0], target[0], eased);
    const lat = lerp(previous[1], target[1], eased);
    const completedHomes = completedDemoHomesForMember(homes, member.user_id, elapsedMs);
    const assignmentComplete = assignment.length > 0 && completedHomes >= assignment.length;
    return {
      user_id: member.user_id,
      display_name: member.display_name,
      color: member.color,
      campaign_id: 'self-serve-demo',
      campaign_name: 'FIRST CAMPAIGN · ASSIGNMENT',
      session_id: `demo-session-${member.user_id}`,
      lat,
      lng,
      status: assignmentComplete ? 'assignment complete' : 'active',
      updated_at: now,
      started_at: new Date(Date.now() - (18 + index * 4) * 60_000).toISOString(),
      active_seconds: 18 * 60 + Math.floor(elapsedMs / 1000) + index * 45,
      distance_meters: 850 + completedHomes * 24 + index * 110,
      doors_hit: completedHomes,
      conversations: Math.floor(completedHomes * 0.3),
      flyers_delivered: completedHomes,
    };
  });
}

function buildDemoAssignmentRoutes(homes: DemoAssignmentHome[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: DEMO_LIVE_MEMBERS.flatMap((member) => {
      const coordinates = homes
        .filter((home) => home.assigneeId === member.user_id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((home) => home.center);
      if (coordinates.length < 2) return [];
      return [{
        type: 'Feature' as const,
        properties: { color: member.color, display_name: member.display_name },
        geometry: { type: 'LineString' as const, coordinates },
      }];
    }),
  };
}

function buildRoutesGeoJSON(
  sessions: MapSession[],
  members: MapMember[]
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const memberMap = new Map(members.map((m) => [m.user_id, m]));
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const s of sessions) {
    const route = parseLineString(s.path_geojson);
    if (!route || !route.coordinates?.length) continue;
    const m = memberMap.get(s.user_id);
    const color = m?.color ?? '#3B82F6';
    features.push({
      type: 'Feature',
      properties: {
        session_id: s.session_id,
        user_id: s.user_id,
        display_name: m?.display_name ?? 'Member',
        color,
        duration_seconds: s.duration_seconds,
        doors_hit: s.doors_hit ?? 0,
        conversations: s.conversations ?? 0,
        flyers_delivered: s.flyers_delivered ?? 0,
        distance_meters: s.distance_meters ?? 0,
        started_at: s.started_at,
        ended_at: s.ended_at,
      },
      geometry: route,
    });
  }
  return { type: 'FeatureCollection', features };
}

export function TeamMapTab({ range, memberIds, mapMode, demoLive = false, campaignId = null }: TeamMapTabProps) {
  const { theme } = useTheme();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle('standard', theme, 'v12'),
    [theme],
  );
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const liveFitKeyRef = useRef<string | null>(null);

  const [members, setMembers] = useState<MapMember[]>([]);
  const [sessions, setSessions] = useState<MapSession[]>([]);
  const [knockEvents, setKnockEvents] = useState<Array<{ payload?: { lat?: number; lng?: number; [k: string]: unknown }; display_name?: string; user_id?: string }>>([]);
  const [livePresence, setLivePresence] = useState<LivePresence[]>([]);
  const [demoArea, setDemoArea] = useState<DemoArea | null>(null);
  const [demoAssignmentHomes, setDemoAssignmentHomes] = useState<DemoAssignmentHome[]>([]);
  const [demoElapsedMs, setDemoElapsedMs] = useState(0);
  const [demoReplayKey, setDemoReplayKey] = useState(0);
  const [demoAreaResolved, setDemoAreaResolved] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMapData = useCallback(async () => {
    if (demoLive) {
      setMembers(DEMO_LIVE_MEMBERS.map((member) => ({
        user_id: member.user_id,
        display_name: member.display_name,
        color: member.color,
      })));
      setSessions([]);
      setKnockEvents([]);
      if (campaignId && !demoAreaResolved) {
        setLivePresence([]);
        setError(null);
        setLoading(true);
        return;
      }
      setError(null);
      setLoading(false);
      return;
    }

    if (!currentWorkspaceId) {
      setMembers([]);
      setSessions([]);
      setKnockEvents([]);
      setLivePresence([]);
      setError('No workspace selected');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/team/map?workspaceId=${encodeURIComponent(currentWorkspaceId)}&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&mode=${encodeURIComponent(mapMode)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMembers(data.members ?? []);
      setSessions(data.sessions ?? []);
      const liveRows = ((data.livePresence ?? []) as LivePresence[]).filter((row) => {
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return false;
        if (memberIds.length === 0) return true;
        return memberIds.includes(row.user_id);
      });
      setLivePresence(liveRows);
      const points = (data.knockPoints ?? []) as Array<{ payload?: { lat?: number; lng?: number }; user_id?: string }>;
      setKnockEvents(
        points.filter((event) => {
          if (!event.payload || typeof event.payload.lat !== 'number' || typeof event.payload.lng !== 'number') return false;
          if (memberIds.length === 0) return true;
          return memberIds.includes(event.user_id ?? '');
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load map data');
      setMembers([]);
      setSessions([]);
      setKnockEvents([]);
      setLivePresence([]);
    } finally {
      setLoading(false);
    }
  }, [campaignId, currentWorkspaceId, demoAreaResolved, demoLive, range.start, range.end, mapMode, memberIds]);

  useEffect(() => {
    if (!demoLive || !campaignId) {
      setDemoArea(null);
      setDemoAssignmentHomes(demoLive ? buildDemoAssignmentHomes(null, null) : []);
      setDemoAreaResolved(demoLive);
      return;
    }

    let cancelled = false;
    setDemoAreaResolved(false);
    setDemoAssignmentHomes([]);
    Promise.all([
      fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
        credentials: 'include',
        cache: 'no-store',
      }).then((response) => (response.ok ? response.json() : null)),
      fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/map-bundle`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }).then((response) => (response.ok ? response.json() : null)),
    ])
      .then(([campaign, bundle]: [Record<string, unknown> | null, DemoMapBundle | null]) => {
        if (cancelled) return;
        if (!campaign) {
          setDemoArea(null);
          setDemoAssignmentHomes(buildDemoAssignmentHomes(bundle, null));
          setDemoAreaResolved(true);
          return;
        }
        const polygon =
          (campaign.territory_boundary as GeoJSON.Geometry | null)?.type === 'Polygon'
            ? (campaign.territory_boundary as GeoJSON.Polygon)
            : null;
        const bbox = normalizeBbox(campaign.bbox) ?? bboxFromPolygon(polygon);
        if (!bbox) {
          setDemoArea(null);
          setDemoAssignmentHomes(buildDemoAssignmentHomes(bundle, null));
          setDemoAreaResolved(true);
          return;
        }
        const area = { bbox, polygon } satisfies DemoArea;
        setDemoArea(area);
        setDemoAssignmentHomes(buildDemoAssignmentHomes(bundle, area));
        setDemoAreaResolved(true);
        liveFitKeyRef.current = null;
      })
      .catch(() => {
        if (!cancelled) {
          setDemoArea(null);
          setDemoAssignmentHomes(buildDemoAssignmentHomes(null, null));
          setDemoAreaResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, demoLive]);

  useEffect(() => {
    if (!demoLive || mapMode !== 'live') return;
    if (campaignId && !demoAreaResolved) return;
    if (demoAssignmentHomes.length === 0) return;

    const assignmentRounds = Math.max(...demoAssignmentHomes.map((home) => home.sequence + 1), 1);
    const duration = assignmentRounds * DEMO_HOME_VISIT_DURATION_MS;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDemoElapsedMs(duration);
      return;
    }

    setDemoElapsedMs(0);
    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      const elapsed = Math.min(duration, performance.now() - startedAt);
      setDemoElapsedMs(elapsed);
      if (elapsed >= duration) window.clearInterval(interval);
    }, DEMO_ANIMATION_FRAME_MS);
    return () => window.clearInterval(interval);
  }, [campaignId, demoAreaResolved, demoAssignmentHomes, demoLive, demoReplayKey, mapMode]);

  useEffect(() => {
    if (!demoLive || mapMode !== 'live' || demoAssignmentHomes.length === 0) return;
    setLivePresence(buildDemoLivePresence(demoElapsedMs, demoAssignmentHomes, demoArea));
  }, [demoArea, demoAssignmentHomes, demoElapsedMs, demoLive, mapMode]);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  useEffect(() => {
    if (mapMode !== 'live') {
      liveFitKeyRef.current = null;
    }
  }, [mapMode]);

  useEffect(() => {
    if (mapMode !== 'live' || demoLive) return;
    const intervalId = window.setInterval(() => {
      void fetchMapData();
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [demoLive, fetchMapData, mapMode]);

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;

    const initMap = async () => {
      if (!mapContainerRef.current || mapRef.current) return;
      const token = getMapboxToken();
      if (!token) {
        setError('Mapbox token not configured');
        return;
      }
      mapboxgl.accessToken = token;
      const mapInitOptions = await getResolvedMapInitOptions(resolvedMapStyle);
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        ...mapInitOptions,
        center: [-79.3832, 43.6532],
        zoom: 11,
      });
      map.on('load', () => setMapLoaded(true));
      mapRef.current = map;
    };

    void initMap();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [resolvedMapStyle]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    applyResolvedMapStyle(mapRef.current, resolvedMapStyle);
    mapRef.current.once('style.load', () => {
      if (!mapRef.current) return;
      applyPresetVisualTweaks(mapRef.current, resolvedMapStyle, {
        preserveLayerPrefixes: ['team-'],
      });
    });
  }, [mapLoaded, resolvedMapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !demoLive || !demoArea) return;
    const [minLng, minLat, maxLng, maxLat] = demoArea.bbox;
    const bounds = new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 0 });
  }, [demoArea, demoLive, mapLoaded]);

  // Routes layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const filteredSessions = memberIds.length === 0 ? sessions : sessions.filter((s) => memberIds.includes(s.user_id));
    const geo = buildRoutesGeoJSON(filteredSessions, members);
    const ensureRoutesLayer = () => {
      if (!map.isStyleLoaded()) return;
      try {
        const existing = map.getSource(ROUTES_SOURCE_ID);
        if (existing && 'setData' in existing) {
          (existing as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existing) {
          map.addSource(ROUTES_SOURCE_ID, { type: 'geojson', data: geo });
        }
        if (!map.getLayer(ROUTES_LAYER_ID)) {
          map.addLayer({
            id: ROUTES_LAYER_ID,
            type: 'line',
            source: ROUTES_SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 5,
              'line-opacity': 0.85,
            },
          });
        }
      } catch (e) {
        console.error('TeamMapTab routes layer:', e);
      }
    };
    if (map.isStyleLoaded()) {
      ensureRoutesLayer();
      const layer = map.getLayer(ROUTES_LAYER_ID);
      if (layer) map.setLayoutProperty(ROUTES_LAYER_ID, 'visibility', mapMode === 'routes' ? 'visible' : 'none');
    } else map.once('style.load', () => { ensureRoutesLayer(); const l = map.getLayer(ROUTES_LAYER_ID); if (l) map.setLayoutProperty(ROUTES_LAYER_ID, 'visibility', mapMode === 'routes' ? 'visible' : 'none'); });
  }, [mapLoaded, sessions, members, mapMode, memberIds]);

  // Knocked homes layer (points from activity payload)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (mapMode !== 'knocked_homes') {
      const layer = map.getLayer(KNOCKS_LAYER_ID);
      if (layer) map.setLayoutProperty(KNOCKS_LAYER_ID, 'visibility', 'none');
      return;
    }

    const memberMap = new Map(members.map((m) => [m.user_id, m]));
    const features: GeoJSON.Feature<GeoJSON.Point>[] = knockEvents.map((e, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        color: memberMap.get(e.user_id ?? '')?.color ?? '#3B82F6',
        display_name: e.display_name ?? 'Member',
      },
      geometry: {
        type: 'Point',
        coordinates: [e.payload!.lng!, e.payload!.lat!],
      },
    }));

    const geo: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features };

    const ensureKnocksLayer = () => {
      if (!map.isStyleLoaded()) return;
      try {
        const existing = map.getSource(KNOCKS_SOURCE_ID);
        if (existing && 'setData' in existing) {
          (existing as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existing) {
          map.addSource(KNOCKS_SOURCE_ID, { type: 'geojson', data: geo });
        }
        if (!map.getLayer(KNOCKS_LAYER_ID)) {
          map.addLayer({
            id: KNOCKS_LAYER_ID,
            type: 'circle',
            source: KNOCKS_SOURCE_ID,
            paint: {
              'circle-radius': 6,
              'circle-color': ['get', 'color'],
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });
        }
        const layer = map.getLayer(KNOCKS_LAYER_ID);
        if (layer) map.setLayoutProperty(KNOCKS_LAYER_ID, 'visibility', mapMode === 'knocked_homes' ? 'visible' : 'none');
      } catch (e) {
        console.error('TeamMapTab knocks layer:', e);
      }
    };

    if (map.isStyleLoaded()) ensureKnocksLayer();
    else map.once('style.load', ensureKnocksLayer);
  }, [mapLoaded, mapMode, knockEvents, members]);

  // Self-serve assignment demo: every home is assigned to a rep, then turns green on arrival.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const homesGeoJSON: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
      type: 'FeatureCollection',
      features: demoAssignmentHomes.map((home) => ({
        type: 'Feature',
        id: home.id,
        properties: {
          assignee_id: home.assigneeId,
          assignee_name: home.assigneeName,
          assignee_color: home.assigneeColor,
          sequence: home.sequence,
          completed: isDemoHomeComplete(home, demoElapsedMs),
        },
        geometry: home.geometry,
      })),
    };
    const routesGeoJSON = buildDemoAssignmentRoutes(demoAssignmentHomes);
    const visible = demoLive && mapMode === 'live' ? 'visible' : 'none';

    const ensureDemoAssignmentLayers = () => {
      try {
        const existingRoutes = map.getSource(DEMO_ASSIGNMENT_ROUTES_SOURCE_ID);
        if (existingRoutes && 'setData' in existingRoutes) {
          (existingRoutes as mapboxgl.GeoJSONSource).setData(routesGeoJSON);
        } else if (!existingRoutes) {
          map.addSource(DEMO_ASSIGNMENT_ROUTES_SOURCE_ID, { type: 'geojson', data: routesGeoJSON });
        }
        if (!map.getLayer(DEMO_ASSIGNMENT_ROUTES_LAYER_ID)) {
          map.addLayer({
            id: DEMO_ASSIGNMENT_ROUTES_LAYER_ID,
            type: 'line',
            source: DEMO_ASSIGNMENT_ROUTES_SOURCE_ID,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-opacity': 0.42,
              'line-dasharray': [2, 2],
            },
          });
        }

        const existingHomes = map.getSource(DEMO_ASSIGNMENT_HOMES_SOURCE_ID);
        if (existingHomes && 'setData' in existingHomes) {
          (existingHomes as mapboxgl.GeoJSONSource).setData(homesGeoJSON);
        } else if (!existingHomes) {
          map.addSource(DEMO_ASSIGNMENT_HOMES_SOURCE_ID, { type: 'geojson', data: homesGeoJSON });
        }
        if (!map.getLayer(DEMO_ASSIGNMENT_HOMES_FILL_LAYER_ID)) {
          map.addLayer({
            id: DEMO_ASSIGNMENT_HOMES_FILL_LAYER_ID,
            type: 'fill',
            source: DEMO_ASSIGNMENT_HOMES_SOURCE_ID,
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'completed'], true],
                DEMO_COMPLETED_COLOR,
                ['get', 'assignee_color'],
              ],
              'fill-opacity': [
                'case',
                ['==', ['get', 'completed'], true],
                0.88,
                0.2,
              ],
            },
          });
        }
        if (!map.getLayer(DEMO_ASSIGNMENT_HOMES_LINE_LAYER_ID)) {
          map.addLayer({
            id: DEMO_ASSIGNMENT_HOMES_LINE_LAYER_ID,
            type: 'line',
            source: DEMO_ASSIGNMENT_HOMES_SOURCE_ID,
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'completed'], true],
                '#15803D',
                ['get', 'assignee_color'],
              ],
              'line-width': ['case', ['==', ['get', 'completed'], true], 1.8, 1.2],
              'line-opacity': 0.95,
            },
          });
        }

        map.setLayoutProperty(DEMO_ASSIGNMENT_ROUTES_LAYER_ID, 'visibility', visible);
        map.setLayoutProperty(DEMO_ASSIGNMENT_HOMES_FILL_LAYER_ID, 'visibility', visible);
        map.setLayoutProperty(DEMO_ASSIGNMENT_HOMES_LINE_LAYER_ID, 'visibility', visible);
      } catch (error) {
        console.error('TeamMapTab demo assignment layers:', error);
      }
    };

    ensureDemoAssignmentLayers();
    map.once('idle', ensureDemoAssignmentLayers);
    return () => {
      map.off('idle', ensureDemoAssignmentLayers);
    };
  }, [demoAssignmentHomes, demoElapsedMs, demoLive, mapLoaded, mapMode]);

  // Live agent puck layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const features: GeoJSON.Feature<GeoJSON.Point>[] = livePresence.map((row) => ({
      type: 'Feature',
      id: row.user_id,
      properties: {
        user_id: row.user_id,
        display_name: row.display_name,
        campaign_name: row.campaign_name,
        color: row.color,
        status: row.status,
        updated_at: row.updated_at,
        started_at: row.started_at,
        active_seconds: row.active_seconds,
        distance_meters: row.distance_meters,
        doors_hit: row.doors_hit,
        conversations: row.conversations,
        flyers_delivered: row.flyers_delivered,
      },
      geometry: {
        type: 'Point',
        coordinates: [row.lng, row.lat],
      },
    }));

    const geo: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features };
    const ensureLiveLayer = () => {
      try {
        const existing = map.getSource(LIVE_SOURCE_ID);
        if (existing && 'setData' in existing) {
          (existing as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existing) {
          map.addSource(LIVE_SOURCE_ID, { type: 'geojson', data: geo });
        }
        if (!map.getLayer(LIVE_LAYER_ID)) {
          map.addLayer({
            id: LIVE_LAYER_ID,
            type: 'circle',
            source: LIVE_SOURCE_ID,
            paint: {
              'circle-radius': ['case', ['==', ['get', 'status'], 'paused'], 8, 10],
              'circle-color': ['get', 'color'],
              'circle-opacity': ['case', ['==', ['get', 'status'], 'paused'], 0.58, 0.95],
              'circle-stroke-width': 3,
              'circle-stroke-color': '#FFFFFF',
            },
          });
        }
        if (!map.getLayer(LIVE_LABEL_LAYER_ID)) {
          map.addLayer({
            id: LIVE_LABEL_LAYER_ID,
            type: 'symbol',
            source: LIVE_SOURCE_ID,
            layout: {
              'text-field': ['get', 'display_name'],
              'text-size': 12,
              'text-offset': [0, 1.45],
              'text-anchor': 'top',
              'text-allow-overlap': demoLive,
              'text-ignore-placement': demoLive,
            },
            paint: {
              'text-color': '#111827',
              'text-halo-color': '#FFFFFF',
              'text-halo-width': 1.4,
            },
          });
        }
        const liveVisibility = mapMode === 'live' ? 'visible' : 'none';
        map.setLayoutProperty(LIVE_LAYER_ID, 'visibility', liveVisibility);
        map.setLayoutProperty(LIVE_LABEL_LAYER_ID, 'visibility', liveVisibility);
      } catch (e) {
        console.error('TeamMapTab live layer:', e);
      }
    };

    // Mapbox GL JS v3: isStyleLoaded() is unreliable immediately after the load
    // event. Try immediately (works if style is ready), then retry on idle as
    // a guaranteed fallback once all tiles and style resources have settled.
    ensureLiveLayer();
    map.once('idle', ensureLiveLayer);

    return () => {
      map.off('idle', ensureLiveLayer);
    };
  }, [demoLive, livePresence, mapLoaded, mapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapMode !== 'live' || livePresence.length === 0) return;
    const fitKey = livePresence
      .map((row) => row.user_id)
      .sort()
      .join(',');
    if (liveFitKeyRef.current === fitKey) return;
    liveFitKeyRef.current = fitKey;
    const bounds = new mapboxgl.LngLatBounds();
    livePresence.forEach((row) => bounds.extend([row.lng, row.lat]));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 72, maxZoom: 15, duration: 600 });
    }
  }, [livePresence, mapLoaded, mapMode]);

  // Route click popup
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapMode !== 'routes') return;

    const onRouteClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f?.properties) return;
      popupRef.current?.remove();
      const props = f.properties as Record<string, unknown>;
      const doors = props.doors_hit ?? '—';
      const convos = props.conversations ?? '—';
      const flyers = props.flyers_delivered ?? '—';
      const duration = typeof props.duration_seconds === 'number' ? `${Math.round(props.duration_seconds / 60)} min` : '—';

      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="p-2 min-w-[160px]">
            <p class="font-semibold text-sm">${escapeHtml(String(props.display_name ?? 'Member'))}</p>
            <p class="text-xs text-gray-500 mt-1">Duration: ${escapeHtml(String(duration))}</p>
            <p class="text-xs">Doors: ${escapeHtml(String(doors))} · Convos: ${escapeHtml(String(convos))} · Flyers: ${escapeHtml(String(flyers))}</p>
          </div>`
        )
        .addTo(map);
    };

    map.on('click', ROUTES_LAYER_ID, onRouteClick);
    return () => {
      map.off('click', ROUTES_LAYER_ID, onRouteClick);
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [mapLoaded, mapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mapMode !== 'live') return;

    const onLiveClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f?.properties) return;
      popupRef.current?.remove();
      const props = f.properties as Record<string, unknown>;
      const doors = Number(props.doors_hit ?? 0) || 0;
      const convos = Number(props.conversations ?? 0) || 0;
      const flyers = Number(props.flyers_delivered ?? 0) || 0;
      const distance = `${((Number(props.distance_meters ?? 0) || 0) / 1000).toFixed(2)} km`;
      const elapsed = formatLiveDuration(props.started_at, props.active_seconds);
      const updated = formatRelativeUpdate(props.updated_at);

      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="p-2 min-w-[190px]">
            <p class="font-semibold text-sm">${escapeHtml(String(props.display_name ?? 'Member'))}</p>
            <p class="text-xs text-gray-500 mt-1">${escapeHtml(String(props.campaign_name ?? 'Campaign'))}</p>
            <p class="text-xs text-gray-500">${escapeHtml(updated)} · ${escapeHtml(String(props.status ?? 'active'))}</p>
            <p class="text-xs mt-2">Doors: ${doors} · Convos: ${convos} · Flyers: ${flyers}</p>
            <p class="text-xs">Time: ${escapeHtml(elapsed)} · Distance: ${escapeHtml(distance)}</p>
          </div>`
        )
        .addTo(map);
    };

    map.on('click', LIVE_LAYER_ID, onLiveClick);
    return () => {
      map.off('click', LIVE_LAYER_ID, onLiveClick);
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [mapLoaded, mapMode]);

  const completedDemoHomeCount = demoAssignmentHomes.filter((home) =>
    isDemoHomeComplete(home, demoElapsedMs),
  ).length;
  const demoAssignmentComplete =
    demoAssignmentHomes.length > 0 && completedDemoHomeCount >= demoAssignmentHomes.length;
  const demoProgressPercent =
    demoAssignmentHomes.length > 0
      ? Math.round((completedDemoHomeCount / demoAssignmentHomes.length) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="relative rounded-xl border border-border overflow-hidden bg-card" style={{ minHeight: 400 }}>
        <div ref={mapContainerRef} className="w-full h-[420px]" />
        {loading && (
          <div className="absolute top-4 left-4 z-10 bg-background/80 px-3 py-1.5 rounded text-sm shadow">
            Loading…
          </div>
        )}
        {demoLive && mapMode === 'live' && demoAssignmentHomes.length > 0 ? (
          <div className="absolute bottom-4 left-4 z-10 w-[min(22rem,calc(100%-2rem))] rounded-xl border border-white/70 bg-background/95 p-3 shadow-xl backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Live assignments · 4 reps
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground" aria-live="polite">
                  {demoAssignmentComplete
                    ? 'Every assigned home completed'
                    : `${completedDemoHomeCount} of ${demoAssignmentHomes.length} homes completed`}
                </p>
              </div>
              {demoAssignmentComplete ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm hover:bg-muted"
                  onClick={() => setDemoReplayKey((current) => current + 1)}
                >
                  Replay
                </button>
              ) : (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {demoProgressPercent}%
                </span>
              )}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                style={{ width: `${demoProgressPercent}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
              {DEMO_LIVE_MEMBERS.map((member) => {
                const assigned = demoAssignmentHomes.filter((home) => home.assigneeId === member.user_id).length;
                const completed = completedDemoHomesForMember(demoAssignmentHomes, member.user_id, demoElapsedMs);
                return (
                  <span key={member.user_id} className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: member.color }} />
                    {member.display_name} {completed}/{assigned}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {mapMode === 'knocked_homes' && knockEvents.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No knock locations with coordinates in this period.</p>
      )}
      {mapMode === 'live' && livePresence.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No agents are actively reporting location right now.</p>
      )}
    </div>
  );
}

function formatLiveDuration(startedAt: unknown, activeSeconds: unknown): string {
  const active = Number(activeSeconds ?? 0) || 0;
  const started =
    typeof startedAt === 'string' && startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : 0;
  const seconds = Math.max(active, started);
  if (seconds <= 0) return '0 min';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)} min`;
}

function formatRelativeUpdate(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'No update time';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes}m ago`;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function parseLineString(raw: string | null | undefined): GeoJSON.LineString | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as GeoJSON.Geometry;
    if (parsed?.type === 'LineString' && Array.isArray(parsed.coordinates)) {
      return parsed as GeoJSON.LineString;
    }
    return null;
  } catch {
    return null;
  }
}
