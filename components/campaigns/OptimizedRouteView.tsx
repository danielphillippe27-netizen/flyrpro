'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken } from '@/lib/mapbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, ChevronDown, ChevronUp, Home, Save, Loader2 } from 'lucide-react';

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
  onAddressesUpdate?: (addresses: OptimizedRouteViewProps['addresses']) => void;
}

interface RouteAddress {
  id: string;
  sequence: number;
  formatted: string;
  house_number: string;
  street_number?: string | number;
  street_name: string;
  lat: number;
  lon: number;
  gers_id?: string;
  building_id?: string;
}

type CampaignBuildingFeature = {
  type: 'Feature';
  id?: string | number;
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties?: Record<string, unknown> | null;
};

type CampaignBuildingsGeoJSON = {
  type: 'FeatureCollection';
  features: CampaignBuildingFeature[];
};

interface StreetSegment {
  street_name: string;
  addresses: RouteAddress[];
  start_sequence: number;
  end_sequence: number;
  house_range: string;
  color: string;
}

type RoutePlanSegmentPayload = {
  street_name: string;
  side: 'odds' | 'evens' | 'both';
  from_house: number | null;
  to_house: number | null;
  stop_count: number;
  color: string;
  line_geojson: { type: 'LineString'; coordinates: number[][] } | null;
};

type RouteMember = {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  fullName: string | null;
  email: string | null;
};

type TeamRosterMember = {
  user_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'member';
};

type TeamRosterResponse = {
  members?: TeamRosterMember[];
};

const COLORS = [
  '#ef4444', // red-500
  '#f97316', // orange-500  
  '#22c55e', // green-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#d946ef', // fuchsia-500
];

const UNKNOWN_COLOR = '#ffffff'; // Unknown (no parseable number): white, no sequence order
/** Single map color when no assignees are selected (not street-segment colors). */
const UNASSIGNED_MAP_COLOR = '#6b7280';

/** Parse house number like backend getNum: house_number → street_number → street_name → formatted. */
function parseAddressNumber(addr: { house_number?: string; street_number?: string | number; street_name?: string; formatted?: string }): number {
  let val: string | number | undefined = addr.house_number ?? addr.street_number;
  if (!val && addr.street_name) {
    const m = addr.street_name.trim().match(/^(\d+)\s/);
    if (m) val = m[1];
  }
  if (!val && addr.formatted) {
    const m = addr.formatted.trim().match(/^(\d+)\s/);
    if (m) val = m[1];
  }
  if (val === undefined || val === null) return NaN;
  const s = String(val).replace(/\D/g, '');
  return s.length > 0 ? parseInt(s, 10) : NaN;
}

type Parity = 'even' | 'odd' | 'unknown';

function getParity(addr: RouteAddress, unknownSet: Set<string>): Parity {
  if (unknownSet.has(addr.id)) return 'unknown';
  const n = parseAddressNumber(addr);
  if (isNaN(n)) return 'unknown';
  return n % 2 === 0 ? 'even' : 'odd';
}

/** Street-only key for grouping: strip direction prefix and type suffix (must match backend normalizeStreetName). */
function streetStem(name: string | undefined): string {
  if (!name || !name.trim()) return 'unnamed';
  const s = name.trim().toLowerCase();
  const suffixes = new Set(['dr', 'ave', 'st', 'rd', 'cr', 'blvd', 'ln', 'ct', 'pl', 'way', 'cir']);
  const directions = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw']);
  let parts = s.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && directions.has(parts[0])) parts = parts.slice(1);
  if (parts.length >= 2 && suffixes.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ') || s;
}

function parseSegmentLabel(name: string): { streetName: string; side: 'odds' | 'evens' | 'both' } {
  const [streetNameRaw, sideRaw] = name.split(' — ');
  const side = sideRaw?.toLowerCase() ?? '';
  if (side.includes('odd')) return { streetName: streetNameRaw || name, side: 'odds' };
  if (side.includes('even')) return { streetName: streetNameRaw || name, side: 'evens' };
  return { streetName: streetNameRaw || name, side: 'both' };
}

