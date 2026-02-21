'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { getMapboxToken } from '@/lib/mapbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MapPin,
  ChevronDown,
  ChevronUp,
  Home,
  Save,
  Loader2,
} from 'lucide-react';

interface OptimizedRouteViewProps {
  campaignId: string;
  campaignName?: string;
  addresses: Array<{
    id: string;
    formatted?: string;
    house_number?: string;
    street_number?: string | number;
    street_name?: string;
    gers_id?: string;
    building_id?: string;
    geom?: { coordinates: [number, number] } | string;
    geom_json?: { coordinates?: [number, number] };
    coordinate?: { lat: number; lon: number };
    cluster_id?: number;
    sequence?: number;
    seq?: number;
    walk_time_sec?: number;
    distance_m?: number;
  }>;
}

type SegmentSide = 'odd' | 'even' | 'unknown';

type StreetSegmentApi = {
  segmentId: string;
  streetKey: string;
  streetLabel: string;
  side: SegmentSide;
  homeIds: string[];
  homes: Array<{
    id: string;
    fullAddress: string;
    houseNumber: string;
    lat: number;
    lng: number;
  }>;
  startHomeId: string;
  endHomeId: string;
  count: number;
};

type RouteMember = {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  fullName: string | null;
  email: string | null;
};

type FlatRouteAddress = {
  id: string;
  segmentId: string;
  formatted: string;
  house_number: string;
  street_name: string;
  lat: number;
  lon: number;
  gers_id?: string;
  building_id?: string;
};

type AgentSweepGroup = {
  agentIndex: number;
  segments: StreetSegmentApi[];
  stops: FlatRouteAddress[];
  totalStops: number;
};

const COLORS = [
  '#ef4444',
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#d946ef',
];

const UNKNOWN_COLOR = '#94a3b8';
const ROUTE_POINT_COLOR = '#ef4444';

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

function displayMemberName(member: RouteMember): string {
  if (member.fullName && member.fullName.trim().length > 0) return member.fullName;
  if (member.email && member.email.trim().length > 0) return member.email;
  return member.userId.slice(0, 8);
}

function sideLabel(side: SegmentSide): string {
  if (side === 'odd') return 'Odd';
  if (side === 'even') return 'Even';
  return 'Unknown';
}

function sideToRoutePlanSide(side: SegmentSide): 'odds' | 'evens' | 'both' {
  if (side === 'odd') return 'odds';
  if (side === 'even') return 'evens';
  return 'both';
}

function parseHouseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(Math.trunc(value));
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function houseRange(homes: StreetSegmentApi['homes']): string {
  const values = homes
    .map((home) => parseHouseNumber(home.houseNumber))
    .filter((n): n is number => typeof n === 'number');

  if (values.length === 0) return `${homes.length} homes`;
  if (values.length === 1) return String(values[0]);
  return `${Math.min(...values)}-${Math.max(...values)}`;
}

function isValidCoord(lat: number | undefined, lon: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lon) &&
    lat !== 0 &&
    lon !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function splitSegmentsByAgentCount(
  segments: StreetSegmentApi[],
  requestedAgentCount: number
): StreetSegmentApi[][] {
  if (segments.length === 0) return [];

  const withCentroids = segments.map((segment) => {
    const count = Math.max(1, segment.homes.length);
    const sum = segment.homes.reduce(
      (acc, home) => {
        acc.lat += home.lat;
        acc.lng += home.lng;
        return acc;
      },
      { lat: 0, lng: 0 }
    );
    return {
      segment,
      centroidLat: sum.lat / count,
      centroidLng: sum.lng / count,
    };
  });

  const latValues = withCentroids.map((item) => item.centroidLat);
  const lngValues = withCentroids.map((item) => item.centroidLng);
  const latSpan = Math.max(...latValues) - Math.min(...latValues);
  const lngSpan = Math.max(...lngValues) - Math.min(...lngValues);
  const horizontalSweep = lngSpan >= latSpan;

  const orderedSegments = [...withCentroids]
    .sort((a, b) => {
      if (horizontalSweep) {
        if (a.centroidLng !== b.centroidLng) return a.centroidLng - b.centroidLng;
        return b.centroidLat - a.centroidLat;
      }
      if (a.centroidLat !== b.centroidLat) return b.centroidLat - a.centroidLat;
      return a.centroidLng - b.centroidLng;
    })
    .map((item) => item.segment);

  const safeAgentCount = Math.max(1, Math.min(Math.floor(requestedAgentCount) || 1, orderedSegments.length));
  const baseSize = Math.floor(orderedSegments.length / safeAgentCount);
  const remainder = orderedSegments.length % safeAgentCount;

  const groups: StreetSegmentApi[][] = [];
  let cursor = 0;

  for (let idx = 0; idx < safeAgentCount; idx += 1) {
    const groupSize = baseSize + (idx < remainder ? 1 : 0);
    const nextCursor = cursor + groupSize;
    const slice = orderedSegments.slice(cursor, nextCursor);
    if (slice.length > 0) {
      groups.push(slice);
    }
    cursor = nextCursor;
  }

  return groups;
}

