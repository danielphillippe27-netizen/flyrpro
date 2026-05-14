'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import type { ExpressionSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { getMapboxToken } from '@/lib/mapbox';
import { MAP_STATUS_CONFIG } from '@/lib/constants/mapStatus';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { applyPresetVisualTweaks, applyResolvedMapStyle, getResolvedMapInitOptions, resolveMapStyle } from '@/lib/map-styles';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

type AssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

type AssignmentRow = {
  id: string;
  status: AssignmentStatus;
  priority?: 'low' | 'normal' | 'high';
  due_at?: string | null;
  route_plan: {
    id: string;
    name: string;
    total_stops: number;
    est_minutes: number | null;
    campaign_id?: string | null;
  } | null;
  assignee?: {
    user_id: string;
    display_name: string;
  };
};

type AssignmentDetail = {
  stops: Array<{
    id: string;
    stop_order: number;
    address_id: string | null;
    gers_id: string | null;
    building_id: string | null;
    display_address: string | null;
    lat: number | null;
    lng: number | null;
    visited?: boolean | null;
  }>;
};

function splitHouseStreet(display: string | null | undefined): { house: string; street: string } {
  const t = (display ?? '').trim();
  if (!t) return { house: '', street: 'Unknown address' };
  const m = t.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (m) return { house: m[1], street: m[2] };
  return { house: '', street: t };
}