function buildStreetSegments(
  orderedAddresses: RouteAddress[],
  addressUnknownSet: Set<string>
): StreetSegment[] {
  if (orderedAddresses.length === 0) return [];

  const segmentMap = new Map<string, StreetSegment>();
  let colorIdx = 0;

  orderedAddresses.forEach((addr) => {
    const rawName = addr.street_name || 'Unnamed Street';
    const stem = streetStem(rawName);
    const parity = getParity(addr, addressUnknownSet);
    const key = `${stem}_${parity}`;

    if (!segmentMap.has(key)) {
      const parityLabel = parity === 'even' ? 'Evens' : parity === 'odd' ? 'Odds' : 'No number';
      segmentMap.set(key, {
        street_name: `${rawName} — ${parityLabel}`,
        addresses: [],
        start_sequence: addr.sequence,
        end_sequence: addr.sequence,
        house_range: '',
        color: parity === 'unknown' ? '#94a3b8' : COLORS[colorIdx++ % COLORS.length],
      });
    }

    const segment = segmentMap.get(key)!;
    segment.addresses.push(addr);
    segment.start_sequence = Math.min(segment.start_sequence, addr.sequence);
    segment.end_sequence = Math.max(segment.end_sequence, addr.sequence);
  });

  const segments = Array.from(segmentMap.values()).map((segment) => {
    segment.addresses.sort((a, b) => a.sequence - b.sequence);

    const houseNumbers = segment.addresses
      .map((address) => address.house_number)
      .filter((house): house is string => Boolean(house && house.trim()))
      .map((house) => parseInt(house.replace(/\D/g, ''), 10))
      .filter((num) => !isNaN(num));

    if (houseNumbers.length >= 2) {
      const min = Math.min(...houseNumbers);
      const max = Math.max(...houseNumbers);
      segment.house_range = `${min}–${max}`;
    } else if (houseNumbers.length === 1) {
      segment.house_range = String(houseNumbers[0]);
    } else {
      segment.house_range = `${segment.addresses.length} homes`;
    }

    return segment;
  });

  segments.sort((a, b) => a.start_sequence - b.start_sequence);
  return segments;
}

/**
 * Split walking route across N assignees by whole street-side segments (same grouping as route export),
 * in walking order, assigning each segment to whoever currently has the fewest stops — balances load
 * without cutting through a segment mid-street.
 */
function splitStopsByBalancedSegments(
  ordered: RouteAddress[],
  addressUnknownSet: Set<string>,
  assigneeCount: number
): RouteAddress[][] {
  if (assigneeCount <= 0) return [ordered];
  if (assigneeCount === 1) return [ordered];
  const segments = buildStreetSegments(ordered, addressUnknownSet);
  const bins: RouteAddress[][] = Array.from({ length: assigneeCount }, () => []);
  const counts = new Array(assigneeCount).fill(0);
  for (const seg of segments) {
    let bestIdx = 0;
    for (let i = 1; i < assigneeCount; i += 1) {
      if (counts[i] < counts[bestIdx]) bestIdx = i;
    }
    bins[bestIdx].push(...seg.addresses);
    counts[bestIdx] += seg.addresses.length;
  }
  bins.forEach((bin) => bin.sort((a, b) => a.sequence - b.sequence));
  return bins;
}

function toSegmentsPayload(segments: StreetSegment[]): RoutePlanSegmentPayload[] {
  return segments.map((segment) => {
    const parsed = parseSegmentLabel(segment.street_name);
    const houseRange = parseHouseRange(segment.house_range);
    const lineGeoJson =
      segment.addresses.length >= 2
        ? {
            type: 'LineString' as const,
            coordinates: segment.addresses.map((addr) => [addr.lon, addr.lat]),
          }
        : null;

    return {
      street_name: parsed.streetName,
      side: parsed.side,
      from_house: houseRange.fromHouse,
      to_house: houseRange.toHouse,
      stop_count: segment.addresses.length,
      color: segment.color,
      line_geojson: lineGeoJson,
    };
  });
}