function getAddressCoords(addr: {
  geom?: { coordinates?: [number, number] } | string;
  geom_json?: { coordinates?: [number, number] };
  coordinate?: { lat: number; lon: number };
}): { lat: number; lon: number } | null {
  const fromCoords = (coords: [number, number] | undefined) => {
    if (!coords || coords.length < 2) return null;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    return isValidCoord(lat, lon) ? { lat, lon } : null;
  };

  if (addr.geom_json?.coordinates) return fromCoords(addr.geom_json.coordinates);

  const g = addr.geom;
  if (g && typeof g === 'object') {
    const withCoords = g as { coordinates?: [number, number] };
    if (Array.isArray(withCoords.coordinates)) {
      return fromCoords(withCoords.coordinates);
    }
  }

  if (typeof g === 'string') {
    try {
      const parsed = JSON.parse(g) as { coordinates?: [number, number] };
      return fromCoords(parsed?.coordinates);
    } catch {
      // no-op
    }
  }

  const c = addr.coordinate;
  if (c && isValidCoord(c.lat, c.lon)) {
    return { lat: c.lat, lon: c.lon };
  }

  return null;
}

export function OptimizedRouteView({ campaignId, campaignName, addresses }: OptimizedRouteViewProps) {
  const { theme } = useTheme();
  const { currentWorkspace, membershipsByWorkspaceId } = useWorkspace();

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const drawRouteRef = useRef<(m: mapboxgl.Map) => void>(() => {});
  const [mapError, setMapError] = useState<string | null>(null);

  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);
  const [streetSegments, setStreetSegments] = useState<StreetSegmentApi[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);

  const [members, setMembers] = useState<RouteMember[]>([]);
  const [agentCount, setAgentCount] = useState(1);
  const [splitReady, setSplitReady] = useState(false);
  const [agentAssignments, setAgentAssignments] = useState<Record<number, string>>({});
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canCreateRoutePlans =
    currentRole === 'owner' || currentRole === 'admin' || currentRole === 'member';
  const canAssignRoutePlans = currentRole === 'owner' || currentRole === 'admin';
  const routePlanBaseName = useMemo(() => {
    const base = campaignName?.trim();
    return base && base.length > 0 ? base : 'Campaign';
  }, [campaignName]);

  useEffect(() => {
    if (addresses.length === 0) {
      setStreetSegments([]);
      setSegmentsError(null);
      setSegmentsLoading(false);
      return;
    }

    let mounted = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort('segments-timeout'), 6000);
    setStreetSegments([]);
    setSegmentsLoading(true);
    setSegmentsError(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/campaigns/${campaignId}/routes/segments`,
          { credentials: 'include', signal: controller.signal }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'Failed to load street segments');
        }

        const payload = (await response.json()) as { segments?: StreetSegmentApi[] };
        const incoming = Array.isArray(payload.segments) ? payload.segments : [];

        if (!mounted) return;
        setStreetSegments(incoming);
      } catch (error) {
        if (!mounted) return;
        setStreetSegments([]);
        const message = error instanceof Error ? error.message : 'Failed to load street segments';
        if (error instanceof DOMException && error.name === 'AbortError') {
          setSegmentsError('Street segment lookup timed out.');
        } else {
          setSegmentsError(message);
        }
      } finally {
        clearTimeout(timeoutId);
        if (mounted) setSegmentsLoading(false);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [campaignId, addresses]);

  const addressMetaById = useMemo(() => {
    const mapById = new Map<string, {
      formatted: string;
      house_number: string;
      street_name: string;
      lat: number | null;
      lon: number | null;
      gers_id?: string;
      building_id?: string;
    }>();

    for (const address of addresses) {
      const coords = getAddressCoords(address);
      mapById.set(address.id, {
        formatted: address.formatted ?? '',
        house_number:
          address.house_number ??
          (address.street_number === undefined || address.street_number === null
            ? ''
            : String(address.street_number)),
        street_name: address.street_name ?? '',
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        gers_id: address.gers_id,
        building_id: address.building_id,
      });
    }

    return mapById;
  }, [addresses]);

  const segmentColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();
    let colorIdx = 0;

    streetSegments.forEach((segment) => {
      if (segment.side === 'unknown') {
        colorMap.set(segment.segmentId, UNKNOWN_COLOR);
      } else {
        colorMap.set(segment.segmentId, COLORS[colorIdx % COLORS.length]);
        colorIdx += 1;
      }
    });

    return colorMap;
  }, [streetSegments]);

  const orderedAddresses = useMemo((): FlatRouteAddress[] => {
    const flattened: FlatRouteAddress[] = [];

    streetSegments.forEach((segment) => {
      const homeById = new Map(segment.homes.map((home) => [home.id, home]));
      const orderedHomes = segment.homeIds
        .map((id) => homeById.get(id))
        .filter((home): home is StreetSegmentApi['homes'][number] => !!home);

      orderedHomes.forEach((home) => {
        const meta = addressMetaById.get(home.id);
        const lat = home.lat ?? meta?.lat ?? null;
        const lon = home.lng ?? meta?.lon ?? null;
        if (!isValidCoord(lat ?? undefined, lon ?? undefined)) return;

        flattened.push({
          id: home.id,
          segmentId: segment.segmentId,
          formatted: home.fullAddress || meta?.formatted || '',
          house_number: home.houseNumber || meta?.house_number || '',
          street_name: meta?.street_name || segment.streetLabel,
          lat: lat as number,
          lon: lon as number,
          gers_id: meta?.gers_id,
          building_id: meta?.building_id,
        });
      });
    });

    return flattened;
  }, [streetSegments, addressMetaById]);

  const mapAddresses = useMemo((): FlatRouteAddress[] => orderedAddresses, [orderedAddresses]);

  const stopAddressesBySegmentId = useMemo(() => {
    const mapBySegment = new Map<string, FlatRouteAddress[]>();
    orderedAddresses.forEach((address) => {
      const list = mapBySegment.get(address.segmentId);
      if (list) {
        list.push(address);
      } else {
        mapBySegment.set(address.segmentId, [address]);
      }
    });
    return mapBySegment;
  }, [orderedAddresses]);

  const agentSweepGroups = useMemo<AgentSweepGroup[]>(() => {
    const segmentGroups = splitSegmentsByAgentCount(streetSegments, agentCount);
    return segmentGroups.map((segments, idx) => {
      const stops: FlatRouteAddress[] = [];
      segments.forEach((segment) => {
        stops.push(...(stopAddressesBySegmentId.get(segment.segmentId) ?? []));
      });
      return {
        agentIndex: idx + 1,
        segments,
        stops,
        totalStops: stops.length,
      };
    });
  }, [streetSegments, agentCount, stopAddressesBySegmentId]);

  const estimatedMinutes = useMemo(() => {
    const totalSeconds = addresses.reduce((sum, addr) => sum + (addr.walk_time_sec ?? 0), 0);
    if (totalSeconds > 0) {
      return Math.max(1, Math.round(totalSeconds / 60));
    }
    return Math.max(1, Math.round(orderedAddresses.length * 1.5));
  }, [addresses, orderedAddresses.length]);

  const estimatedDistanceMeters = useMemo(() => {
    const totalMeters = addresses.reduce((sum, addr) => sum + (addr.distance_m ?? 0), 0);
    return totalMeters > 0 ? Math.round(totalMeters) : null;
  }, [addresses]);

  useEffect(() => {
    const maxCount = Math.max(1, streetSegments.length);
    setAgentCount((prev) => Math.min(Math.max(1, prev), maxCount));
  }, [streetSegments.length]);

  useEffect(() => {
    setSplitReady(false);
  }, [agentCount, streetSegments.length, campaignId]);

  useEffect(() => {
    setAgentAssignments((previous) => {
      const next: Record<number, string> = {};
      agentSweepGroups.forEach((group) => {
        next[group.agentIndex] = previous[group.agentIndex] ?? 'none';
      });
      return next;
    });
  }, [agentSweepGroups]);

  useEffect(() => {
    if (!canAssignRoutePlans || !currentWorkspaceId) {
      setMembers([]);
      return;
    }

    let mounted = true;
    const supabase = createClient();

    (async () => {
      const { data: memberRows, error: memberError } = await supabase
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', currentWorkspaceId);

      if (memberError || !mounted) return;
      const rows = (memberRows ?? []) as Array<{ user_id: string; role: 'owner' | 'admin' | 'member' }>;
      const userIds = Array.from(new Set(rows.map((row) => row.user_id)));

      let profileMap = new Map<string, { full_name: string | null; email: string | null }>();
      if (userIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);

        if (mounted && profileRows) {
          profileMap = new Map(
            profileRows.map((profile) => [
              profile.id as string,
              {
                full_name: (profile as { full_name?: string | null }).full_name ?? null,
                email: (profile as { email?: string | null }).email ?? null,
              },
            ])
          );
        }
      }

      if (!mounted) return;
      const ordered = rows
        .map((row) => {
          const profile = profileMap.get(row.user_id);
          return {
            userId: row.user_id,
            role: row.role,
            fullName: profile?.full_name ?? null,
            email: profile?.email ?? null,
          } satisfies RouteMember;
        })
        .sort((a, b) => {
          const rank = (role: RouteMember['role']) => (role === 'owner' ? 0 : role === 'admin' ? 1 : 2);
          const roleDelta = rank(a.role) - rank(b.role);
          if (roleDelta !== 0) return roleDelta;
          return displayMemberName(a).localeCompare(displayMemberName(b));
        });
      setMembers(ordered);
    })();

    return () => {
      mounted = false;
    };
  }, [canAssignRoutePlans, currentWorkspaceId]);

  const handleSaveRoutePlan = useCallback(async () => {
    if (!canCreateRoutePlans) {
      setSaveError('Only workspace members can create route plans.');
      return;
    }
    if (!currentWorkspaceId) {
      setSaveError('No workspace selected.');
      return;
    }
    if (!splitReady) {
      setSaveError('Split the campaign first.');
      return;
    }
    if (streetSegments.length === 0 || orderedAddresses.length === 0 || agentSweepGroups.length === 0) {
      setSaveError('No route data available to save.');
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setIsSavingPlan(true);

    let createdCount = 0;
    let assignedCount = 0;

    try {
      for (const group of agentSweepGroups) {
        if (group.segments.length === 0 || group.totalStops === 0) continue;

        const segmentsPayload = group.segments.map((segment) => {
          const numbers = segment.homes
            .map((home) => parseHouseNumber(home.houseNumber))
            .filter((n): n is number => typeof n === 'number');

          const fromHouse = numbers.length > 0 ? Math.min(...numbers) : null;
          const toHouse = numbers.length > 0 ? Math.max(...numbers) : null;

          return {
            street_name: segment.streetLabel,
            side: sideToRoutePlanSide(segment.side),
            from_house: fromHouse,
            to_house: toHouse,
            stop_count: segment.count,
            color: segmentColorMap.get(segment.segmentId) ?? '#ef4444',
            line_geojson: null,
            notes: segment.side === 'unknown' ? 'Homes with unparseable house numbers' : null,
          };
        });

        const stopsPayload = group.stops.map((address, index) => ({
          stop_order: index + 1,
          address_id: address.id,
          gers_id: address.gers_id ?? null,
          lat: address.lat,
          lng: address.lon,
          display_address:
            address.formatted && address.formatted.trim().length > 0
              ? address.formatted
              : `${address.house_number || ''} ${address.street_name || ''}`.trim() || 'Unknown address',
          building_id: address.building_id ?? null,
        }));

        const planName =
          `${routePlanBaseName} : Route ${group.agentIndex}`;

        const proportionalMinutes = Math.max(
          1,
          Math.round((estimatedMinutes * group.totalStops) / Math.max(1, orderedAddresses.length))
        );
        const proportionalDistance =
          typeof estimatedDistanceMeters === 'number'
            ? Math.round((estimatedDistanceMeters * group.totalStops) / Math.max(1, orderedAddresses.length))
            : null;

        const createResponse = await fetch('/api/routes/create_from_segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            campaignId,
            name: planName,
            status: 'active',
            estMinutes: proportionalMinutes,
            distanceMeters: proportionalDistance,
            segments: segmentsPayload,
            stops: stopsPayload,
          }),
        });

        const createPayload = (await createResponse.json().catch(() => null)) as
          | { routePlan?: { id: string }; error?: string }
          | null;

        if (!createResponse.ok || !createPayload?.routePlan?.id) {
          throw new Error(
            createPayload?.error ?? `Failed to save route plan for agent ${group.agentIndex}.`
          );
        }

        createdCount += 1;
        const assignedToUserId = agentAssignments[group.agentIndex] ?? 'none';

        if (canAssignRoutePlans && assignedToUserId !== 'none') {
          const assignResponse = await fetch('/api/routes/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              routePlanId: createPayload.routePlan.id,
              assignedToUserId,
            }),
          });
          const assignPayload = (await assignResponse.json().catch(() => null)) as
            | { error?: string }
            | null;

          if (!assignResponse.ok) {
            throw new Error(
              assignPayload?.error ?? `Route saved, but assignment failed for agent ${group.agentIndex}.`
            );
          }
          assignedCount += 1;
        }
      }

      if (createdCount === 0) {
        setSaveError('No route data available to save.');
        return;
      }

      const routeLabel = createdCount === 1 ? 'route' : 'routes';
      if (assignedCount > 0) {
        const assignmentLabel = assignedCount === 1 ? 'assignment' : 'assignments';
        setSaveSuccess(`${createdCount} ${routeLabel} saved. ${assignedCount} ${assignmentLabel} applied.`);
      } else {
        setSaveSuccess(`${createdCount} ${routeLabel} saved.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save routes.';
      setSaveError(
        createdCount > 0
          ? `Saved ${createdCount} route(s), then failed: ${message}`
          : message
      );
    } finally {
      setIsSavingPlan(false);
    }
  }, [
    canAssignRoutePlans,
    canCreateRoutePlans,
    currentWorkspaceId,
    splitReady,
    routePlanBaseName,
    streetSegments.length,
    orderedAddresses.length,
    agentSweepGroups,
    agentAssignments,
    segmentColorMap,
    campaignId,
    estimatedMinutes,
    estimatedDistanceMeters,
  ]);

  const drawRoute = useCallback((m: mapboxgl.Map) => {
    ['route-point-seq', 'route-points', 'route-line', 'route-line-glow'].forEach((layerId) => {
      if (m.getLayer(layerId)) m.removeLayer(layerId);
    });
    if (m.getSource('route-line-source')) m.removeSource('route-line-source');
    if (m.getSource('route-points-source')) m.removeSource('route-points-source');

    if (mapAddresses.length === 0) return;

    const segmentCounters = new Map<string, number>();
    const pointFeatures: GeoJSON.Feature[] = mapAddresses.map((address) => {
      const next = (segmentCounters.get(address.segmentId) ?? 0) + 1;
      segmentCounters.set(address.segmentId, next);

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [address.lon, address.lat],
        },
        properties: {
          color: segmentColorMap.get(address.segmentId) ?? ROUTE_POINT_COLOR,
          sequence: next,
        },
      };
    });

    m.addSource('route-points-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: pointFeatures,
      },
    });

    m.addLayer({
      id: 'route-points',
      type: 'circle',
      source: 'route-points-source',
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.95,
        'circle-stroke-width': 0,
        'circle-stroke-color': ['get', 'color'],
      },
    });

    m.addLayer({
      id: 'route-point-seq',
      type: 'symbol',
      source: 'route-points-source',
      layout: {
        'text-field': ['to-string', ['get', 'sequence']],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#111827',
        'text-halo-width': 0.8,
      },
    });

    const bounds = new mapboxgl.LngLatBounds();
    mapAddresses.forEach((address) => bounds.extend([address.lon, address.lat]));
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 600 });
    }
  }, [mapAddresses, segmentColorMap]);

  useEffect(() => {
    drawRouteRef.current = drawRoute;
  }, [drawRoute]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const token = getMapboxToken();
    if (!token || !token.startsWith('pk.')) {
      setMapError('Map token is missing or invalid.');
      return;
    }
    mapboxgl.accessToken = token;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[theme] ?? MAP_STYLES.light,
      center: [-79.3832, 43.6532],
      zoom: 12,
    });

    m.on('load', () => {
      setMapError(null);
      setTimeout(() => {
        try {
          m.resize();
        } catch {}
      }, 30);
    });

    m.on('style.load', () => {
      setMapError(null);
      drawRouteRef.current(m);
    });

    m.on('error', (event) => {
      const message = event.error?.message ?? 'Failed to load map.';
      if (message.includes('does not exist on source')) return;
      setMapError(message);
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
  }, [theme, streetSegments.length]);

  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(MAP_STYLES[theme] ?? MAP_STYLES.light);
  }, [theme]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    drawRoute(map.current);
  }, [drawRoute]);

  useEffect(() => {
    if (!map.current) return;
    const frameId = requestAnimationFrame(() => {
      try {
        map.current?.resize();
        if (map.current?.isStyleLoaded()) {
          drawRoute(map.current);
        }
      } catch {
        // Ignore transient resize errors during style transitions.
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [streetSegments.length, mapAddresses.length, drawRoute]);

  const handleSplitCampaign = useCallback(() => {
    if (streetSegments.length === 0) {
      setSaveError('No segment data available to split.');
      return;
    }
    setSaveError(null);
    setSaveSuccess(null);
    setSplitReady(true);
  }, [streetSegments.length]);

  if (segmentsLoading && streetSegments.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center py-8">
          <Loader2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 animate-spin" />
          <h3 className="text-lg font-semibold mb-1">Building street segments</h3>
          <p className="text-sm text-muted-foreground">Loading odd/even home lists for this territory.</p>
        </CardContent>
      </Card>
    );
  }

  if (streetSegments.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center py-8">
          <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No segment data yet</h3>
          <p className="text-sm text-muted-foreground">
            Segments are generated during campaign creation/provisioning.
            Re-run provisioning for this campaign to generate the route list.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{streetSegments.length} street-side segments</span>
        <span>{orderedAddresses.length} homes</span>
      </div>

      {segmentsError ? (
        <Card className="border-yellow-500/40">
          <CardContent className="py-3 text-sm text-yellow-600 dark:text-yellow-400">
            Segment API fallback active: {segmentsError}
          </CardContent>
        </Card>
      ) : null}

      {canCreateRoutePlans ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Split Campaign Routes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
              <div>
                <Label htmlFor="route-agent-count">
                  {canAssignRoutePlans ? 'Number of agents' : 'Number of route groups'}
                </Label>
                <Input
                  id="route-agent-count"
                  type="number"
                  min={1}
                  max={Math.max(1, streetSegments.length)}
                  value={agentCount}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    if (!Number.isFinite(parsed)) return;
                    const clamped = Math.max(1, Math.min(parsed, Math.max(1, streetSegments.length)));
                    setAgentCount(clamped);
                  }}
                  className="mt-1"
                  disabled={isSavingPlan}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Saved names will be: <span className="font-medium text-foreground">{routePlanBaseName} : Route 1</span>,
                <span className="font-medium text-foreground"> Route 2</span>, ...
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSplitCampaign}
                disabled={isSavingPlan || streetSegments.length === 0}
              >
                Split Campaign
              </Button>
            </div>

            {splitReady ? (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3">
                {agentSweepGroups.map((group) => {
                  const first = group.segments[0];
                  const last = group.segments[group.segments.length - 1];
                  return (
                    <div
                      key={`agent-group-${group.agentIndex}`}
                      className={canAssignRoutePlans ? 'grid gap-2 md:grid-cols-[1fr_260px]' : 'grid gap-2'}
                    >
                      <div className="text-xs">
                        <p className="font-medium text-foreground">
                          {canAssignRoutePlans ? 'Agent' : 'Route'} {group.agentIndex}: {group.segments.length}{' '}
                          street sides • {group.totalStops} homes
                        </p>
                        <p className="text-muted-foreground">
                          Sweep: {first?.streetLabel} ({sideLabel(first?.side ?? 'unknown')}) to {last?.streetLabel} (
                          {sideLabel(last?.side ?? 'unknown')})
                        </p>
                      </div>
                      {canAssignRoutePlans ? (
                        <div>
                          <Label htmlFor={`route-agent-assign-${group.agentIndex}`} className="text-xs">
                            Assign member (optional)
                          </Label>
                          <Select
                            value={agentAssignments[group.agentIndex] ?? 'none'}
                            onValueChange={(value) =>
                              setAgentAssignments((previous) => ({
                                ...previous,
                                [group.agentIndex]: value,
                              }))
                            }
                            disabled={isSavingPlan}
                          >
                            <SelectTrigger id={`route-agent-assign-${group.agentIndex}`} className="mt-1 h-8">
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unassigned</SelectItem>
                              {members.map((member) => (
                                <SelectItem key={`${group.agentIndex}-${member.userId}`} value={member.userId}>
                                  {displayMemberName(member)} ({member.role})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!canAssignRoutePlans ? (
                  <p className="text-xs text-muted-foreground">
                    Personal mode: these grouped walking routes are saved under your account.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">Split Campaign</span> to generate Route 1, Route 2,
                and grouped home lists before saving.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {splitReady ? `${agentSweepGroups.length} grouped route plan(s)` : 'Not split yet'} •{' '}
                {orderedAddresses.length} stops • ~{estimatedMinutes} min
                {estimatedDistanceMeters ? ` • ${(estimatedDistanceMeters / 1000).toFixed(1)} km` : ''}
              </div>
              <Button onClick={() => void handleSaveRoutePlan()} disabled={!splitReady || isSavingPlan}>
                {isSavingPlan ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Routes
              </Button>
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            {saveSuccess ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveSuccess}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="relative h-[560px] w-full rounded-lg border bg-card shadow-sm overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        {mapError ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 p-4 text-center text-sm text-white">
            {mapError}
          </div>
        ) : null}
        {!mapError && mapAddresses.length === 0 ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 p-4 text-center text-sm text-white">
            No mappable route coordinates found for this campaign.
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        {streetSegments.map((segment) => {
          const expanded = expandedStreet === segment.segmentId;
          const color = segmentColorMap.get(segment.segmentId) ?? '#ef4444';

          return (
            <Card
              key={segment.segmentId}
              className={`cursor-pointer transition-all hover:shadow-md ${
                expanded ? 'ring-2 ring-primary' : ''
              }`}
            >
              <CardHeader
                className="p-3 pb-2"
                onClick={() => setExpandedStreet(expanded ? null : segment.segmentId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        {segment.streetLabel} — {sideLabel(segment.side)}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">Homes {houseRange(segment.homes)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Home className="w-3 h-3" />
                      {segment.count}
                    </Badge>
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CardHeader>

              {expanded ? (
                <CardContent className="p-3 pt-0">
                  <div className="border-t pt-3 mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Homes in segment order:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {segment.homes.map((home) => (
                        <div key={home.id} className="flex items-center gap-2 text-xs p-2 bg-muted rounded">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                            aria-hidden
                          />
                          <span className="truncate" title={home.fullAddress || undefined}>
                            {home.fullAddress || `${home.houseNumber} ${segment.streetLabel}`.trim()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