function formatAssignmentDue(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function countUniqueStreetsFromStops(stops: { display_address: string | null }[]): number {
  const set = new Set<string>();
  for (const s of stops) {
    const { street } = splitHouseStreet(s.display_address);
    const key = street.trim().toLowerCase();
    if (key && key !== 'unknown address') set.add(key);
  }
  return set.size;
}

function visitedPercentLabelFromStops(stops: { visited?: boolean | null }[]): string {
  const known = stops.filter((s) => s.visited === true || s.visited === false);
  if (known.length === 0) return '—';
  const done = known.filter((s) => s.visited === true).length;
  return `${Math.round((done / known.length) * 100)}%`;
}

type MapDataBundle = {
  fallbackPoints: Array<{ lng: number; lat: number }>;
  matchedFootprints: GeoJSON.Feature[];
  cylinderFeatures: GeoJSON.Feature[];
};

/** Matches `StatsHeader` campaign metric cards: label, large value, muted subtext. */
function RouteStatsMetricCard({
  label,
  value,
  subtext,
  valueClassName,
}: {
  label: string;
  value: string;
  subtext: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
      <div className="text-sm text-muted-foreground mb-1">{label}</div>
      <div className={cn('text-3xl font-bold tabular-nums', valueClassName)}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{subtext}</div>
    </div>
  );
}

function RouteAssignmentMapFrame({
  mapContainerRef,
  mapViewMode,
  onMapViewMode,
  mapData,
  className,
}: {
  mapContainerRef: RefObject<HTMLDivElement | null>;
  mapViewMode: 'buildings' | 'addresses';
  onMapViewMode: (mode: 'buildings' | 'addresses') => void;
  mapData: MapDataBundle;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative h-[420px] w-full overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
    >
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute top-3 right-3 flex flex-col gap-2">
          <div className="flex rounded-lg border border-border bg-background/90 dark:bg-background/85 backdrop-blur-sm shadow-sm overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => onMapViewMode('buildings')}
              className={cn(
                'px-3 py-2 font-medium transition-colors',
                mapViewMode === 'buildings'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              Buildings
            </button>
            <button
              type="button"
              onClick={() => onMapViewMode('addresses')}
              className={cn(
                'px-3 py-2 font-medium transition-colors',
                mapViewMode === 'addresses'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              Addresses
            </button>
          </div>
        </div>
      </div>
      {mapData.fallbackPoints.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground pointer-events-none z-[5]">
          No geocoded stops for the routes in view.
        </div>
      ) : mapViewMode === 'buildings' && mapData.matchedFootprints.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground pointer-events-none z-[5]">
          No building footprints for these routes. Switch to Addresses for stop markers.
        </div>
      ) : mapViewMode === 'addresses' && mapData.cylinderFeatures.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-sm text-muted-foreground pointer-events-none z-[5]">
          No address markers for the routes in view.
        </div>
      ) : null}
    </div>
  );
}

type RouteStopCardModel = AssignmentDetail['stops'][number];

function RouteStopSquareCard({
  stop,
  dueAt,
  showOrder = true,
}: {
  stop: RouteStopCardModel;
  dueAt: string | null | undefined;
  showOrder?: boolean;
}) {
  const { house, street } = splitHouseStreet(stop.display_address);
  const visitedPct = stop.visited === true ? 100 : stop.visited === false ? 0 : null;
  const dueLabel = formatAssignmentDue(dueAt);
  return (
    <div className="aspect-square flex flex-col rounded-2xl border border-border/70 bg-card shadow-sm overflow-hidden">
      {showOrder ? (
        <div className="flex items-start px-2.5 pt-2">
          <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
            {stop.stop_order}
          </span>
        </div>
      ) : (
        <div className="h-2 shrink-0" aria-hidden />
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-2 min-h-0 text-center">
        {house ? (
          <>
            <p className="text-base font-bold leading-tight tracking-tight text-foreground">{house}</p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-1 line-clamp-3">{street}</p>
          </>
        ) : (
          <p className="text-xs font-medium leading-snug text-foreground line-clamp-4 px-0.5">{street}</p>
        )}
      </div>
      <div className="mt-auto space-y-2 px-2.5 pb-2.5 pt-2 border-t border-border/50 bg-muted/15 dark:bg-muted/10">
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Visited</span>
            <span className="text-[11px] font-semibold tabular-nums text-foreground">
              {visitedPct === null ? '—' : `${visitedPct}%`}
            </span>
          </div>
          {visitedPct !== null ? (
            <Progress value={visitedPct} className="h-1.5 bg-primary/10 dark:bg-white/15" />
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px]">
          <span className="uppercase tracking-wider text-muted-foreground font-medium">Due</span>
          <span className="font-medium text-foreground tabular-nums truncate max-w-[58%] text-right">{dueLabel}</span>
        </div>
      </div>
    </div>
  );
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

function isValidCoord(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** WGS84 meters → lng/lat offset (good enough for small radii used as map markers). */
function circlePolygon(lng: number, lat: number, radiusM: number, segments: number): GeoJSON.Polygon {
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.max(1e-6, Math.cos(latRad));
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const eastM = radiusM * Math.cos(angle);
    const northM = radiusM * Math.sin(angle);
    const dLng = eastM / (111320 * cosLat);
    const dLat = northM / 111320;
    ring.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const ADDRESS_CYLINDER_RADIUS_M = 2.75;
const ADDRESS_CYLINDER_SEGMENTS = 28;
const ADDRESS_CYLINDER_HEIGHT_M = 8;

function statusLabel(status: AssignmentStatus): string {
  if (status === 'in_progress') return 'In progress';
  if (status === 'assigned') return 'Assigned';
  if (status === 'accepted') return 'Accepted';
  if (status === 'completed') return 'Completed';
  if (status === 'declined') return 'Declined';
  return 'Cancelled';
}

type AssignedRoutesViewProps = {
  campaignId?: string;
  embedded?: boolean;
  /** When set (standalone /routes/[id] page), scope the view to this assignment and match campaigns-style detail layout. */
  focusAssignmentId?: string;
};

export function AssignedRoutesView({
  campaignId,
  embedded = false,
  focusAssignmentId,
}: AssignedRoutesViewProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v12'),
    [mapPreset, theme],
  );
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed'>('active');
  const [mapViewMode, setMapViewMode] = useState<'buildings' | 'addresses'>('buildings');
  const [routeFilter, setRouteFilter] = useState('');
  const [houseFilter, setHouseFilter] = useState('');
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null);
  const [detailByAssignmentId, setDetailByAssignmentId] = useState<Record<string, AssignmentDetail>>({});
  const [detailLoadingByAssignmentId, setDetailLoadingByAssignmentId] = useState<Record<string, boolean>>({});
  const [campaignBuildings, setCampaignBuildings] = useState<CampaignBuildingsGeoJSON | null>(null);

  const loadAssignments = useCallback(async () => {
    if (!currentWorkspaceId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/routes/assignments?workspaceId=${encodeURIComponent(currentWorkspaceId)}${
          campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''
        }`,
        { credentials: 'include' }
      );
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: AssignmentRow[]; error?: string }
        | null;
      if (!response.ok) {
        setAssignments([]);
        setError(payload?.error ?? 'Failed to load assigned routes.');
        return;
      }

      const rows = Array.isArray(payload?.assignments) ? payload.assignments : [];
      setAssignments(rows);
    } catch {
      setAssignments([]);
      setError('Failed to load assigned routes.');
    } finally {
      setLoading(false);
    }
  }, [campaignId, currentWorkspaceId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const effectiveCampaignId = useMemo(() => {
    if (campaignId) return campaignId;
    if (!focusAssignmentId) return undefined;
    return assignments.find((a) => a.id === focusAssignmentId)?.route_plan?.campaign_id ?? undefined;
  }, [campaignId, focusAssignmentId, assignments]);

  useEffect(() => {
    if (focusAssignmentId) {
      setExpandedAssignmentId(focusAssignmentId);
    }
  }, [focusAssignmentId]);

  useEffect(() => {
    if (!effectiveCampaignId) {
      setCampaignBuildings(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const response = await fetch(`/api/campaigns/${effectiveCampaignId}/buildings`, { credentials: 'include' });
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
  }, [effectiveCampaignId]);

  const loadAssignmentDetail = useCallback(async (assignmentId: string) => {
    if (detailByAssignmentId[assignmentId] || detailLoadingByAssignmentId[assignmentId]) return;
    setDetailLoadingByAssignmentId((current) => ({ ...current, [assignmentId]: true }));
    try {
      const response = await fetch(`/api/routes/assignments/${assignmentId}`, { credentials: 'include' });
      const payload = (await response.json().catch(() => null)) as
        | { stops?: AssignmentDetail['stops']; error?: string }
        | null;
      if (!response.ok) return;
      const stops = Array.isArray(payload?.stops) ? payload.stops : [];
      setDetailByAssignmentId((current) => ({ ...current, [assignmentId]: { stops } }));
    } finally {
      setDetailLoadingByAssignmentId((current) => ({ ...current, [assignmentId]: false }));
    }
  }, [detailByAssignmentId, detailLoadingByAssignmentId]);

  const routeFilteredAssignments = useMemo(() => {
    const routeQuery = routeFilter.trim().toLowerCase();
    const source = focusAssignmentId
      ? assignments.filter((a) => a.id === focusAssignmentId)
      : assignments;
    return source
      .filter((assignment) => {
        if (focusAssignmentId) return true;
        if (statusFilter === 'completed') return assignment.status === 'completed';
        return (
          assignment.status === 'assigned' ||
          assignment.status === 'accepted' ||
          assignment.status === 'in_progress'
        );
      })
      .filter((assignment) => {
        if (focusAssignmentId) return true;
        if (!routeQuery) return true;
        return (assignment.route_plan?.name ?? '').toLowerCase().includes(routeQuery);
      });
  }, [assignments, focusAssignmentId, routeFilter, statusFilter]);

  useEffect(() => {
    routeFilteredAssignments.forEach((assignment) => {
      void loadAssignmentDetail(assignment.id);
    });
  }, [loadAssignmentDetail, routeFilteredAssignments]);

  const filteredAssignments = useMemo(() => {
    const houseQuery = houseFilter.trim().toLowerCase();
    if (!houseQuery) return routeFilteredAssignments;
    return routeFilteredAssignments.filter((assignment) => {
      const detail = detailByAssignmentId[assignment.id];
      if (!detail) return true;
      return detail.stops.some((stop) => (stop.display_address ?? '').toLowerCase().includes(houseQuery));
    });
  }, [detailByAssignmentId, houseFilter, routeFilteredAssignments]);

  const mapData = useMemo(() => {
    const visibleAddressIds = new Set<string>();
    const visibleBuildingIds = new Set<string>();
    const visibleGersIds = new Set<string>();
    filteredAssignments.forEach((assignment) => {
      const detail = detailByAssignmentId[assignment.id];
      const stops = detail?.stops ?? [];
      stops.forEach((stop) => {
        if (stop.address_id) {
          visibleAddressIds.add(stop.address_id);
        }
        if (stop.building_id) {
          visibleBuildingIds.add(stop.building_id);
        }
        if (stop.gers_id) {
          visibleGersIds.add(stop.gers_id);
        }
      });
    });

    const matchedFootprints: GeoJSON.Feature[] = (campaignBuildings?.features ?? []).flatMap((feature) => {
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

      return [{
        type: 'Feature',
        properties: { ...(feature.properties ?? {}) },
        geometry: feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      }];
    });

    const fallbackPoints: Array<{ lng: number; lat: number }> = [];
    filteredAssignments.forEach((assignment) => {
      const detail = detailByAssignmentId[assignment.id];
      const stops = detail?.stops ?? [];
      stops.forEach((stop) => {
        if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') return;
        if (!isValidCoord(stop.lat, stop.lng)) return;
        fallbackPoints.push({ lng: stop.lng, lat: stop.lat });
      });
    });

    const byAddressId = new Map<string, Record<string, unknown>>();
    const byBuildingId = new Map<string, Record<string, unknown>>();
    const byGersId = new Map<string, Record<string, unknown>>();
    for (const f of matchedFootprints) {
      const p = f.properties ?? {};
      const aid = typeof p.address_id === 'string' ? p.address_id : null;
      const bid = typeof p.building_id === 'string' ? p.building_id : null;
      const gid = typeof p.gers_id === 'string' ? p.gers_id : null;
      if (aid) byAddressId.set(aid, p as Record<string, unknown>);
      if (bid) byBuildingId.set(bid, p as Record<string, unknown>);
      if (gid) byGersId.set(gid, p as Record<string, unknown>);
    }

    const cylinderFeatures: GeoJSON.Feature[] = [];
    filteredAssignments.forEach((assignment) => {
      const detail = detailByAssignmentId[assignment.id];
      const stops = detail?.stops ?? [];
      stops.forEach((stop) => {
        if (typeof stop.lat !== 'number' || typeof stop.lng !== 'number') return;
        if (!isValidCoord(stop.lat, stop.lng)) return;
        let props: Record<string, unknown> = {};
        if (stop.address_id && byAddressId.has(stop.address_id)) {
          props = { ...byAddressId.get(stop.address_id)! };
        } else if (stop.building_id && byBuildingId.has(stop.building_id)) {
          props = { ...byBuildingId.get(stop.building_id)! };
        } else if (stop.gers_id && byGersId.has(stop.gers_id)) {
          props = { ...byGersId.get(stop.gers_id)! };
        }
        cylinderFeatures.push({
          type: 'Feature',
          properties: props,
          geometry: circlePolygon(stop.lng, stop.lat, ADDRESS_CYLINDER_RADIUS_M, ADDRESS_CYLINDER_SEGMENTS),
        });
      });
    });

    return { matchedFootprints, fallbackPoints, cylinderFeatures };
  }, [campaignBuildings, detailByAssignmentId, filteredAssignments]);

  const footprintColorExpression = useMemo<ExpressionSpecification>(() => {
    const getAddressStatus = () => ['coalesce', ['get', 'address_status'], 'none'];
    const getStatus = () => ['coalesce', ['get', 'status'], 'not_visited'];
    const getQrScanned = () => ['coalesce', ['get', 'qr_scanned'], false];
    const getScansTotal = () => ['coalesce', ['get', 'scans_total'], 0];
    const isQrScanned = ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
    const isConversation = [
      'any',
      ['==', getAddressStatus(), 'talked'],
      ['==', getStatus(), 'hot'],
    ];
    const isHotLead = [
      'any',
      ['in', getAddressStatus(), ['literal', ['appointment', 'future_seller', 'hot_lead']]],
      ['==', getStatus(), 'hot_lead'],
    ];
    const isLead = [
      'any',
      ['==', getStatus(), 'lead'],
    ];
    const isDoNotKnock = ['any', ['==', getAddressStatus(), 'do_not_knock'], ['==', getStatus(), 'do_not_knock']];
    const isNoOneHome = [
      'any',
      ['in', getAddressStatus(), ['literal', ['no_answer', 'not_home']]],
      ['==', getStatus(), 'no_answer'],
    ];
    const isTouched = ['any', ['==', getAddressStatus(), 'delivered'], ['==', getStatus(), 'visited']];
    return [
      'case',
      isQrScanned,
      MAP_STATUS_CONFIG.QR_SCANNED.color,
      isHotLead,
      MAP_STATUS_CONFIG.HOT_LEADS.color,
      isLead,
      MAP_STATUS_CONFIG.LEADS.color,
      isConversation,
      MAP_STATUS_CONFIG.CONVERSATIONS.color,
      isDoNotKnock,
      MAP_STATUS_CONFIG.DO_NOT_KNOCK.color,
      isNoOneHome,
      MAP_STATUS_CONFIG.NO_ONE_HOME.color,
      isTouched,
      MAP_STATUS_CONFIG.TOUCHED.color,
      MAP_STATUS_CONFIG.UNTOUCHED.color,
    ] as ExpressionSpecification;
  }, []);

  const drawMap = useCallback((mapInstance: mapboxgl.Map) => {
    ['assigned-routes-footprints', 'assigned-routes-address-points', 'assigned-routes-address-cylinders'].forEach(
      (layerId) => {
        if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
      }
    );
    [
      'assigned-routes-footprints-source',
      'assigned-routes-address-points-source',
      'assigned-routes-address-cylinders-source',
    ].forEach((sourceId) => {
      if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId);
    });

    const showBuildings = mapViewMode === 'buildings' && mapData.matchedFootprints.length > 0;
    const showAddresses = mapViewMode === 'addresses' && mapData.cylinderFeatures.length > 0;

    if (showBuildings) {
      mapInstance.addSource('assigned-routes-footprints-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: mapData.matchedFootprints,
        },
      });
      mapInstance.addLayer({
        id: 'assigned-routes-footprints',
        type: 'fill-extrusion',
        source: 'assigned-routes-footprints-source',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': footprintColorExpression,
          'fill-extrusion-height': 7.5,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-emissive-strength': 0.85,
        },
      });
    }

    if (showAddresses) {
      mapInstance.addSource('assigned-routes-address-cylinders-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: mapData.cylinderFeatures,
        },
      });
      mapInstance.addLayer({
        id: 'assigned-routes-address-cylinders',
        type: 'fill-extrusion',
        source: 'assigned-routes-address-cylinders-source',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': footprintColorExpression,
          'fill-extrusion-height': ADDRESS_CYLINDER_HEIGHT_M,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 1,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-emissive-strength': 0.85,
        },
      });
    }

    if (showBuildings || showAddresses) {
      try {
        mapInstance.setPitch(60);
      } catch {
        // no-op
      }
    } else {
      try {
        mapInstance.setPitch(0);
      } catch {
        // no-op
      }
    }

    if (mapData.fallbackPoints.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      mapData.fallbackPoints.forEach((point) => bounds.extend([point.lng, point.lat]));
      if (!bounds.isEmpty()) {
        mapInstance.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: 450 });
      }
    }
  }, [footprintColorExpression, mapData, mapViewMode]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    let cancelled = false;
    mapboxgl.accessToken = getMapboxToken();

    const initMap = async () => {
      const mapInitOptions = await getResolvedMapInitOptions(resolvedMapStyle);
      if (cancelled || !mapContainer.current || mapRef.current) return;

      const instance = new mapboxgl.Map({
        container: mapContainer.current,
        ...mapInitOptions,
        center: [-79.3832, 43.6532],
        zoom: 11,
      });
      instance.on('style.load', () => {
        applyPresetVisualTweaks(instance, resolvedMapStyle, {
          preserveLayerPrefixes: ['assigned-routes-', 'route-', 'map-buildings-', 'campaign-', 'flyr-'],
        });
        drawMap(instance);
      });
      mapRef.current = instance;
    };

    void initMap();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [drawMap, resolvedMapStyle]);

  useEffect(() => {
    if (!mapRef.current) return;
    applyResolvedMapStyle(mapRef.current, resolvedMapStyle);
    mapRef.current.once('style.load', () => {
      if (!mapRef.current) return;
      applyPresetVisualTweaks(mapRef.current, resolvedMapStyle, {
        preserveLayerPrefixes: ['assigned-routes-', 'route-', 'map-buildings-', 'campaign-', 'flyr-'],
      });
    });
  }, [resolvedMapStyle]);

  useEffect(() => {
    if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
    drawMap(mapRef.current);
  }, [drawMap]);

  const containerClassName = embedded
    ? 'space-y-4'
    : 'min-h-full bg-muted/30 dark:bg-background';
  const mainClassName = embedded
    ? 'space-y-4'
    : 'w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4';

  if (focusAssignmentId) {
    if (loading) {
      return (
        <div className={containerClassName}>
          <main className="w-full px-4 py-16 flex items-center justify-center min-h-[40vh]">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </main>
        </div>
      );
    }
    const focusAssignment = assignments.find((a) => a.id === focusAssignmentId);
    if (!focusAssignment) {
      return (
        <div className={containerClassName}>
          <main className={mainClassName}>
            <div className="flex flex-col items-center justify-center min-h-[280px] px-6 text-center">
              <p className="text-sm font-medium text-foreground mb-1">Route not found</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                This assignment is not in your workspace or you do not have access.
              </p>
            </div>
          </main>
        </div>
      );
    }

    const detailLoading = detailLoadingByAssignmentId[focusAssignment.id] === true;
    const focusDetail = detailByAssignmentId[focusAssignment.id];
    const allStops = focusDetail?.stops ?? [];
    const planStops = focusAssignment.route_plan?.total_stops ?? 0;
    const houseCount =
      allStops.length > 0 ? allStops.length : detailLoading ? planStops : 0;
    const streetsLabel =
      detailLoading && allStops.length === 0 ? '—' : String(countUniqueStreetsFromStops(allStops));
    const visitedLabel =
      detailLoading && allStops.length === 0 ? '—' : visitedPercentLabelFromStops(allStops);
    const dueLabel = formatAssignmentDue(focusAssignment.due_at);
    const routeTitle = focusAssignment.route_plan?.name?.trim() || 'Route';

    const knownVisited = allStops.filter((s) => s.visited === true || s.visited === false);
    const visitedDone = knownVisited.filter((s) => s.visited === true).length;
    const visitedSubtext =
      detailLoading && allStops.length === 0
        ? 'loading visit status…'
        : knownVisited.length === 0
          ? 'no linked addresses yet'
          : `${visitedDone} of ${knownVisited.length} stops marked`;

    return (
      <div className={containerClassName}>
        <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {error ? <p className="text-sm text-destructive text-center">{error}</p> : null}
          <h1 className="text-2xl font-bold text-foreground text-center tracking-tight">{routeTitle}</h1>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <RouteStatsMetricCard
              label="Houses"
              value={String(houseCount)}
              subtext="stops on this route"
            />
            <RouteStatsMetricCard
              label="Streets"
              value={streetsLabel}
              subtext="unique street names"
            />
            <RouteStatsMetricCard
              label="Visited"
              value={visitedLabel}
              subtext={visitedSubtext}
              valueClassName={
                visitedLabel !== '—' ? 'text-green-600 dark:text-green-500' : undefined
              }
            />
            <RouteStatsMetricCard
              label="Due date"
              value={dueLabel}
              subtext={focusAssignment.due_at ? 'assignment deadline' : 'no due date set'}
            />
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden h-[560px]">
            <RouteAssignmentMapFrame
              mapContainerRef={mapContainer}
              mapViewMode={mapViewMode}
              onMapViewMode={setMapViewMode}
              mapData={mapData}
              className="h-full rounded-none border-0"
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <main className={mainClassName}>
        {!embedded && !focusAssignmentId ? (
          <div>
            <h1 className="text-2xl font-bold text-foreground">Routes</h1>
            <p className="text-sm text-muted-foreground">Assigned routes by status.</p>
          </div>
        ) : null}

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">
                {focusAssignmentId ? 'Route details' : 'Assigned Routes'}
              </CardTitle>
              {!focusAssignmentId ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={statusFilter === 'active' ? 'default' : 'outline'}
                    onClick={() => setStatusFilter('active')}
                  >
                    Active
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={statusFilter === 'completed' ? 'default' : 'outline'}
                    onClick={() => setStatusFilter('completed')}
                  >
                    Completed
                  </Button>
                </div>
              ) : null}
            </div>
            <div
              className={cn(
                'grid gap-2 pt-2',
                focusAssignmentId ? 'sm:grid-cols-1' : 'sm:grid-cols-2'
              )}
            >
              {!focusAssignmentId ? (
                <Input
                  value={routeFilter}
                  onChange={(event) => setRouteFilter(event.target.value)}
                  placeholder="Filter routes..."
                />
              ) : null}
              <Input
                value={houseFilter}
                onChange={(event) => setHouseFilter(event.target.value)}
                placeholder="Filter houses..."
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">Loading routes...</p> : null}
            {!loading && filteredAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {statusFilter === 'active' ? 'active' : 'completed'} routes.
              </p>
            ) : null}
            {filteredAssignments.map((assignment) => {
              const campaignId = assignment.route_plan?.campaign_id;
              const isExpanded = expandedAssignmentId === assignment.id;
              const detail = detailByAssignmentId[assignment.id];
              const detailLoading = detailLoadingByAssignmentId[assignment.id] === true;
              const visibleStops =
                houseFilter.trim().length > 0
                  ? (detail?.stops ?? []).filter((stop) =>
                      (stop.display_address ?? '').toLowerCase().includes(houseFilter.trim().toLowerCase())
                    )
                  : (detail?.stops ?? []);
              return (
                <div
                  key={assignment.id}
                  className="w-full text-left rounded-md border border-border px-3 py-2 transition hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        if (focusAssignmentId === assignment.id) return;
                        const next = isExpanded ? null : assignment.id;
                        setExpandedAssignmentId(next);
                        if (next) void loadAssignmentDetail(next);
                      }}
                    >
                      <p className="text-sm font-medium text-foreground truncate">
                        {assignment.route_plan?.name ?? 'Route plan'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(assignment.route_plan?.total_stops ?? 0).toLocaleString()} homes
                        {assignment.route_plan?.est_minutes ? ` • ~${assignment.route_plan.est_minutes} min` : ''}
                        {assignment.due_at ? ` • due ${new Date(assignment.due_at).toLocaleDateString()}` : ''}
                      </p>
                    </button>
                    {campaignId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/campaigns/${campaignId}`)}
                      >
                        Open campaign
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="outline">{statusLabel(assignment.status)}</Badge>
                    {assignment.priority ? <Badge variant="secondary">{assignment.priority}</Badge> : null}
                    {assignment.assignee?.display_name ? (
                      <Badge variant="outline">{assignment.assignee.display_name}</Badge>
                    ) : null}
                    {!campaignId ? <Badge variant="destructive">No campaign</Badge> : null}
                  </div>
                  {isExpanded ? (
                    <div className="mt-3 rounded-xl border border-border/70 bg-muted/15 dark:bg-muted/10 px-3 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                        <p className="text-xs font-semibold text-foreground tracking-tight">Stops</p>
                        {detail && !detailLoading && visibleStops.length > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {(() => {
                              const known = visibleStops.filter((s) => s.visited !== null && s.visited !== undefined);
                              const done = known.filter((s) => s.visited === true).length;
                              if (known.length === 0) return `${visibleStops.length} homes`;
                              const pct = Math.round((done / known.length) * 100);
                              return `${done}/${known.length} visited (${pct}%)`;
                            })()}
                          </p>
                        ) : null}
                      </div>
                      {detailLoading ? (
                        <p className="text-xs text-muted-foreground py-6 text-center">Loading stops...</p>
                      ) : visibleStops.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                          {visibleStops.map((stop) => (
                            <RouteStopSquareCard
                              key={stop.id}
                              stop={stop}
                              dueAt={assignment.due_at}
                              showOrder
                            />
                          ))}
                        </div>
                      ) : houseFilter.trim().length > 0 ? (
                        <p className="text-xs text-muted-foreground py-6 text-center">No stops match your filter.</p>
                      ) : (
                        <p className="text-xs text-muted-foreground py-6 text-center">No stops for this route.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assigned Route Map</CardTitle>
          </CardHeader>
          <CardContent>
            <RouteAssignmentMapFrame
              mapContainerRef={mapContainer}
              mapViewMode={mapViewMode}
              onMapViewMode={setMapViewMode}
              mapData={mapData}
              className="rounded-md"
            />
          </CardContent>
        </Card>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </main>
    </div>
  );
}