function parseHouseRange(range: string): { fromHouse: number | null; toHouse: number | null } {
  const match = range.match(/(\d+)\D+(\d+)/);
  if (match) {
    return { fromHouse: Number(match[1]), toHouse: Number(match[2]) };
  }
  const single = range.match(/^\s*(\d+)\s*$/);
  if (single) {
    const value = Number(single[1]);
    return { fromHouse: value, toHouse: value };
  }
  return { fromHouse: null, toHouse: null };
}

function displayMemberName(member: RouteMember): string {
  if (member.fullName && member.fullName.trim().length > 0) return member.fullName;
  if (member.email && member.email.trim().length > 0) return member.email;
  return member.userId.slice(0, 8);
}

const MAP_STYLES = {
  light: 'mapbox://styles/fliper27/cml6z0dhg002301qo9xxc08k4',
  dark: 'mapbox://styles/fliper27/cml6zc5pq002801qo4lh13o19',
} as const;

function isValidCoord(lat: number | undefined, lon: number | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat !== 0 &&
    lon !== 0 &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
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
  // geom_json from ST_AsGeoJSON is the most reliable source
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
      // ignore
    }
  }
  const c = addr.coordinate;
  if (c && typeof c.lat === 'number' && typeof c.lon === 'number' && isValidCoord(c.lat, c.lon)) {
    return { lat: c.lat, lon: c.lon };
  }
  return null;
}

