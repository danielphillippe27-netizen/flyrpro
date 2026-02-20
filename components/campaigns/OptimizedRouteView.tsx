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
  ArrowRight,
  Save,
  Loader2
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

interface StreetSegment {
  street_name: string;
  addresses: RouteAddress[];
  start_sequence: number;
  end_sequence: number;
  house_range: string;
  color: string;
}

type RouteMember = {
  userId: string;
  role: 'owner' | 'admin' | 'member';
  fullName: string | null;
  email: string | null;
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
  const [expandedStreet, setExpandedStreet] = useState<string | null>(null);
  const [members, setMembers] = useState<RouteMember[]>([]);
  const [routePlanName, setRoutePlanName] = useState('');
  const [assignToUserId, setAssignToUserId] = useState<string>('none');
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManageRoutePlans = currentRole === 'owner' || currentRole === 'admin';

  useEffect(() => {
    if (routePlanName.trim().length > 0) return;
    const base = campaignName?.trim() || 'Walking Route';
    const label = `${base} — ${new Date().toLocaleDateString()}`;
    setRoutePlanName(label);
  }, [campaignName, routePlanName]);

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

  // Segments = street + parity (Evens / Odds / No number), so list matches postman order (one side then the other)
  const streetSegments = useMemo((): StreetSegment[] => {
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
        .map(a => a.house_number)
        .filter(h => h && h.trim())
        .map(h => parseInt(h.replace(/\D/g, ''), 10))
        .filter(n => !isNaN(n));

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
  }, [orderedAddresses, addressUnknownSet]);

  // Color: segment color, or white for unknowns
  const addressColorMap = useMemo(() => {
    const colorMap = new Map<string, string>();
    streetSegments.forEach(segment => {
      segment.addresses.forEach(addr => {
        colorMap.set(addr.id, addressUnknownSet.has(addr.id) ? UNKNOWN_COLOR : segment.color);
      });
    });
    return colorMap;
  }, [streetSegments, addressUnknownSet]);

  // Per-street sequence (1, 2, 3...); unknowns get no number (empty) so "not in order"
  const addressStreetSeqMap = useMemo(() => {
    const map = new Map<string, number | string>();
    streetSegments.forEach(segment => {
      segment.addresses.forEach((addr, i) => {
        map.set(addr.id, addressUnknownSet.has(addr.id) ? '' : i + 1);
      });
    });
    return map;
  }, [streetSegments, addressUnknownSet]);

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
    if (streetSegments.length === 0 || orderedAddresses.length === 0) {
      setSaveError('No route data available to save.');
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setIsSavingPlan(true);

    try {
      const segmentsPayload = streetSegments.map((segment) => {
        const parsed = parseSegmentLabel(segment.street_name);
        const houseRange = parseHouseRange(segment.house_range);
        const lineGeoJson =
          segment.addresses.length >= 2
            ? {
                type: 'LineString',
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

      const stopsPayload = orderedAddresses.map((addr, index) => ({
        stop_order: index + 1,
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

      const createResponse = await fetch('/api/routes/create_from_segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          campaignId,
          name: routePlanName.trim(),
          status: 'active',
          estMinutes: estimatedMinutes,
          distanceMeters: estimatedDistanceMeters,
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
      if (assignToUserId && assignToUserId !== 'none') {
        const assignResponse = await fetch('/api/routes/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            routePlanId,
            assignedToUserId: assignToUserId,
          }),
        });
        const assignPayload = (await assignResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!assignResponse.ok) {
          setSaveError(assignPayload?.error ?? 'Route saved, but assignment failed.');
          return;
        }

        const member = members.find((entry) => entry.userId === assignToUserId);
        setSaveSuccess(
          `Route plan saved and assigned to ${member ? displayMemberName(member) : 'team member'}.`
        );
      } else {
        setSaveSuccess('Route plan saved.');
      }
    } catch {
      setSaveError('Failed to save route plan.');
    } finally {
      setIsSavingPlan(false);
    }
  }, [
    canManageRoutePlans,
    currentWorkspaceId,
    routePlanName,
    streetSegments,
    orderedAddresses,
    campaignId,
    estimatedMinutes,
    estimatedDistanceMeters,
    assignToUserId,
    members,
  ]);

  // Draw route layers on the current map — called after every style.load (dots only, no lines; labels = street sequence)
  const drawRoute = useCallback((m: mapboxgl.Map) => {
    if (orderedAddresses.length === 0) return;

    ['route-points', 'route-labels'].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id);
    });
    if (m.getSource('route-points-source')) m.removeSource('route-points-source');

    // Dots colored by street segment; unknowns = white, no sequence label
    const pointFeatures: GeoJSON.Feature[] = orderedAddresses.map((addr) => {
      const isUnknown = addressUnknownSet.has(addr.id);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [addr.lon, addr.lat] },
        properties: {
          color: addressColorMap.get(addr.id) || '#ef4444',
          streetSeq: addressStreetSeqMap.get(addr.id) ?? '',
          isUnknown: isUnknown ? 1 : 0,
        },
      };
    });

    if (pointFeatures.length > 0) {
      m.addSource('route-points-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pointFeatures },
      });

      m.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'route-points-source',
        paint: {
          'circle-radius': 4,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.95,
          'circle-stroke-width': 1,
          'circle-stroke-color': ['case', ['get', 'isUnknown'], '#94a3b8', '#fff'],
        },
      });

      // Labels: street sequence (1, 2, 3...); unknowns show no number (no halo/outline)
      m.addLayer({
        id: 'route-labels',
        type: 'symbol',
        source: 'route-points-source',
        layout: {
          'text-field': ['to-string', ['get', 'streetSeq']],
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 0.7],
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-width': 0,
        },
      });
    }

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    orderedAddresses.forEach(addr => {
      if (isValidCoord(addr.lat, addr.lon)) bounds.extend([addr.lon, addr.lat]);
    });
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 600 });
    }
  }, [orderedAddresses, addressColorMap, addressStreetSeqMap, addressUnknownSet]);

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
        <span>{streetSegments.length} street segments</span>
        <span>{orderedAddresses.length} homes in walking order</span>
      </div>

      {canManageRoutePlans ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Save as Route Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <Label htmlFor="route-plan-name">Route plan name</Label>
                <Input
                  id="route-plan-name"
                  value={routePlanName}
                  onChange={(event) => setRoutePlanName(event.target.value)}
                  placeholder="Open House - Section A"
                  className="mt-1"
                  disabled={isSavingPlan}
                />
              </div>
              <div>
                <Label htmlFor="route-assignee">Assign to (optional)</Label>
                <Select
                  value={assignToUserId}
                  onValueChange={setAssignToUserId}
                  disabled={isSavingPlan}
                >
                  <SelectTrigger id="route-assignee" className="mt-1">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {displayMemberName(member)} ({member.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {orderedAddresses.length} stops • ~{estimatedMinutes} min
                {estimatedDistanceMeters ? ` • ${(estimatedDistanceMeters / 1000).toFixed(1)} km` : ''}
              </div>
              <Button onClick={() => void handleSaveRoutePlan()} disabled={isSavingPlan}>
                {isSavingPlan ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Route Plan
              </Button>
            </div>

            {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            {saveSuccess ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{saveSuccess}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Walking Route Map */}
      <div className="relative h-[560px] w-full rounded-lg border bg-card shadow-sm overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Street Segments */}
      <div className="space-y-2">
        {streetSegments.map((segment, idx) => (
          <Card 
            key={segment.street_name}
            className={`cursor-pointer transition-all hover:shadow-md ${
              expandedStreet === segment.street_name ? 'ring-2 ring-primary' : ''
            }`}
          >
            <CardHeader
              className="p-3 pb-2"
              onClick={() => setExpandedStreet(expandedStreet === segment.street_name ? null : segment.street_name)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: segment.color }}
                  >
                    {idx + 1}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">{segment.street_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Homes {segment.house_range}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Home className="w-3 h-3" />
                    {segment.addresses.length}
                  </Badge>
                  {expandedStreet === segment.street_name ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>

            {expandedStreet === segment.street_name && (
              <CardContent className="p-3 pt-0">
                <div className="border-t pt-3 mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Walking order:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {segment.addresses.map((addr, addrIdx) => {
                      const isUnknown = addressUnknownSet.has(addr.id);
                      return (
                        <div 
                          key={addr.id}
                          className="flex items-center gap-2 text-xs p-2 bg-muted rounded"
                        >
                          <span 
                            className="w-5 h-5 flex items-center justify-center rounded text-xs font-medium shrink-0 border border-border"
                            style={{
                              backgroundColor: isUnknown ? UNKNOWN_COLOR : segment.color,
                              color: isUnknown ? '#64748b' : 'white',
                            }}
                          >
                            {isUnknown ? '—' : addrIdx + 1}
                          </span>
                          <span className="truncate">
                            {addr.house_number || (isUnknown ? 'No number' : '?')}
                          </span>
                          {addrIdx < segment.addresses.length - 1 && (
                            <ArrowRight className="w-3 h-3 text-muted-foreground ml-auto shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