export function OptimizedRouteView({ campaignId, campaignName, addresses }: OptimizedRouteViewProps) {
  const { theme } = useTheme();
  const { currentWorkspace, membershipsByWorkspaceId } = useWorkspace();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [members, setMembers] = useState<RouteMember[]>([]);
  const [routePlanName, setRoutePlanName] = useState('');
  const [assignToUserIds, setAssignToUserIds] = useState<string[]>([]);
  const [isAssignDropdownOpen, setIsAssignDropdownOpen] = useState(false);
  const [assignmentPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [assignmentDueAt, setAssignmentDueAt] = useState('');
  const [assignmentNotes, setAssignmentNotes] = useState('');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [campaignBuildings, setCampaignBuildings] = useState<CampaignBuildingsGeoJSON | null>(null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManageRoutePlans = currentRole === 'owner' || currentRole === 'admin';

  useEffect(() => {
    if (routePlanName.trim().length > 0) return;
    const base = campaignName?.trim() || 'Walking Route';
    setRoutePlanName(base);
  }, [campaignName, routePlanName]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/buildings`, { credentials: 'include' });
        const payload = (await response.json().catch(() => null)) as CampaignBuildingsGeoJSON | null;
        if (!mounted) return;
        if (!response.ok || !payload || !Array.isArray(payload.features)) {
          setCampaignBuildings(null);
          return;
        }
        setCampaignBuildings(payload);
      } catch {
        if (!mounted) return;
        setCampaignBuildings(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [campaignId]);

  // Build ordered address list
  const orderedAddresses = useMemo((): RouteAddress[] => {
    if (!addresses?.length) return [];

    const list: RouteAddress[] = [];
    for (const addr of addresses) {
      const coords = getAddressCoords(addr);
      if (!coords) continue;
      const order = addr.sequence ?? addr.seq ?? list.length;
      list.push({
        id: addr.id,
        sequence: order,
        formatted: addr.formatted || '',
        house_number: addr.house_number || '',
        street_number: addr.street_number,
        street_name: addr.street_name || '',
        lat: coords.lat,
        lon: coords.lon,
        gers_id: addr.gers_id,
        building_id: addr.building_id,
      });
    }
    list.sort((a, b) => a.sequence - b.sequence);
    return list;
  }, [addresses]);

  // Unknowns = no parseable house number (match backend getNum); highlight white, no sequence
  const addressUnknownSet = useMemo(() => {
    const set = new Set<string>();
    orderedAddresses.forEach((addr) => {
      if (isNaN(parseAddressNumber(addr))) set.add(addr.id);
    });
    return set;
  }, [orderedAddresses]);

  const addressAssigneeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (assignToUserIds.length === 0) return map;
    const chunks = splitStopsByBalancedSegments(
      orderedAddresses,
      addressUnknownSet,
      assignToUserIds.length
    );
    chunks.forEach((chunk, index) => {
      const color = COLORS[index % COLORS.length];
      chunk.forEach((addr) => {
        map.set(addr.id, addressUnknownSet.has(addr.id) ? UNKNOWN_COLOR : color);
      });
    });
    return map;
  }, [assignToUserIds, orderedAddresses, addressUnknownSet]);

  /** Map colors: one color per assigned member, or neutral when unassigned (never street-segment colors). */
  const effectiveAddressColorMap = useMemo(() => {
    if (assignToUserIds.length > 0) return addressAssigneeColorMap;
    const map = new Map<string, string>();
    orderedAddresses.forEach((addr) => {
      map.set(addr.id, addressUnknownSet.has(addr.id) ? UNKNOWN_COLOR : UNASSIGNED_MAP_COLOR);
    });
    return map;
  }, [assignToUserIds, addressAssigneeColorMap, orderedAddresses, addressUnknownSet]);

  const assigneeSummaryRows = useMemo(() => {
    if (assignToUserIds.length === 0) return [];
    const chunks = splitStopsByBalancedSegments(
      orderedAddresses,
      addressUnknownSet,
      assignToUserIds.length
    );
    return assignToUserIds.map((userId, index) => {
      const member = members.find((m) => m.userId === userId);
      return {
        userId,
        name: member ? displayMemberName(member) : 'Team member',
        color: COLORS[index % COLORS.length],
        count: chunks[index]?.length ?? 0,
      };
    });
  }, [assignToUserIds, orderedAddresses, addressUnknownSet, members]);

  const coloredBuildingFeatures = useMemo(() => {
    if (!campaignBuildings?.features?.length) return [] as GeoJSON.Feature[];

    const visibleAddressIds = new Set<string>();
    const visibleBuildingIds = new Set<string>();
    const visibleGersIds = new Set<string>();
    const colorByAddressId = new Map<string, string>();
    const colorByBuildingId = new Map<string, string>();
    const colorByGersId = new Map<string, string>();

    orderedAddresses.forEach((addr) => {
      const color = effectiveAddressColorMap.get(addr.id) ?? '#ef4444';
      visibleAddressIds.add(addr.id);
      colorByAddressId.set(addr.id, color);
      if (addr.building_id) {
        visibleBuildingIds.add(addr.building_id);
        colorByBuildingId.set(addr.building_id, color);
      }
      if (addr.gers_id) {
        visibleGersIds.add(addr.gers_id);
        colorByGersId.set(addr.gers_id, color);
      }
    });

    return campaignBuildings.features.flatMap((feature) => {
      if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return [];
      const props = feature.properties ?? {};
      const addressId = typeof props.address_id === 'string' ? props.address_id : null;
      const buildingId = typeof props.building_id === 'string' ? props.building_id : null;
      const gersId =
        typeof props.gers_id === 'string'
          ? props.gers_id
          : typeof feature.id === 'string'
            ? feature.id
            : null;

      const matched =
        (addressId && visibleAddressIds.has(addressId)) ||
        (buildingId && visibleBuildingIds.has(buildingId)) ||
        (gersId && visibleGersIds.has(gersId));
      if (!matched) return [];

      const color =
        (addressId && colorByAddressId.get(addressId)) ||
        (buildingId && colorByBuildingId.get(buildingId)) ||
        (gersId && colorByGersId.get(gersId)) ||
        '#ef4444';

      return [{
        type: 'Feature',
        properties: { color },
        geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      }];
    });
  }, [campaignBuildings, effectiveAddressColorMap, orderedAddresses]);

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
    if (!canManageRoutePlans || !currentWorkspaceId) {
      setMembers([]);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const response = await fetch(
          `/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`
        );
        if (!response.ok || !mounted) {
          setMembers([]);
          return;
        }

        const data = (await response.json()) as TeamRosterResponse;
        const ordered = (Array.isArray(data.members) ? data.members : []).map((member) => ({
          userId: member.user_id,
          role: member.role,
          fullName: member.display_name ?? null,
          email: null,
        })) satisfies RouteMember[];

        if (!mounted) return;
        setMembers(ordered);
      } catch (error) {
        console.error('Error loading route assignees:', error);
        if (!mounted) return;
        setMembers([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [canManageRoutePlans, currentWorkspaceId]);

  const handleSaveRoutePlan = useCallback(async () => {
    if (!canManageRoutePlans) {
      setSaveError('Only owners/admins can create route plans.');
      return;
    }
    if (!currentWorkspaceId) {
      setSaveError('No workspace selected.');
      return;
    }
    if (!routePlanName.trim()) {
      setSaveError('Route plan name is required.');
      return;
    }
    if (orderedAddresses.length === 0) {
      setSaveError('No route data available to save.');
      return;
    }
    if (assignToUserIds.length > orderedAddresses.length) {
      setSaveError('Not enough homes to split across selected members. Select fewer assignees.');
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setIsSavingPlan(true);

    try {
      const assigneeCount = assignToUserIds.length;
      const stopsByRoute =
        assigneeCount > 1
          ? splitStopsByBalancedSegments(orderedAddresses, addressUnknownSet, assigneeCount)
          : [orderedAddresses];
      const targets = assigneeCount > 0 ? assignToUserIds : [null];
      const createdPlans: string[] = [];

      for (let index = 0; index < targets.length; index += 1) {
        const assignedToUserId = targets[index];
        const routeStops = assigneeCount > 1 ? stopsByRoute[index] ?? [] : orderedAddresses;
        if (routeStops.length === 0) continue;

        const chunkUnknownSet = new Set<string>();
        routeStops.forEach((addr) => {
          if (isNaN(parseAddressNumber(addr))) chunkUnknownSet.add(addr.id);
        });
        const chunkSegments = buildStreetSegments(routeStops, chunkUnknownSet);
        const segmentsPayload = toSegmentsPayload(chunkSegments);
        const stopsPayload = routeStops.map((addr, stopIndex) => ({
          stop_order: stopIndex + 1,
          address_id: addr.id,
          gers_id: addr.gers_id ?? null,
          lat: addr.lat,
          lng: addr.lon,
          display_address:
            addr.formatted && addr.formatted.trim().length > 0
              ? addr.formatted
              : `${addr.house_number || ''} ${addr.street_name || ''}`.trim() || 'Unknown address',
          building_id: addr.building_id ?? null,
        }));
        const suffix =
          targets.length > 1
            ? ` — ${index + 1} of ${targets.length}`
            : '';

        const createResponse = await fetch('/api/routes/create_from_segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            campaignId,
            name: `${routePlanName.trim()}${suffix}`,
            status: 'active',
            estMinutes: Math.max(1, Math.round((estimatedMinutes * routeStops.length) / orderedAddresses.length)),
            distanceMeters:
              estimatedDistanceMeters != null
                ? Math.max(1, Math.round((estimatedDistanceMeters * routeStops.length) / orderedAddresses.length))
                : null,
            segments: segmentsPayload,
            stops: stopsPayload,
          }),
        });

        const createPayload = (await createResponse.json().catch(() => null)) as
          | { routePlan?: { id: string }; error?: string }
          | null;

        if (!createResponse.ok || !createPayload?.routePlan?.id) {
          setSaveError(createPayload?.error ?? 'Failed to save route plan.');
          return;
        }

        const routePlanId = createPayload.routePlan.id;
        createdPlans.push(routePlanId);
        if (!assignedToUserId) continue;

        const assignResponse = await fetch('/api/routes/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            routePlanId,
            assignedToUserId,
            priority: assignmentPriority,
            dueAt: assignmentDueAt ? `${assignmentDueAt}T23:59:59` : null,
            notes: assignmentNotes || null,
          }),
        });
        const assignPayload = (await assignResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!assignResponse.ok) {
          setSaveError(assignPayload?.error ?? 'Route saved, but assignment failed.');
          return;
        }
      }

      if (assigneeCount === 0) {
        setSaveSuccess(createdPlans.length > 1 ? `Saved ${createdPlans.length} route plans.` : 'Route plan saved.');
      } else if (assigneeCount === 1) {
        const member = members.find((entry) => entry.userId === assignToUserIds[0]);
        setSaveSuccess(
          `Route plan saved and assigned to ${member ? displayMemberName(member) : 'team member'}.`
        );
      } else {
        setSaveSuccess(
          `Created ${createdPlans.length} routes (balanced by street segments) for ${assigneeCount} team members.`
        );
      }
      setAssignmentNotes('');
      setAssignmentDueAt('');
    } catch {
      setSaveError('Failed to save route plan.');
    } finally {
      setIsSavingPlan(false);
    }
  }, [
    canManageRoutePlans,
    currentWorkspaceId,
    routePlanName,
    orderedAddresses,
    campaignId,
    estimatedMinutes,
    estimatedDistanceMeters,
    assignToUserIds,
    assignmentPriority,
    assignmentDueAt,
    assignmentNotes,
    members,
    addressUnknownSet,
  ]);

  // Draw route layers on the current map — called after every style.load
  const drawRoute = useCallback((m: mapboxgl.Map) => {
    if (orderedAddresses.length === 0) return;

    ['route-footprints', 'route-points'].forEach((id) => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource('route-footprints-source')) m.removeSource('route-footprints-source');
    if (m.getSource('route-points-source')) m.removeSource('route-points-source');

    if (coloredBuildingFeatures.length > 0) {
      m.addSource('route-footprints-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: coloredBuildingFeatures,
        },
      });

      m.addLayer({
        id: 'route-footprints',
        type: 'fill-extrusion',
        source: 'route-footprints-source',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': 7.5,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      try {
        m.setPitch(60);
      } catch {
        // ignore
      }
    }

    // Fallback dots when footprint polygons are unavailable
    const pointFeatures: GeoJSON.Feature[] = orderedAddresses.map((addr) => {
      const isUnknown = addressUnknownSet.has(addr.id);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [addr.lon, addr.lat] },
        properties: {
          color: effectiveAddressColorMap.get(addr.id) || '#ef4444',
          isUnknown: isUnknown ? 1 : 0,
        },
      };
    });

    if (pointFeatures.length > 0) {
      m.addSource('route-points-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pointFeatures },
      });

      if (coloredBuildingFeatures.length === 0) {
        m.addLayer({
          id: 'route-points',
          type: 'circle',
          source: 'route-points-source',
          paint: {
            'circle-radius': 4,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.95,
            'circle-stroke-width': 0,
            'circle-stroke-color': ['case', ['get', 'isUnknown'], '#94a3b8', '#fff'],
          },
        });
      }
    }

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    orderedAddresses.forEach(addr => {
      if (isValidCoord(addr.lat, addr.lon)) bounds.extend([addr.lon, addr.lat]);
    });
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 600 });
    }
  }, [orderedAddresses, addressUnknownSet, effectiveAddressColorMap, coloredBuildingFeatures]);

  // Manage map lifecycle: create once, draw on every style.load
  useEffect(() => {
    if (!mapContainer.current || orderedAddresses.length === 0) return;

    const token = getMapboxToken();
    mapboxgl.accessToken = token;

    const styleUrl = MAP_STYLES[theme] ?? MAP_STYLES.light;

    // If map already exists, just update style (style.load handler will redraw)
    if (map.current) {
      const currentStyle = map.current.getStyle()?.sprite;
      if (currentStyle && !currentStyle.toString().includes(theme)) {
        map.current.setStyle(styleUrl);
      }
      return;
    }

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [-79.3832, 43.6532],
      zoom: 12,
    });

    // Draw route after every style load (initial + theme changes)
    m.on('style.load', () => {
      drawRoute(m);
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedAddresses, theme]);

  // Re-draw when data changes (without recreating map)
  useEffect(() => {
    if (!map.current || orderedAddresses.length === 0) return;
    if (!map.current.isStyleLoaded()) return;
    drawRoute(map.current);
  }, [drawRoute, orderedAddresses.length]);

  if (orderedAddresses.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center py-8">
          <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">No addresses yet</h3>
          <p className="text-sm text-muted-foreground">
            Addresses will appear here in walking order once the campaign is provisioned.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {assignToUserIds.length > 0
            ? `${assignToUserIds.length} member${assignToUserIds.length === 1 ? '' : 's'} on route`
            : 'Select members to color homes by assignee'}
        </span>
        <span>{orderedAddresses.length} homes in walking order</span>
      </div>

      {canManageRoutePlans ? (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Label htmlFor="route-plan-name" className="shrink-0 text-base font-semibold">
                Name :
              </Label>
              <Input
                id="route-plan-name"
                value={routePlanName}
                onChange={(event) => setRoutePlanName(event.target.value)}
                placeholder="Route name"
                className="h-12 text-2xl font-semibold"
                disabled={isSavingPlan}
              />
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <Label htmlFor="route-assignees">Assign</Label>
                <Button
                  id="route-assignees"
                  type="button"
                  variant="outline"
                  className="mt-1 w-full justify-between"
                  onClick={() => setIsAssignDropdownOpen((current) => !current)}
                  disabled={isSavingPlan}
                >
                  <span className="truncate text-left">
                    {assignToUserIds.length === 0 ? 'Unassigned' : `${assignToUserIds.length} selected`}
                  </span>
                  {isAssignDropdownOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
                {isAssignDropdownOpen ? (
                  <div className="mt-2 rounded-md border border-border bg-muted/15 p-2 space-y-2">
                    {members.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No assignable team members.</p>
                    ) : (
                      members.map((member) => {
                        const selected = assignToUserIds.includes(member.userId);
                        return (
                          <Button
                            key={member.userId}
                            type="button"
                            size="sm"
                            variant={selected ? 'default' : 'outline'}
                            className="mr-2 mb-2"
                            onClick={() =>
                              setAssignToUserIds((current) =>
                                current.includes(member.userId)
                                  ? current.filter((id) => id !== member.userId)
                                  : [...current, member.userId]
                              )
                            }
                            disabled={isSavingPlan}
                          >
                            {displayMemberName(member)}
                          </Button>
                        );
                      })
                    )}
                  </div>
                ) : null}
                {assignToUserIds.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground truncate">
                    {members
                      .filter((member) => assignToUserIds.includes(member.userId))
                      .map((member) => displayMemberName(member))
                      .join(', ')}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="route-due-at">Due date (optional)</Label>
                <Input
                  id="route-due-at"
                  type="date"
                  value={assignmentDueAt}
                  onChange={(event) => setAssignmentDueAt(event.target.value)}
                  className="mt-1 pr-3 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-100 [&::-webkit-calendar-picker-indicator]:scale-125"
                  disabled={isSavingPlan}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="route-notes">Lead notes (optional)</Label>
              <Input
                id="route-notes"
                value={assignmentNotes}
                onChange={(event) => setAssignmentNotes(event.target.value)}
                placeholder="Special instructions for the assignee"
                className="mt-1"
                disabled={isSavingPlan}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              {orderedAddresses.length} stops • ~{estimatedMinutes} min
              {estimatedDistanceMeters ? ` • ${(estimatedDistanceMeters / 1000).toFixed(1)} km` : ''}
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            {saveSuccess ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveSuccess}</p> : null}

            <Button
              className="w-full"
              onClick={() => void handleSaveRoutePlan()}
              disabled={isSavingPlan}
            >
              {isSavingPlan ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save & Send Route
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Walking Route Map */}
      <div className="relative h-[560px] w-full rounded-lg border bg-card shadow-sm overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Members: names + house counts (colors match map) */}
      <div className="space-y-2">
        {assigneeSummaryRows.length > 0 ? (
          assigneeSummaryRows.map((row, idx) => (
            <Card key={row.userId}>
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: row.color }}
                    >
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm font-semibold">{row.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">Homes in their split</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="flex shrink-0 items-center gap-1">
                    <Home className="h-3 w-3" />
                    {row.count} {row.count === 1 ? 'house' : 'houses'}
                  </Badge>
                </div>
              </CardHeader>
            </Card>
          ))
        ) : (
          <Card>
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="h-8 w-8 shrink-0 rounded-full"
                    style={{ backgroundColor: UNASSIGNED_MAP_COLOR }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-semibold">Unassigned</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Select members above to split the route and match map colors.
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="flex shrink-0 items-center gap-1">
                  <Home className="h-3 w-3" />
                  {orderedAddresses.length} {orderedAddresses.length === 1 ? 'house' : 'houses'}
                </Badge>
              </div>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
