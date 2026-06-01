'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  Map as MapboxMap,
} from 'mapbox-gl';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@/lib/supabase/client';
import type { BuildingFeatureCollection, BuildingProperties, GetBuildingsInBboxParams } from '@/types/map-buildings';
import type { CampaignAddress, CampaignType } from '@/types/database';
import { getCampaignBuildingStatus } from '@/lib/campaignStats';
import {
  CONVERSATION_ADDRESS_STATUSES,
  DEFAULT_STATUS_FILTERS,
  HOT_LEAD_ADDRESS_STATUSES,
  LEAD_ADDRESS_STATUSES,
  MAP_STATUS_CONFIG,
  NO_ONE_HOME_ADDRESS_STATUSES,
  TOUCHED_ADDRESS_STATUSES,
  UNTOUCHED_ADDRESS_STATUSES,
  getMapUntouchedColor,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import { displayAddressText, resolveHouseNumberLabel } from '@/lib/map/addressPresentation';

interface MapBuildingsLayerProps {
  map: MapboxMap;
  campaignId?: string | null;
  campaignType?: CampaignType | null;
  refreshKey?: number;
  buildingFeatures?: BuildingFeatureCollection | null;
  buildingDataKey?: string | number | null;
  addressStateOverrides?: CampaignAddress[];
  hiddenBuildingIds?: string[];
  deletedAddressIds?: string[];
  campaignBoundary?: GeoJSON.Polygon | null;
  campaignBbox?: [number, number, number, number] | null;
  statusFilters?: StatusFilters;
  assignmentColorByAddressId?: Record<string, string>;
  showOrphans?: boolean; // Toggle to show/hide orphan buildings (buildings without address links)
  showAddressLabels?: boolean;
  /** When false, footprints use a neutral gray (not status colors); roads unchanged. Default true. */
  footprintStatusColors?: boolean;
  isDarkMap?: boolean;
  onBuildingClick?: (
    buildingId: string,
    addressId?: string,
    options?: {
      additive?: boolean;
    }
  ) => void;
  onAddToCRM?: (data: { address: string; addressId?: string; gersId?: string; campaignId?: string }) => void;
  onRenderStateChange?: (state: MapBuildingsRenderState) => void;
}

export type MapBuildingsRenderState = {
  isFetching: boolean;
  hasData: boolean;
  hasVisibleFeatures: boolean;
  hasBuildingPolygons: boolean;
  buildingsUnavailable: boolean;
  featureCount: number;
  visibleFeatureCount: number;
  zoomLevel: number;
};

const defaultStatusFilters: StatusFilters = DEFAULT_STATUS_FILTERS;

/** Scale factor for building footprints (1 = unchanged, <1 = skinnier). */
const FOOTPRINT_SCALE = 1;
const EMPTY_BUILDINGS_MAX_RETRIES = 5;
const EMPTY_BUILDINGS_RETRY_BASE_DELAY_MS = 3000;
const ADDRESS_LABEL_MIN_ZOOM = 18;
const CAMPAIGN_BUILDING_MIN_ZOOM = 0;
const DEFAULT_BUILDING_HEIGHT_METERS = 8;
const POLYGON_GEOMETRY_FILTER: FilterSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
] as FilterSpecification;
const POINT_GEOMETRY_FILTER: FilterSpecification = ['==', ['geometry-type'], 'Point'];
const INFERRED_BUILDING_LINK_MAX_DISTANCE_M = 45;

type CampaignMapBundleResponse = {
  asset_signature?: string | null;
  source_version?: string | null;
  status?: string | null;
  phase?: string | null;
  buildings?: BuildingFeatureCollection | null;
  counts?: {
    buildings?: number | null;
  } | null;
};

function asBuildingFeatureCollection(value: unknown): BuildingFeatureCollection {
  const candidate = value as { type?: unknown; features?: unknown } | null;
  if (candidate?.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
    return candidate as BuildingFeatureCollection;
  }
  return { type: 'FeatureCollection', features: [] } as BuildingFeatureCollection;
}

/**
 * Scale a polygon ring toward a centroid by a factor (in place).
 */
function scaleRing(
  ring: number[][],
  cx: number,
  cy: number,
  scale: number
): void {
  for (let i = 0; i < ring.length; i++) {
    ring[i][0] = cx + (ring[i][0] - cx) * scale;
    ring[i][1] = cy + (ring[i][1] - cy) * scale;
  }
}

/**
 * Compute centroid of a ring (average of coordinates).
 */
function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0, sy = 0;
  const n = ring.length;
  if (n === 0) return [0, 0];
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

/**
 * Scale polygon or multi-polygon geometry toward its centroid(s) to make footprints skinnier.
 */
function scaleFootprint(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, scale: number): void {
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates;
    if (coords.length > 0) {
      const [cx, cy] = ringCentroid(coords[0]);
      coords.forEach((ring) => scaleRing(ring, cx, cy, scale));
    }
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((poly) => {
      if (poly.length > 0) {
        const [cx, cy] = ringCentroid(poly[0]);
        poly.forEach((ring) => scaleRing(ring, cx, cy, scale));
      }
    });
  }
}

function getAddressCoordinate(address: CampaignAddress): [number, number] | null {
  if (address.coordinate) {
    const { lon, lat } = address.coordinate;
    if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
      return [lon, lat];
    }
  }

  const addressWithGeo = address as CampaignAddress & { geometry?: unknown; geom_json?: unknown };

  if (
    addressWithGeo.geom_json &&
    typeof addressWithGeo.geom_json === 'object' &&
    (addressWithGeo.geom_json as GeoJSON.Point).type === 'Point'
  ) {
    const coords = (addressWithGeo.geom_json as GeoJSON.Point).coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lon, lat] = coords;
      if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
        return [lon, lat];
      }
    }
  }

  let geometry = addressWithGeo.geometry;
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry);
    } catch {
      geometry = null;
    }
  }

  if (
    geometry &&
    typeof geometry === 'object' &&
    (geometry as GeoJSON.Point).type === 'Point' &&
    Array.isArray((geometry as GeoJSON.Point).coordinates)
  ) {
    const [lon, lat] = (geometry as GeoJSON.Point).coordinates;
    if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
      return [lon, lat];
    }
  }

  return null;
}

function pointOnRingSegment(point: [number, number], start: number[], end: number[]): boolean {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  if (![px, py, x1, y1, x2, y2].every(Number.isFinite)) return false;

  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-12) return false;

  return (
    px >= Math.min(x1, x2) - 1e-12 &&
    px <= Math.max(x1, x2) + 1e-12 &&
    py >= Math.min(y1, y2) - 1e-12 &&
    py <= Math.max(y1, y2) + 1e-12
  );
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i];
    const previous = ring[j];
    if (!Array.isArray(current) || !Array.isArray(previous)) continue;
    if (pointOnRingSegment(point, previous, current)) return true;

    const xi = Number(current[0]);
    const yi = Number(current[1]);
    const xj = Number(previous[0]);
    const yj = Number(previous[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygonGeometry(point: [number, number], polygon: GeoJSON.Polygon): boolean {
  const [outerRing, ...holes] = polygon.coordinates;
  if (!pointInRing(point, outerRing)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function geometryContainsPoint(geometry: GeoJSON.Geometry | null | undefined, point: [number, number]): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygonGeometry(point, geometry);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((coordinates) =>
      pointInPolygonGeometry(point, { type: 'Polygon', coordinates })
    );
  }
  return false;
}

function geometryCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'GeometryCollection') {
    const centers = geometry.geometries
      .map((candidate) => geometryCenter(candidate))
      .filter((center): center is [number, number] => Boolean(center));
    if (centers.length === 0) return null;
    const lon = centers.reduce((sum, center) => sum + center[0], 0) / centers.length;
    const lat = centers.reduce((sum, center) => sum + center[1], 0) / centers.length;
    return [lon, lat];
  }

  const positions: Array<[number, number]> = [];
  const collect = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === 'number' &&
      typeof coordinates[1] === 'number'
    ) {
      positions.push([coordinates[0], coordinates[1]]);
      return;
    }
    coordinates.forEach(collect);
  };

  collect(geometry.coordinates);
  const validPositions = positions.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (validPositions.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of validPositions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const latRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(Math.cos(latRad), 0.01) * 111_320;
  const dx = (a[0] - b[0]) * metersPerDegreeLon;
  const dy = (a[1] - b[1]) * metersPerDegreeLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function getFeatureIdentifiers(feature: GeoJSON.Feature): string[] {
  const props = toRecord(feature.properties);
  return [
    props.feature_id,
    props.building_id,
    props.gers_id,
    props.id,
    feature.id,
  ]
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function getExplicitAddressBuildingIds(address: CampaignAddress): string[] {
  return [
    (address as CampaignAddress & { building_id?: string | null }).building_id,
    address.building_gers_id,
    address.gers_id,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

function buildInferredAddressAssignments(
  features: GeoJSON.Feature[],
  addresses?: CampaignAddress[]
): Map<string, CampaignAddress[]> {
  const assignments = new Map<string, CampaignAddress[]>();
  if (!addresses?.length || features.length === 0) return assignments;

  const candidates = features.flatMap((feature) => {
    const key = getFeatureIdentifiers(feature)[0];
    const geometry = feature.geometry;
    if (!key || (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon')) return [];
    return [{
      key,
      feature,
      identifiers: new Set(getFeatureIdentifiers(feature)),
      center: geometryCenter(geometry),
    }];
  });

  const assign = (key: string, address: CampaignAddress) => {
    const group = assignments.get(key) ?? [];
    if (!group.some((item) => item.id === address.id)) {
      group.push(address);
      assignments.set(key, group);
    }
  };

  for (const address of addresses) {
    const coordinate = getAddressCoordinate(address);
    if (!coordinate) continue;

    const explicitIds = getExplicitAddressBuildingIds(address);
    const exactMatch = explicitIds.length
      ? candidates.find((candidate) => explicitIds.some((id) => candidate.identifiers.has(id)))
      : undefined;
    if (exactMatch) {
      assign(exactMatch.key, address);
      continue;
    }

    const containingMatches = candidates.filter((candidate) =>
      geometryContainsPoint(candidate.feature.geometry, coordinate)
    );
    if (containingMatches.length > 0) {
      const bestContaining = containingMatches
        .map((candidate) => ({
          candidate,
          distance: candidate.center ? distanceMeters(coordinate, candidate.center) : 0,
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (bestContaining) assign(bestContaining.key, address);
      continue;
    }

    const nearest = candidates
      .map((candidate) => ({
        candidate,
        distance: candidate.center ? distanceMeters(coordinate, candidate.center) : Infinity,
      }))
      .filter((match) => match.distance <= INFERRED_BUILDING_LINK_MAX_DISTANCE_M)
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;

    if (nearest) assign(nearest.key, address);
  }

  return assignments;
}

function buildAddressLabelFeatureCollection(
  addresses?: CampaignAddress[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: (addresses ?? []).flatMap((address) => {
      const houseNumber = resolveHouseNumberLabel(address);
      const coordinates = getAddressCoordinate(address);

      if (!houseNumber || !coordinates) {
        return [];
      }

      return [{
        type: 'Feature',
        id: address.id,
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          id: address.id,
          address_id: address.id,
          feature_id: address.id,
          house_number: houseNumber,
        },
      }];
    }),
  };
}

function safeGetSource(map: MapboxMap, sourceId: string): boolean {
  try {
    return Boolean(map.getSource(sourceId));
  } catch {
    return false;
  }
}

function combineMapFilters(...filters: Array<FilterSpecification | undefined | null>): FilterSpecification {
  const activeFilters = filters.filter(Boolean) as FilterSpecification[];
  if (activeFilters.length === 0) return ['all'];
  if (activeFilters.length === 1) return activeFilters[0];
  return ['all', ...activeFilters] as FilterSpecification;
}

function getCampaignBuildingScopeKey(addresses?: CampaignAddress[]): string {
  if (!addresses?.length) return 'unscoped';

  const values = new Set<string>();
  for (const address of addresses) {
    const record = address as CampaignAddress & {
      address_id?: string | null;
      building_id?: string | null;
      source_id?: string | null;
    };

    for (const value of [
      record.id,
      record.address_id,
      record.building_id,
      record.building_gers_id,
    ]) {
      const normalized = String(value ?? '').trim();
      if (normalized) values.add(normalized);
    }
  }

  return values.size > 0 ? Array.from(values).sort().join('|') : 'unscoped';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function getStringRecordValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function safeRemoveLayer(map: MapboxMap, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // Ignore transient style teardown errors.
  }
}

function safeRemoveSource(map: MapboxMap, sourceId: string) {
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    // Ignore transient style teardown errors.
  }
}

function ensure3dBuildingCamera(map: MapboxMap) {
  try {
    if (map.getPitch() >= 35) return;
    map.easeTo({
      pitch: 45,
      duration: 500,
      essential: true,
    });
  } catch {
    // Camera changes are best-effort; the layer should still render without them.
  }
}

function setBuildingsDebug(debug: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  (window as Window & { __flyrBuildingsDebug?: Record<string, unknown> }).__flyrBuildingsDebug = {
    ...(window as Window & { __flyrBuildingsDebug?: Record<string, unknown> }).__flyrBuildingsDebug,
    ...debug,
    updatedAt: new Date().toISOString(),
  };
}

function getFeatureCollectionBbox(features: GeoJSON.Feature[]): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const collect = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === 'number' &&
      typeof coordinates[1] === 'number'
    ) {
      minLon = Math.min(minLon, coordinates[0]);
      minLat = Math.min(minLat, coordinates[1]);
      maxLon = Math.max(maxLon, coordinates[0]);
      maxLat = Math.max(maxLat, coordinates[1]);
      return;
    }
    coordinates.forEach(collect);
  };

  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry || geometry.type === 'GeometryCollection') return;
    collect(geometry.coordinates);
  });
  return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
    ? [minLon, minLat, maxLon, maxLat]
    : null;
}

export function MapBuildingsLayer({
  map,
  campaignId,
  refreshKey = 0,
  buildingFeatures,
  buildingDataKey,
  addressStateOverrides,
  hiddenBuildingIds = [],
  deletedAddressIds = [],
  statusFilters = defaultStatusFilters,
  assignmentColorByAddressId,
  showOrphans = true,
  showAddressLabels = true,
  footprintStatusColors = true,
  isDarkMap = false,
  onBuildingClick,
  onAddToCRM,
  onRenderStateChange,
}: MapBuildingsLayerProps) {
  const [features, setFeatures] = useState<BuildingFeatureCollection | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(15);
  const sourceId = 'map-buildings-source';
  const surfaceLayerId = 'map-buildings-surface';
  const layerId = 'map-buildings-extrusion';
  const shadowLayerId = 'map-buildings-shadow';
  const leadGlowLayerId = 'map-buildings-lead-glow';
  const outlineLayerId = 'map-buildings-outline';
  const circleLayerId = 'map-buildings-extrusion-points';
  const circleLeadGlowLayerId = 'map-buildings-lead-glow-points';
  const addressLabelSourceId = 'map-address-centroid-label-source';
  const addressLabelLayerId = 'map-address-centroid-labels';
  const untouchedBuildingColor = getMapUntouchedColor(isDarkMap);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const isCanonicalBundleControlled = buildingFeatures !== undefined;
  const useCanonicalAddressState = Boolean(addressStateOverrides?.length);
  const assignmentColorByBuildingId = useMemo(() => {
    const colors = new Map<string, string>();
    if (!addressStateOverrides?.length || !assignmentColorByAddressId) return colors;

    for (const address of addressStateOverrides) {
      const color = assignmentColorByAddressId[address.id];
      if (!color) continue;

      [
        address.building_id,
        address.building_gers_id,
        address.gers_id,
        address.source_id,
      ].forEach((value) => {
        const normalized = String(value ?? '').trim();
        if (normalized) colors.set(normalized, color);
      });
    }

    return colors;
  }, [addressStateOverrides, assignmentColorByAddressId]);

  const getSupabase = useCallback(() => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    return supabaseRef.current;
  }, []);
  
  // Debounce fetching to prevent spamming Supabase during rapid panning
  const fetchTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMountedRef = useRef(true);
  // Geometry is precomputed once when features are fetched.
  // This eliminates the JSON.parse deep-clone + scaleFootprint call from the hot update path.
  const normalizedFeaturesRef = useRef<BuildingFeatureCollection | null>(null);
  const lastSetDataRef = useRef<BuildingFeatureCollection | null>(null);
  const renderedGeojsonKeyRef = useRef<string | null>(null);
  const onBuildingClickRef = useRef(onBuildingClick);
  const onRenderStateChangeRef = useRef(onRenderStateChange);
  const isFetchingRef = useRef(isFetching);
  const emptyFallbackRetryRef = useRef<number | null>(null);
  const emptyFallbackRetryCountRef = useRef(0);
  const emptyFallbackRetryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    onBuildingClickRef.current = onBuildingClick;
  }, [onBuildingClick]);

  useEffect(() => {
    onRenderStateChangeRef.current = onRenderStateChange;
  }, [onRenderStateChange]);

  useEffect(() => {
    isFetchingRef.current = isFetching;
  }, [isFetching]);

  useEffect(() => {
    setBuildingsDebug({
      mounted: true,
      campaignId,
      hasMap: Boolean(map),
      mapStyleLoaded: Boolean(map?.isStyleLoaded()),
      featureCountAtMount: features?.features.length ?? 0,
    });
  }, [campaignId, features, map]);

  useEffect(() => {
    if (!map || !campaignId || !features?.features?.length || !addressStateOverrides?.length) return;

    let cancelled = false;
    let frameId: number | null = null;

    const addressStateById = new Map(
      addressStateOverrides.map((address) => [
        address.id,
        {
          status: getCampaignBuildingStatus(address),
          scans_total: Number(address.scans ?? 0),
          qr_scanned: Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at),
          assignment_color: assignmentColorByAddressId?.[address.id],
        },
      ])
    );

    const buildingStateById = new Map<
      string,
      {
        status: 'not_visited' | 'visited' | 'hot' | 'lead' | 'hot_lead' | 'no_answer' | 'do_not_knock';
        scans_total: number;
        qr_scanned: boolean;
        assignment_color?: string;
      }
    >();

    const statusRank = { not_visited: 0, visited: 1, no_answer: 2, do_not_knock: 3, hot: 4, lead: 5, hot_lead: 6 } as const;

    for (const address of addressStateOverrides) {
      const buildingId =
        (address as CampaignAddress & { building_id?: string | null }).building_id ??
        address.gers_id ??
        null;
      if (!buildingId) continue;

      const nextState = {
        status: getCampaignBuildingStatus(address),
        scans_total: Number(address.scans ?? 0),
        qr_scanned: Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at),
        assignment_color: assignmentColorByAddressId?.[address.id],
      };
      const currentState = buildingStateById.get(buildingId);

      if (!currentState) {
        buildingStateById.set(buildingId, nextState);
        continue;
      }

      buildingStateById.set(buildingId, {
        status:
          statusRank[nextState.status] > statusRank[currentState.status]
            ? nextState.status
            : currentState.status,
        scans_total: currentState.scans_total + nextState.scans_total,
        qr_scanned: currentState.qr_scanned || nextState.qr_scanned,
        assignment_color: currentState.assignment_color ?? nextState.assignment_color,
      });
    }

    const applyOverrides = (attempt = 0) => {
      if (cancelled) return;

      if (!safeGetSource(map, sourceId)) {
        if (attempt < 5) {
          frameId = requestAnimationFrame(() => applyOverrides(attempt + 1));
        }
        return;
      }

      for (const feature of features.features) {
        const props = feature.properties ?? {};
        const featureId = props.feature_id ?? props.gers_id ?? feature.id ?? props.id;
        if (!featureId) continue;

        const assignmentColor =
          (props.address_id && assignmentColorByAddressId?.[props.address_id]) ||
          (props.building_id && assignmentColorByBuildingId.get(String(props.building_id))) ||
          (props.gers_id && assignmentColorByBuildingId.get(String(props.gers_id))) ||
          undefined;
        const featureState =
          (props.address_id ? addressStateById.get(props.address_id) : undefined) ??
          (props.building_id ? buildingStateById.get(props.building_id) : undefined) ??
          (props.gers_id ? buildingStateById.get(props.gers_id) : undefined);

        const nextFeatureState = featureState || assignmentColor ? {
          ...(featureState ?? {}),
          ...(assignmentColor ? { assignment_color: assignmentColor } : {}),
        } : null;

        if (!nextFeatureState) continue;

        try {
          map.setFeatureState({ source: sourceId, id: featureId }, nextFeatureState);
        } catch (error) {
          console.warn('[MapBuildingsLayer] Failed to apply canonical address state override:', error);
        }
      }
    };

    applyOverrides();

    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [map, campaignId, features, addressStateOverrides, assignmentColorByAddressId, assignmentColorByBuildingId]);

  // Status toggles now control color emphasis (not visibility).
  // Non-selected statuses render as neutral gray baseline.
  const getFilterExpression = (): FilterSpecification | undefined => {
    return undefined;
  };

  const getScopedGeometryFilter = (
    geometryFilter: FilterSpecification,
    filterExpr?: FilterSpecification
  ): FilterSpecification => {
    // Canonical map-bundle GeoJSON is already campaign-scoped server-side.
    // Keep only the geometry filter plus optional status/selection filters.
    return filterExpr ? combineMapFilters(geometryFilter, filterExpr) : geometryFilter;
  };

  // Generate unified color expression based on status priority
  // Priority: QR_SCANNED > HOT_LEADS > LEADS > CONVERSATIONS > DO_NOT_KNOCK > NO_ONE_HOME > TOUCHED > UNTOUCHED
  // Uses ['feature-state', ...] for real-time updates via setFeatureState(),
  // with fallback to ['get', ...] for initial data from properties
  const getColorExpression = (): ExpressionSpecification => {
    // Helper expressions - check feature-state first (real-time), then source properties (initial load)
    const getAssignmentColor = () => ['coalesce', ['feature-state', 'assignment_color'], ['get', 'assignment_color'], ''];
    const getStatusValue = () => ['downcase', ['to-string', ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited']]];
    const getAddressStatus = () => ['downcase', ['to-string', ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none']]];
    const getScansTotal = () => ['to-number', ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0], 0];
    const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
    const isQrScanned = ['any', ['==', getQrScanned(), true], ['==', getQrScanned(), 'true'], ['>', getScansTotal(), 0]];
    const isHotLead = [
      'any',
      ['==', getStatusValue(), 'hot_lead'],
      ['in', getAddressStatus(), ['literal', HOT_LEAD_ADDRESS_STATUSES]],
    ];
    const isLead = ['any', ['==', getStatusValue(), 'lead'], ['in', getAddressStatus(), ['literal', LEAD_ADDRESS_STATUSES]]];
    const isConversation = ['any', ['==', getStatusValue(), 'hot'], ['in', getAddressStatus(), ['literal', CONVERSATION_ADDRESS_STATUSES]]];
    const isDoNotKnock = ['any', ['==', getStatusValue(), 'do_not_knock'], ['==', getAddressStatus(), 'do_not_knock']];
    const isNoOneHome = ['any', ['==', getStatusValue(), 'no_answer'], ['in', getAddressStatus(), ['literal', NO_ONE_HOME_ADDRESS_STATUSES]]];
    const isTouched = ['any', ['==', getStatusValue(), 'visited'], ['in', getAddressStatus(), ['literal', TOUCHED_ADDRESS_STATUSES]]];
    const isUntouched = ['all', ['==', getStatusValue(), 'not_visited'], ['in', getAddressStatus(), ['literal', UNTOUCHED_ADDRESS_STATUSES]]];
    
    return [
      'case',
      ['!=', getAssignmentColor(), ''],
      getAssignmentColor(),

      // QR_SCANNED (highest priority)
      ['all', isQrScanned, statusFilters.QR_SCANNED],
      MAP_STATUS_CONFIG.QR_SCANNED.color,

      ['all', isHotLead, statusFilters.HOT_LEADS],
      MAP_STATUS_CONFIG.HOT_LEADS.color,

      ['all', isLead, statusFilters.LEADS],
      MAP_STATUS_CONFIG.LEADS.color,
      
      ['all', isConversation, statusFilters.CONVERSATIONS],
      MAP_STATUS_CONFIG.CONVERSATIONS.color,

      ['all', isDoNotKnock, statusFilters.DO_NOT_KNOCK],
      MAP_STATUS_CONFIG.DO_NOT_KNOCK.color,

      ['all', isNoOneHome, statusFilters.NO_ONE_HOME],
      MAP_STATUS_CONFIG.NO_ONE_HOME.color,
      
      ['all', isTouched, statusFilters.TOUCHED],
      MAP_STATUS_CONFIG.TOUCHED.color,
      
      ['all', isUntouched, statusFilters.UNTOUCHED],
      untouchedBuildingColor,

      // Baseline when no toggle applies
      NEUTRAL_FOOTPRINT_COLOR,
    ] as ExpressionSpecification;
  };

  const getLeadGlowOpacityExpression = (): ExpressionSpecification => {
    const getStatusValue = () => ['downcase', ['to-string', ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited']]];
    const getAddressStatus = () => ['downcase', ['to-string', ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none']]];
    const isLead = ['any', ['==', getStatusValue(), 'lead'], ['in', getAddressStatus(), ['literal', LEAD_ADDRESS_STATUSES]]];

    return ['case', ['all', isLead, statusFilters.LEADS], 0.82, 0] as ExpressionSpecification;
  };

  /** Neutral footprint when not using status colors; keep it visually aligned with address cylinders. */
  const NEUTRAL_FOOTPRINT_COLOR = '#6b7280';
  const NEUTRAL_OUTLINE_COLOR = '#111827';
  const NEUTRAL_EXTRUSION_OPACITY = 1;
  const NEUTRAL_CIRCLE_OPACITY = 0.88;
  const NEUTRAL_EXTRUSION_EMISSIVE_STRENGTH = 1;
  const getFootprintFillColor = (): string | ExpressionSpecification =>
    footprintStatusColors ? getColorExpression() : NEUTRAL_FOOTPRINT_COLOR;
  const getFootprintFillOpacity = (): number =>
    footprintStatusColors ? 1 : NEUTRAL_EXTRUSION_OPACITY;
  const getCircleOpacity = (): number =>
    footprintStatusColors ? 0.9 : NEUTRAL_CIRCLE_OPACITY;
  const getFootprintVerticalGradient = (): boolean => false;
  const getFootprintEmissiveStrength = (): number =>
    footprintStatusColors ? 0.85 : NEUTRAL_EXTRUSION_EMISSIVE_STRENGTH;
  const forceBuildingLayerVisibility = () => {
    for (const id of [surfaceLayerId, layerId, leadGlowLayerId, outlineLayerId, circleLeadGlowLayerId, circleLayerId]) {
      try {
        if (map?.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', 'visible');
        }
      } catch {
        // Mapbox can transiently reject layer reads during style swaps.
      }
    }
  };

  // Track if campaign data has been loaded (for "fetch once, render forever" pattern)
  const campaignDataLoadedRef = useRef<string | null>(null);

  const cleanupRenderedLayers = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, addressLabelLayerId);
    safeRemoveLayer(map, circleLayerId);
    safeRemoveLayer(map, circleLeadGlowLayerId);
    safeRemoveLayer(map, outlineLayerId);
    safeRemoveLayer(map, leadGlowLayerId);
    safeRemoveLayer(map, layerId);
    safeRemoveLayer(map, surfaceLayerId);
    safeRemoveLayer(map, shadowLayerId);
    safeRemoveSource(map, addressLabelSourceId);
    safeRemoveSource(map, sourceId);
  }, [map, addressLabelLayerId, circleLayerId, circleLeadGlowLayerId, outlineLayerId, leadGlowLayerId, layerId, surfaceLayerId, shadowLayerId, addressLabelSourceId, sourceId]);

  // CAMPAIGN MODE: Fetch canonical map-bundle buildings once (no viewport filtering).
  // The old display-time /buildings path is intentionally bypassed; bundles are the source of truth.
  const fetchCampaignData = useCallback(async () => {
    if (!isMountedRef.current || !campaignId || isCanonicalBundleControlled) return;

    setIsFetching(true);
    const campaignDataKey = `${campaignId}:${refreshKey}:${getCampaignBuildingScopeKey(addressStateOverrides)}:map-bundle`;
    if (emptyFallbackRetryKeyRef.current !== campaignDataKey) {
      emptyFallbackRetryKeyRef.current = campaignDataKey;
      emptyFallbackRetryCountRef.current = 0;
    }

    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/map-bundle`, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(`Campaign map-bundle request failed with status ${response.status}`);
      }

      const bundle = await response.json() as CampaignMapBundleResponse;
      const normalizedCampaignFeatures = asBuildingFeatureCollection(bundle.buildings);
      const campaignFeatureCount = normalizedCampaignFeatures.features.length;
      setBuildingsDebug({
        source: 'campaign-map-bundle',
        campaignId,
        assetSignature: bundle.asset_signature ?? null,
        sourceVersion: bundle.source_version ?? null,
        bundleStatus: bundle.status ?? null,
        bundlePhase: bundle.phase ?? null,
        featureCount: campaignFeatureCount,
        firstFeatureId:
          normalizedCampaignFeatures.features[0]?.properties?.gers_id ??
          normalizedCampaignFeatures.features[0]?.properties?.building_id ??
          normalizedCampaignFeatures.features[0]?.id ??
          null,
      });

      campaignDataLoadedRef.current = campaignFeatureCount > 0 ? campaignDataKey : null;
      if (campaignFeatureCount > 0) {
        emptyFallbackRetryCountRef.current = 0;
      }
      setFeatures(normalizedCampaignFeatures);

      if (campaignFeatureCount === 0 && isMountedRef.current) {
        if (emptyFallbackRetryCountRef.current >= EMPTY_BUILDINGS_MAX_RETRIES) {
          console.log('[MapBuildingsLayer] Max retries exhausted, buildings not available');
          onRenderStateChangeRef.current?.({
            isFetching: false,
            hasData: false,
            hasVisibleFeatures: false,
            hasBuildingPolygons: false,
            buildingsUnavailable: true,
            featureCount: 0,
            visibleFeatureCount: 0,
            zoomLevel,
          });
          return;
        }
        if (emptyFallbackRetryRef.current) {
          window.clearTimeout(emptyFallbackRetryRef.current);
        }
        const retryDelay =
          EMPTY_BUILDINGS_RETRY_BASE_DELAY_MS * Math.pow(2, emptyFallbackRetryCountRef.current);
        emptyFallbackRetryCountRef.current += 1;
        emptyFallbackRetryRef.current = window.setTimeout(() => {
          emptyFallbackRetryRef.current = null;
          if (isMountedRef.current) {
            void fetchCampaignData();
          }
        }, retryDelay);
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error in fetchCampaignData:', err);
      campaignDataLoadedRef.current = null;
      setFeatures({ type: 'FeatureCollection', features: [] } as BuildingFeatureCollection);
    } finally {
      if (isMountedRef.current) {
        setIsFetching(false);
      }
    }
  }, [campaignId, refreshKey, addressStateOverrides, getSupabase, isCanonicalBundleControlled]);

  useEffect(() => {
    return () => {
      if (emptyFallbackRetryRef.current) {
        window.clearTimeout(emptyFallbackRetryRef.current);
        emptyFallbackRetryRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isCanonicalBundleControlled) return;

    if (emptyFallbackRetryRef.current) {
      window.clearTimeout(emptyFallbackRetryRef.current);
      emptyFallbackRetryRef.current = null;
    }

    const normalizedFeatures = asBuildingFeatureCollection(buildingFeatures);
    const featureCount = normalizedFeatures.features.length;
    const controlledKey = [
      campaignId ?? 'no-campaign',
      refreshKey,
      getCampaignBuildingScopeKey(addressStateOverrides),
      buildingDataKey ?? 'canonical-prop',
      featureCount,
    ].join(':');

    campaignDataLoadedRef.current = featureCount > 0 ? controlledKey : null;
    emptyFallbackRetryKeyRef.current = controlledKey;
    emptyFallbackRetryCountRef.current = 0;
    setIsFetching(false);
    setFeatures(normalizedFeatures);
    setBuildingsDebug({
      source: 'campaign-map-bundle-prop',
      campaignId,
      buildingDataKey: buildingDataKey ?? null,
      featureCount,
      firstFeatureId:
        normalizedFeatures.features[0]?.properties?.gers_id ??
        normalizedFeatures.features[0]?.properties?.building_id ??
        normalizedFeatures.features[0]?.id ??
        null,
    });
  }, [
    addressStateOverrides,
    buildingDataKey,
    buildingFeatures,
    campaignId,
    isCanonicalBundleControlled,
    refreshKey,
  ]);

  // Precompute scaled geometry once per fetch — never inside the render/update effect.
  useEffect(() => {
    if (!features) {
      normalizedFeaturesRef.current = null;
      lastSetDataRef.current = null;
      renderedGeojsonKeyRef.current = null;
      return;
    }

    const hiddenBuildingIdSet = new Set(
      hiddenBuildingIds
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    );
    const deletedAddressIdSet = new Set(
      deletedAddressIds
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    );

    const inferredAddressAssignments = buildInferredAddressAssignments(features.features, addressStateOverrides);

    normalizedFeaturesRef.current = {
      type: 'FeatureCollection',
      features: features.features.flatMap((f) => {
        const props = f.properties ?? {};
        const propsRecord = toRecord(props);
        const fid = props.feature_id ?? props.gers_id ?? f.id ?? getStringRecordValue(propsRecord, 'id');
        const geom = f.geometry;
        const featureAddressId = typeof props.address_id === 'string' ? props.address_id.trim() : '';
        const buildingIdentifiers = [
          props.building_id,
          props.gers_id,
          props.id,
          f.id,
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => value.trim());

        if (featureAddressId && deletedAddressIdSet.has(featureAddressId)) {
          return [];
        }

        if (buildingIdentifiers.some((identifier) => hiddenBuildingIdSet.has(identifier))) {
          return [];
        }

        // Deep-clone geometry ONCE here so we never mutate the source data.
        const scaledGeom =
          geom?.type === 'Polygon' || geom?.type === 'MultiPolygon'
            ? (JSON.parse(JSON.stringify(geom)) as GeoJSON.Polygon | GeoJSON.MultiPolygon)
            : geom;

        if (scaledGeom && (scaledGeom.type === 'Polygon' || scaledGeom.type === 'MultiPolygon')) {
          scaleFootprint(scaledGeom, FOOTPRINT_SCALE);
        }

        const featureKey = String(fid ?? f.id ?? '').trim();
        const stableBuildingId = String(
          props.gers_id ??
            props.building_id ??
            props.id ??
            f.id ??
            featureKey
        ).trim();
        const inferredAddresses = featureKey ? inferredAddressAssignments.get(featureKey) ?? [] : [];
        const primaryInferredAddress = inferredAddresses.length === 1 ? inferredAddresses[0] : null;
        const inferredScansTotal = inferredAddresses.reduce((sum, address) => sum + Number(address.scans ?? 0), 0);
        const statusRank = { not_visited: 0, visited: 1, no_answer: 2, do_not_knock: 3, hot: 4, lead: 5, hot_lead: 6 } as const;
        const inferredStatus = inferredAddresses.reduce<ReturnType<typeof getCampaignBuildingStatus> | null>(
          (current, address) => {
            const next = getCampaignBuildingStatus(address);
            if (!current) return next;
            return statusRank[next] > statusRank[current] ? next : current;
          },
          null
        );
        const existingAddressCount = Number(props.address_count ?? 0);
        const assignmentColor =
          (featureAddressId && assignmentColorByAddressId?.[featureAddressId]) ||
          (primaryInferredAddress?.id && assignmentColorByAddressId?.[primaryInferredAddress.id]) ||
          buildingIdentifiers.map((identifier) => assignmentColorByBuildingId.get(identifier)).find(Boolean);

        return [{
          ...f,
          geometry: (scaledGeom ?? geom) as GeoJSON.Polygon,
          properties: {
            ...props,
            address_count: Math.max(existingAddressCount, inferredAddresses.length),
            address_id: props.address_id ?? primaryInferredAddress?.id ?? null,
            address_text: props.address_text
              ? displayAddressText({
                  formatted: props.address_text,
                  house_number: props.house_number,
                  street_name: props.street_name,
                })
              : primaryInferredAddress
                ? displayAddressText(primaryInferredAddress)
                : null,
            house_number: props.house_number
              ? resolveHouseNumberLabel({
                  house_number: props.house_number,
                  formatted: props.address_text,
                })
              : primaryInferredAddress
                ? resolveHouseNumberLabel(primaryInferredAddress)
                : null,
            street_name: props.street_name ?? primaryInferredAddress?.street_name ?? null,
            address_status: props.address_status ?? primaryInferredAddress?.address_status ?? null,
            feature_status: props.feature_status ?? (inferredAddresses.length > 0 ? 'matched' : undefined),
            match_method: props.match_method ?? (inferredAddresses.length > 0 ? 'visual_inferred' : undefined),
            status: props.status ?? inferredStatus ?? 'not_visited',
            scans_total: Math.max(Number(props.scans_total ?? 0), inferredScansTotal),
            qr_scanned: Boolean(props.qr_scanned) || inferredScansTotal > 0,
            assignment_color: getStringRecordValue(propsRecord, 'assignment_color') ?? assignmentColor ?? undefined,
            gers_id: props.gers_id ?? stableBuildingId,
            building_id: props.building_id ?? stableBuildingId,
            feature_id: props.feature_id ?? stableBuildingId,
          },
        }];
      }),
    } as BuildingFeatureCollection;
    lastSetDataRef.current = null;
  }, [addressStateOverrides, assignmentColorByAddressId, assignmentColorByBuildingId, deletedAddressIds, features, hiddenBuildingIds]);

  // EXPLORATION MODE: Fetch buildings in viewport bounding box (when no campaignId)
  const fetchBuildingsInViewport = useCallback(async (bounds: { ne: [number, number]; sw: [number, number] }) => {
    if (!isMountedRef.current) return;


    try {
      const supabase = getSupabase();
      const rpcParams = {
        min_lon: bounds.sw[0],
        min_lat: bounds.sw[1],
        max_lon: bounds.ne[0],
        max_lat: bounds.ne[1],
        // Keep RPC signature stable across PostgREST schema cache versions.
        p_campaign_id: null,
      };

      const { data, error } = await supabase.rpc('rpc_get_buildings_in_bbox', rpcParams as GetBuildingsInBboxParams);

      if (error) {
        console.error('[MapBuildingsLayer] Error fetching buildings:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }

      if (data && isMountedRef.current) {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        
        console.log('[MapBuildingsLayer] Exploration mode - fetched buildings:', {
          featuresCount: parsedData?.features?.length,
          bounds,
          mode: 'viewport-based',
        });
        
        setFeatures(parsedData as BuildingFeatureCollection);
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error fetching buildings:', err);
    }
  }, [getSupabase]);

  // Handle zoom changes (for layer visibility control)
  // In campaign mode: just track zoom for layer visibility (data already loaded)
  // In exploration mode: track zoom AND trigger viewport fetch
  const onZoomChanged = useCallback(() => {
    if (!map || !isMountedRef.current) return;

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Remove layers if zoomed out too far
    if (!campaignId && zoom < 12) {
      // map.getLayer can throw while Mapbox is rebuilding the style layer registry.
      try {
        if (!map.isStyleLoaded()) return;
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (map.getLayer(leadGlowLayerId)) {
          map.removeLayer(leadGlowLayerId);
        }
        if (map.getLayer(outlineLayerId)) {
          map.removeLayer(outlineLayerId);
        }
        if (map.getLayer(surfaceLayerId)) {
          map.removeLayer(surfaceLayerId);
        }
        if (map.getLayer(circleLayerId)) {
          map.removeLayer(circleLayerId);
        }
        if (map.getLayer(circleLeadGlowLayerId)) {
          map.removeLayer(circleLeadGlowLayerId);
        }
        if (map.getLayer(shadowLayerId)) {
          map.removeLayer(shadowLayerId);
        }
      } catch {
        return;
      }
    }
  }, [map, campaignId, circleLayerId, circleLeadGlowLayerId, outlineLayerId, leadGlowLayerId, layerId, surfaceLayerId, shadowLayerId]);

  // EXPLORATION MODE ONLY: Handle viewport changes (pan/zoom)
  // Campaign mode doesn't use this - data is already fully loaded
  const onViewportChanged = useCallback(() => {
    if (!map || !isMountedRef.current || campaignId) return; // Skip if campaign mode

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Only fetch if zoomed in enough (zoom >= 12 for better visibility)
    if (zoom < 12) {
      // Remove layers if zoomed out too far
      // map.getLayer can throw while Mapbox is rebuilding the style layer registry.
      try {
        if (!map.isStyleLoaded()) return;
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (map.getLayer(leadGlowLayerId)) {
          map.removeLayer(leadGlowLayerId);
        }
        if (map.getLayer(outlineLayerId)) {
          map.removeLayer(outlineLayerId);
        }
        if (map.getLayer(surfaceLayerId)) {
          map.removeLayer(surfaceLayerId);
        }
        if (map.getLayer(circleLayerId)) {
          map.removeLayer(circleLayerId);
        }
        if (map.getLayer(circleLeadGlowLayerId)) {
          map.removeLayer(circleLeadGlowLayerId);
        }
        if (map.getLayer(shadowLayerId)) {
          map.removeLayer(shadowLayerId);
        }
      } catch {
        return;
      }
      return;
    }

    // Debounce fetching to prevent spamming during rapid panning
    if (fetchTimeout.current) {
      clearTimeout(fetchTimeout.current);
    }

    fetchTimeout.current = setTimeout(async () => {
      if (!map || !isMountedRef.current || campaignId) return;

      try {
        const bounds = map.getBounds();
        if (bounds) {
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          await fetchBuildingsInViewport({
            ne: [ne.lng, ne.lat],
            sw: [sw.lng, sw.lat],
          });
        }
      } catch (err) {
        console.error('[MapBuildingsLayer] Error getting map bounds:', err);
      }
    }, 200); // 200ms debounce
  }, [map, campaignId, fetchBuildingsInViewport, surfaceLayerId]);

  // CAMPAIGN MODE: Fetch full campaign data once when campaignId is set
  // This is the "fetch once, render forever" pattern for smooth pan/zoom
  useEffect(() => {
    if (!map || !campaignId || isCanonicalBundleControlled) {
      return;
    }
    
    // Only fetch if we haven't already loaded this campaign's data
    const campaignDataKey = `${campaignId}:${refreshKey}:${getCampaignBuildingScopeKey(addressStateOverrides)}`;
    if (campaignDataLoadedRef.current === campaignDataKey) {
      return;
    }

    const doFetch = () => {
      // Use isStyleLoaded() which is sufficient for our RPC call
      // map.loaded() waits for ALL resources (tiles, etc.) which takes too long
      if (map.isStyleLoaded()) {
        setZoomLevel(map.getZoom());
        fetchCampaignData();
      } else {
        // Use 'style.load' event which fires when style is ready (more reliable than 'load')
        map.once('style.load', () => {
          setZoomLevel(map.getZoom());
          fetchCampaignData();
        });
        
        // Fallback: Also try 'idle' event in case style.load already fired
        const idleHandler = () => {
          if (campaignDataLoadedRef.current !== campaignDataKey) {
            setZoomLevel(map.getZoom());
            fetchCampaignData();
          }
          map.off('idle', idleHandler);
        };
        map.once('idle', idleHandler);
      }
    };
    doFetch();

    // Listen only to zoom changes for layer visibility (not for data fetching)
    map.on('zoomend', onZoomChanged);

    return () => {
      map.off('zoomend', onZoomChanged);
    };
  }, [map, campaignId, fetchCampaignData, onZoomChanged, refreshKey, addressStateOverrides, isCanonicalBundleControlled]);

  // EXPLORATION MODE: Set up viewport event listeners (only when no campaignId)
  useEffect(() => {
    if (!map || campaignId) return; // Skip in campaign mode

    // Listen to camera changes (move, zoom, pitch, rotate) for viewport-based fetching
    map.on('moveend', onViewportChanged);
    map.on('zoomend', onViewportChanged);
    map.on('pitchend', onViewportChanged);
    map.on('rotateend', onViewportChanged);

    // Initial fetch - wait for map to be loaded
    const doInitialFetch = () => {
      if (map.loaded()) {
        onViewportChanged();
      } else {
        map.once('load', onViewportChanged);
      }
    };
    doInitialFetch();

    return () => {
      if (fetchTimeout.current) {
        clearTimeout(fetchTimeout.current);
      }
      map.off('moveend', onViewportChanged);
      map.off('zoomend', onViewportChanged);
      map.off('pitchend', onViewportChanged);
      map.off('rotateend', onViewportChanged);
      map.off('load', onViewportChanged);
    };
  }, [map, campaignId, onViewportChanged]);

  useEffect(() => {
    if (!onRenderStateChange) return;

    const reportRenderState = () => {
      const featureCount = features?.features.length ?? 0;
      const hasBuildingPolygons = Boolean(
        features?.features.some((feature) =>
          feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
        )
      );
      let visibleFeatureCount = 0;

      if (map && map.isStyleLoaded()) {
        try {
          visibleFeatureCount = map.queryRenderedFeatures({
            layers: [layerId, circleLayerId],
          }).length;
        } catch {
          visibleFeatureCount = 0;
        }
      }

      onRenderStateChange({
        isFetching,
        hasData: featureCount > 0,
        hasVisibleFeatures: visibleFeatureCount > 0,
        hasBuildingPolygons,
        buildingsUnavailable:
          emptyFallbackRetryCountRef.current >= EMPTY_BUILDINGS_MAX_RETRIES &&
          featureCount === 0 &&
          Boolean(campaignId),
        featureCount,
        visibleFeatureCount,
        zoomLevel,
      });
    };

    reportRenderState();

    if (!map) return;

    let frameId: number | null = null;
    const scheduleReport = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(reportRenderState);
    };

    map.on('idle', scheduleReport);
    map.on('moveend', scheduleReport);
    map.on('zoomend', scheduleReport);
    map.on('style.load', scheduleReport);

    return () => {
      map.off('idle', scheduleReport);
      map.off('moveend', scheduleReport);
      map.off('zoomend', scheduleReport);
      map.off('style.load', scheduleReport);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [circleLayerId, features, isFetching, layerId, surfaceLayerId, outlineLayerId, map, onRenderStateChange, zoomLevel]);

  // Update Mapbox source and layer when features change
  useEffect(() => {
    // Only bail if map doesn't exist
    if (!map) {
      return;
    }

    let cleanupLayerInteractionHandlers: (() => void) | undefined;

    // Define the update logic as a function we can call or defer
    const updateLayers = (): boolean => {
      const normalizedFeatureCount = normalizedFeaturesRef.current?.features.length ?? 0;
      setBuildingsDebug({
        renderMode: 'geojson-source',
        attachAttempt: true,
        styleLoaded: (() => {
          try {
            return map.isStyleLoaded();
          } catch {
            return false;
          }
        })(),
        normalizedFeatureCount,
      });

      // Check if style is loaded - we need this to add layers
      if (!map.isStyleLoaded()) {
        return false;
      }

      const addressLabelFeatures = buildAddressLabelFeatureCollection(addressStateOverrides);

      // Use precomputed geometry — no clone/rescale on this path.
      const normalizedFeatures = normalizedFeaturesRef.current;

      const geojsonKey = normalizedFeatures
        ? JSON.stringify({
            campaignId,
            count: normalizedFeatures.features.length,
            bbox: getFeatureCollectionBbox(normalizedFeatures.features),
            first:
              normalizedFeatures.features[0]?.properties?.gers_id ??
              normalizedFeatures.features[0]?.properties?.building_id ??
              normalizedFeatures.features[0]?.id ??
              null,
          })
        : null;

      if (
        normalizedFeatures?.features.length &&
        geojsonKey &&
        renderedGeojsonKeyRef.current !== geojsonKey
      ) {
        cleanupRenderedLayers();
        renderedGeojsonKeyRef.current = geojsonKey;
        lastSetDataRef.current = null;
      }

      let source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      let labelSource = map.getSource(addressLabelSourceId) as mapboxgl.GeoJSONSource | undefined;

      // Only call setData if geometry actually changed.
      if (source && normalizedFeatures && normalizedFeatures !== lastSetDataRef.current) {
        source.setData(normalizedFeatures);
        lastSetDataRef.current = normalizedFeatures;
      }

      if (showAddressLabels && labelSource) {
        labelSource.setData(addressLabelFeatures);
      }

      if (!normalizedFeatures || normalizedFeatures.features.length === 0) {
        return false;
      }

      setBuildingsDebug({
        renderMode: 'geojson-source',
        attachStage: 'normalized-features-ready',
        normalizedFeatureCount: normalizedFeatures.features.length,
        normalizedFeatureBbox: getFeatureCollectionBbox(normalizedFeatures.features),
      });

      const verifyRenderedBuildingsOnIdle = () => {
        try {
          map.once('idle', () => {
            let renderedFeatureCount = 0;
            try {
              renderedFeatureCount = map.queryRenderedFeatures({
                layers: [layerId, circleLayerId],
              }).length;
            } catch {
              renderedFeatureCount = 0;
            }

            setBuildingsDebug({
              renderedFeatureCount,
              sourceAttached: Boolean(map.getSource(sourceId)),
              surfaceLayerAttached: Boolean(map.getLayer(surfaceLayerId)),
              extrusionLayerAttached: Boolean(map.getLayer(layerId)),
              outlineLayerAttached: Boolean(map.getLayer(outlineLayerId)),
              circleLayerAttached: Boolean(map.getLayer(circleLayerId)),
            });
          });
        } catch {
          // Best-effort render verification only.
        }
      };
      
      // Remove any existing route layers/sources that might conflict with buildings
      // This prevents z-fighting and rendering issues
      const routeLayers = ['route-lines', 'route-lines-inter', 'route-lines-glow', 'route-points', 'route-labels', 'route-start', 'block-stops', 'block-stop-labels'];
      const routeSources = ['route-source', 'route-source-inter', 'route-points-source', 'block-stops-source'];
      
      routeLayers.forEach(id => {
        try {
          if (map.getLayer(id)) {
            map.removeLayer(id);
          }
        } catch {
          // Ignore transient style-registry errors while the map is settling.
        }
      });
      
      routeSources.forEach(id => {
        try {
          if (map.getSource(id)) {
            map.removeSource(id);
          }
        } catch {
          // Ignore transient style-registry errors while the map is settling.
        }
      });

      setBuildingsDebug({
        renderMode: 'geojson-source',
        attachStage: 'route-cleanup-complete',
        sourceAlreadyAttached: Boolean(source),
        labelSourceAlreadyAttached: Boolean(labelSource),
        normalizedFeatureCount: normalizedFeatures.features.length,
      });

      // Create source if it doesn't exist yet (source update already handled above)
      if (!source) {
        try {
          setBuildingsDebug({
            renderMode: 'geojson-source',
            attachStage: 'adding-source',
            normalizedFeatureCount: normalizedFeatures.features.length,
          });
          map.addSource(sourceId, {
            type: 'geojson',
            data: normalizedFeatures,
            // promoteId enables setFeatureState() for real-time color updates
            // Match iOS: use the stable building identifier directly.
            promoteId: 'gers_id',
            // Buffer extends tile loading 512px beyond viewport edge
            // This prevents edge-clipping when panning in campaign mode
            buffer: 512,
            // Tolerance for geometry simplification (smaller = more detail)
            tolerance: 0.5,
          });
          lastSetDataRef.current = normalizedFeatures;
          source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
          setBuildingsDebug({
            renderMode: 'geojson-source',
            attachStage: 'source-ready',
            sourceAttached: Boolean(source),
            normalizedFeatureCount: normalizedFeatures.features.length,
          });
        } catch (err) {
          console.error('Error adding source:', err);
          setBuildingsDebug({
            renderMode: 'geojson-source',
            sourceAddError: err instanceof Error ? err.message : String(err),
            normalizedFeatureCount: normalizedFeatures.features.length,
            normalizedFeatureBbox: getFeatureCollectionBbox(normalizedFeatures.features),
          });
          return false;
        }
      }

      if (showAddressLabels && !labelSource) {
        try {
          map.addSource(addressLabelSourceId, {
            type: 'geojson',
            data: addressLabelFeatures,
            promoteId: 'feature_id',
          });
          labelSource = map.getSource(addressLabelSourceId) as mapboxgl.GeoJSONSource | undefined;
        } catch (err) {
          console.error('Error adding address label source:', err);
        }
      }

      setBuildingsDebug({
        renderMode: 'geojson-source',
        attachStage: 'label-source-ready',
        sourceAttached: Boolean(map.getSource(sourceId)),
        labelSourceAttached: Boolean(map.getSource(addressLabelSourceId)),
        normalizedFeatureCount: normalizedFeatures.features.length,
      });

      // map.getLayer can throw during style transitions even after an earlier style-loaded check.
      let hasBuildingLayer = false;
      try {
        const styleLoadedBeforeLayerCheck = map.isStyleLoaded();
        setBuildingsDebug({
          renderMode: 'geojson-source',
          attachStage: 'before-layer-check',
          styleLoadedBeforeLayerCheck,
          sourceAttached: Boolean(map.getSource(sourceId)),
          normalizedFeatureCount: normalizedFeatures.features.length,
        });
        if (!styleLoadedBeforeLayerCheck) return false;
        hasBuildingLayer = Boolean(map.getLayer(layerId));
        setBuildingsDebug({
          renderMode: 'geojson-source',
          attachStage: 'layer-check-complete',
          hasBuildingLayer,
          sourceAttached: Boolean(map.getSource(sourceId)),
          normalizedFeatureCount: normalizedFeatures.features.length,
        });
      } catch (err) {
        setBuildingsDebug({
          renderMode: 'geojson-source',
          attachStage: 'layer-check-error',
          layerCheckError: err instanceof Error ? err.message : String(err),
          sourceAttached: true,
          normalizedFeatureCount: normalizedFeatures.features.length,
        });
        return false;
      }

      // Add or update fill-extrusion layer (for Polygon/MultiPolygon geometries)
      if (!hasBuildingLayer) {
        try {
          setBuildingsDebug({
            renderMode: 'geojson-source',
            attachStage: 'adding-layers',
            sourceAttached: Boolean(map.getSource(sourceId)),
            normalizedFeatureCount: normalizedFeatures.features.length,
          });
          // NOTE: Shadow layer removed to fix "dark square" visual artifact
          // The 3D fill-extrusion with proper lighting provides sufficient visual depth
          const filterExpr = getFilterExpression();

          // Filter for polygon features only
          const polygonFilter: FilterSpecification = POLYGON_GEOMETRY_FILTER;
          const buildingHeightExpression = [
            'max',
            ['coalesce', ['get', 'height'], ['get', 'height_m'], DEFAULT_BUILDING_HEIGHT_METERS],
            DEFAULT_BUILDING_HEIGHT_METERS,
          ] as ExpressionSpecification;

          safeRemoveLayer(map, surfaceLayerId);
          
          // Add the main building layer
          // Add without beforeId to place at end (on top of everything, including labels)
          const layerConfig: FillExtrusionLayerSpecification = {
            id: layerId,
            type: 'fill-extrusion',
            source: sourceId,
            minzoom: CAMPAIGN_BUILDING_MIN_ZOOM,
            filter: getScopedGeometryFilter(polygonFilter, filterExpr),
            paint: {
              'fill-extrusion-color': getFootprintFillColor(),
              'fill-extrusion-vertical-gradient': getFootprintVerticalGradient(),
              'fill-extrusion-height': buildingHeightExpression,
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': getFootprintFillOpacity(),
              'fill-extrusion-emissive-strength': getFootprintEmissiveStrength(),
            },
          };
          
          // Add without beforeId - this places it at the end (on top of everything)
          map.addLayer(layerConfig);

          if (!map.getLayer(leadGlowLayerId)) {
            const leadGlowLayerConfig: LineLayerSpecification = {
              id: leadGlowLayerId,
              type: 'line',
              source: sourceId,
              minzoom: CAMPAIGN_BUILDING_MIN_ZOOM,
              filter: getScopedGeometryFilter(polygonFilter, filterExpr),
              paint: {
                'line-color': MAP_STATUS_CONFIG.LEADS.color,
                'line-width': 7,
                'line-opacity': getLeadGlowOpacityExpression(),
                'line-blur': 5,
              },
            };
            map.addLayer(leadGlowLayerConfig);
          }

          safeRemoveLayer(map, outlineLayerId);
          
          // Add circle layer for Point geometries (addresses without building polygons)
          if (!map.getLayer(circleLeadGlowLayerId)) {
            map.addLayer({
              id: circleLeadGlowLayerId,
              type: 'circle' as const,
              source: sourceId,
              minzoom: CAMPAIGN_BUILDING_MIN_ZOOM,
              filter: getScopedGeometryFilter(POINT_GEOMETRY_FILTER, filterExpr),
              paint: {
                'circle-radius': 14,
                'circle-color': MAP_STATUS_CONFIG.LEADS.color,
                'circle-opacity': getLeadGlowOpacityExpression(),
                'circle-blur': 0.85,
              },
            });
          }

          if (!map.getLayer(circleLayerId)) {
            const circleLayerConfig: CircleLayerSpecification = {
              id: circleLayerId,
              type: 'circle',
              source: sourceId,
              minzoom: CAMPAIGN_BUILDING_MIN_ZOOM,
              filter: getScopedGeometryFilter(POINT_GEOMETRY_FILTER, filterExpr),
              paint: {
                'circle-radius': 5,
                'circle-color': getFootprintFillColor(),
                'circle-opacity': getCircleOpacity(),
                'circle-stroke-width': 1.5,
                'circle-stroke-color': footprintStatusColors ? '#ffffff' : NEUTRAL_OUTLINE_COLOR,
              },
            };
            map.addLayer(circleLayerConfig);
          }

          if (!map.getLayer(addressLabelLayerId)) {
            map.addLayer({
              id: addressLabelLayerId,
              type: 'symbol',
              source: addressLabelSourceId,
              minzoom: ADDRESS_LABEL_MIN_ZOOM,
              filter: ['has', 'house_number'],
              layout: {
                'text-field': ['get', 'house_number'],
                'text-size': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  ADDRESS_LABEL_MIN_ZOOM,
                  10,
                  22,
                  13,
                ],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                'text-anchor': 'center',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
              },
              paint: {
                'text-color': '#f9fafb',
                'text-opacity': 0.95,
                'text-halo-color': '#111827',
                'text-halo-width': 1.5,
              },
            });
          }
          if (map.getLayer(addressLabelLayerId)) {
            map.setLayoutProperty(addressLabelLayerId, 'visibility', showAddressLabels ? 'visible' : 'none');
          }
          forceBuildingLayerVisibility();
          map.triggerRepaint();
          verifyRenderedBuildingsOnIdle();

          setBuildingsDebug({
            renderMode: 'geojson-source',
            sourceId,
            sourceAttached: Boolean(map.getSource(sourceId)),
            surfaceLayerAttached: Boolean(map.getLayer(surfaceLayerId)),
            extrusionLayerAttached: Boolean(map.getLayer(layerId)),
            outlineLayerAttached: Boolean(map.getLayer(outlineLayerId)),
            normalizedFeatureCount: normalizedFeatures.features.length,
            normalizedFeatureBbox: getFeatureCollectionBbox(normalizedFeatures.features),
            pitch: map.getPitch(),
            zoom: map.getZoom(),
          });

        // Outline layer removed to eliminate dark shadow effect underneath buildings

        // Set map lighting for 3D depth visualization
        // Use 'map' anchor instead of 'viewport' to avoid lighting warnings and ensure consistent 3D depth
        try {
          map.setLight({
            anchor: 'map',
            color: '#cfd8e3',
            intensity: 0.35,
            position: [1.15, 210, 30]
          });
          ensure3dBuildingCamera(map);
        } catch (lightErr) {
          console.warn('[MapBuildingsLayer] Error setting map lighting:', lightErr);
        }

        // Helpers used in click handler (must be defined before popup content)
        const escapeHtml = (text: string): string => {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        };
        const getStatusColor = (status: string): string => {
          switch (status.toLowerCase()) {
            case 'hot': return '#ef4444';
            case 'warm': return '#f59e0b';
            case 'cold': return '#6b7280';
            case 'new':
            default: return '#dc2626';
          }
        };

        // Add click handler to fetch and display resident data
        const clickHandler = async (e: mapboxgl.MapLayerMouseEvent) => {
          const additiveSelection = Boolean(
            (e.originalEvent as MouseEvent | undefined)?.metaKey ||
            (e.originalEvent as MouseEvent | undefined)?.ctrlKey
          );
          console.log('[MapBuildingsLayer] Click event:', {
            featureCount: e.features?.length,
            point: e.point,
          });
          
          if (!e.features || e.features.length === 0) {
            console.log('[MapBuildingsLayer] No features at click location');
            return;
          }
          
          const feature = e.features[0];
          const props = feature.properties as BuildingProperties;
          
          console.log('[MapBuildingsLayer] Building clicked, raw props:', props);
          
          const gersId = props.gers_id || props.building_id || props.id;
          
          // UNIT MODE: If this is a unit slice, pass address_id to show specific unit
          if (props.unit_id && props.address_id && onBuildingClick) {
            console.log('[MapBuildingsLayer] Unit clicked:', {
              unit_id: props.unit_id,
              unit_number: props.unit_number,
              address_id: props.address_id,
              address_text: props.address_text,
            });
            
            // Pass both gersId (parent building) and address_id (specific unit)
            onBuildingClick(gersId, props.address_id, { additive: additiveSelection });
            return; // Early return - we've handled the click
          }
          
          // If no gers_id, fall back to onBuildingClick with id
          if (!gersId) {
            console.log('[MapBuildingsLayer] No gers_id or id, using fallback');
            if (props.id && onBuildingClick) {
              onBuildingClick(props.id, undefined, { additive: additiveSelection });
            }
            return;
          }

          // Fetch contacts by GERS ID
          try {
            const supabase = getSupabase();
            const { data: contacts, error } = await supabase
              .from('contacts')
              .select('full_name, phone, email, status, notes')
              .eq('gers_id', gersId)
              .eq('campaign_id', campaignId || '');

            if (error) {
              console.error('[MapBuildingsLayer] Error fetching contacts:', error);
            }

            // Address: prefer stable linker address_text from feature props, else fetch
            let addressInfo: { address?: string; addressId?: string } = {};
            if (props.address_text) {
              addressInfo.address = props.address_text;
            }
            if ((!contacts || contacts.length === 0) && onAddToCRM && !addressInfo.address) {
              const { data: addressData } = await supabase
                .from('campaign_addresses')
                .select('id, address, formatted, gers_id')
                .or(`gers_id.eq.${gersId},gers_id_uuid.eq.${gersId}`)
                .eq('campaign_id', campaignId || '')
                .maybeSingle();

              if (addressData) {
                addressInfo = {
                  address: addressData.formatted || addressData.address,
                  addressId: addressData.id,
                };
              }
            }

            // Create popup content
            let popupContent = '';
            let buttonId: string | null = null;
            const popupData = {
              address: addressInfo.address || '',
              addressId: addressInfo.addressId,
              gersId: gersId,
              campaignId: campaignId || undefined,
            };
            
            // Unit header - show unit number/house number prominently for slices (red accent)
            const unitHeader = props.unit_number 
              ? `<div style="background: #dc2626; color: white; padding: 8px 12px; margin: -12px -12px 12px -12px; font-weight: 600; font-size: 18px;">🏠 Unit ${escapeHtml(props.unit_number)}</div>`
              : '';
            const addressHeader = addressInfo.address 
              ? `<div style="font-weight: 500; margin-bottom: 8px; color: #374151;">${escapeHtml(addressInfo.address)}</div>` 
              : '';
            
            if (contacts && contacts.length > 0) {
              popupContent = '<div style="padding: 12px; max-width: 300px;">';
              popupContent += unitHeader;
              popupContent += addressHeader;
              if (props.match_method) {
                popupContent += '<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 8px;">Linked via: ' + escapeHtml(props.match_method) + '</div>';
              }
              popupContent += '<div style="font-weight: 600; margin-bottom: 8px; font-size: 16px;">Resident Information</div>';
              
              contacts.forEach((contact, index) => {
                if (index > 0) {
                  popupContent += '<hr style="margin: 12px 0; border: none; border-top: 1px solid #e5e7eb;" />';
                }
                popupContent += `<div style="margin-bottom: 8px;">`;
                if (contact.full_name) {
                  popupContent += `<div style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(contact.full_name)}</div>`;
                }
                if (contact.phone) {
                  popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">📞 ${escapeHtml(contact.phone)}</div>`;
                }
                if (contact.email) {
                  popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 2px;">✉️ ${escapeHtml(contact.email)}</div>`;
                }
                if (contact.status) {
                  const statusColor = getStatusColor(contact.status);
                  popupContent += `<div style="font-size: 0.75rem; margin-top: 4px;"><span style="background: ${statusColor}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: 500;">${escapeHtml(contact.status)}</span></div>`;
                }
                if (contact.notes) {
                  popupContent += `<div style="font-size: 0.875rem; color: #374151; margin-top: 6px; font-style: italic;">${escapeHtml(contact.notes)}</div>`;
                }
                popupContent += `</div>`;
              });
              
              popupContent += '</div>';
            } else {
              // No contacts found - show "Add to Leads" button
              const addressDisplay = addressInfo.address ? escapeHtml(addressInfo.address) : 'this address';
              popupContent = '<div style="padding: 12px; max-width: 280px;">';
              popupContent += unitHeader;
              popupContent += addressHeader;
              if (props.match_method) {
                popupContent += '<div style="font-size: 0.75rem; color: #6b7280; margin-bottom: 6px;">Linked via: ' + escapeHtml(props.match_method) + '</div>';
              }
              popupContent += '<div style="font-weight: 600; margin-bottom: 6px; font-size: 16px;">No Resident Data</div>';
              popupContent += `<div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 12px;">No resident data available for ${addressDisplay}.</div>`;
              
              if (onAddToCRM) {
                // Generate unique ID for this button
                buttonId = `add-to-crm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                popupContent += `<button id="${buttonId}" style="width: 100%; background: #dc2626; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 500; font-size: 0.875rem; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">Add to Leads</button>`;
              }
              
              popupContent += '</div>';
            }

            // Always trigger onBuildingClick if available - this opens the LocationCard
            // The LocationCard provides a richer UI than the popup.
            // Pass address_id when present (Gold/Silver linked features) so the card can show the address.
            if (onBuildingClick) {
              onBuildingClick(gersId, props.address_id, { additive: additiveSelection });
              // Skip showing the basic popup since LocationCard will handle the UI
              return;
            }

            // Fallback: show popup if onBuildingClick is not provided
            const popup = new mapboxgl.Popup({ closeOnClick: true })
              .setLngLat(e.lngLat)
              .setHTML(popupContent)
              .addTo(map);

            // If "Add to Leads" button exists, attach click handler
            if (buttonId && onAddToCRM) {
              // Use setTimeout to ensure DOM is ready
              setTimeout(() => {
                const button = document.getElementById(buttonId!);
                if (button) {
                  button.addEventListener('click', (evt) => {
                    evt.stopPropagation();
                    evt.preventDefault();
                    popup.remove();
                    onAddToCRM(popupData);
                  });
                }
              }, 100);
            }
          } catch (err) {
            console.error('[MapBuildingsLayer] Error in click handler:', err);
            // Fallback to onBuildingClick - always pass address_id when available
            if (gersId && onBuildingClick) {
              onBuildingClick(gersId, props.address_id, { additive: additiveSelection });
            } else if (props.id && onBuildingClick) {
              onBuildingClick(props.id, props.address_id, { additive: additiveSelection });
            }
          }
        };

        cleanupLayerInteractionHandlers?.();

        const getInteractiveLayers = () => {
          const layers: string[] = [];
          try {
            if (!map.isStyleLoaded()) return layers;
            if (map.getLayer(layerId)) layers.push(layerId);
            if (map.getLayer(circleLayerId)) layers.push(circleLayerId);
          } catch {
            return [];
          }
          return layers;
        };

        // Use map-level handlers so Mapbox does not run layer-scoped
        // queryRenderedFeatures internally during style transitions.
        const mapClickHandler = (event: mapboxgl.MapMouseEvent) => {
          try {
            const layers = getInteractiveLayers();
            if (layers.length === 0) return;
            const features = map.queryRenderedFeatures(event.point, { layers });
            if (features.length > 0) void clickHandler(Object.assign(event, { features }));
          } catch {
            return;
          }
        };

        // Use map-level mousemove so hover does not depend on Mapbox's
        // layer-scoped mouseenter/mouseleave dispatch during style transitions.
        const mapMouseMoveHandler = (event: mapboxgl.MapMouseEvent) => {
          try {
            const layers = getInteractiveLayers();
            if (layers.length === 0) {
              map.getCanvas().style.cursor = '';
              return;
            }
            const features = map.queryRenderedFeatures(event.point, { layers });
            map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
          } catch {
            map.getCanvas().style.cursor = '';
          }
        };

        map.on('click', mapClickHandler);
        map.on('mousemove', mapMouseMoveHandler);
        cleanupLayerInteractionHandlers = () => {
          map.off('click', mapClickHandler);
          map.off('mousemove', mapMouseMoveHandler);
        };

        if (map.getLayer(addressLabelLayerId)) {
          map.moveLayer(addressLabelLayerId);
        }
        } catch (err) {
          console.error('Error adding fill-extrusion layer:', err);
          setBuildingsDebug({
            renderMode: 'geojson-source',
            layerAddError: err instanceof Error ? err.message : String(err),
            normalizedFeatureCount: normalizedFeatures.features.length,
            normalizedFeatureBbox: getFeatureCollectionBbox(normalizedFeatures.features),
          });
          return false;
        }
      } else {
        // Update paint properties for existing layer to ensure opacity is correct
        try {
          const filterExpr = getFilterExpression();
          safeRemoveLayer(map, surfaceLayerId);
          safeRemoveLayer(map, outlineLayerId);
          map.setPaintProperty(layerId, 'fill-extrusion-opacity', getFootprintFillOpacity());
          map.setPaintProperty(layerId, 'fill-extrusion-color', getFootprintFillColor());
          map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', getFootprintVerticalGradient());
          map.setPaintProperty(layerId, 'fill-extrusion-emissive-strength', getFootprintEmissiveStrength());
          map.setFilter(layerId, getScopedGeometryFilter(POLYGON_GEOMETRY_FILTER, filterExpr));

          if (map.getLayer(layerId)) {
            try {
              map.moveLayer(layerId);
              if (map.getLayer(addressLabelLayerId)) {
                map.moveLayer(addressLabelLayerId);
              }
            } catch (moveErr) {
              console.warn('[MapBuildingsLayer] Layer reorder error:', moveErr);
            }
          }

          if (!map.getLayer(addressLabelLayerId) && map.getSource(addressLabelSourceId)) {
            map.addLayer({
              id: addressLabelLayerId,
              type: 'symbol',
              source: addressLabelSourceId,
              minzoom: ADDRESS_LABEL_MIN_ZOOM,
              filter: ['has', 'house_number'],
              layout: {
                'text-field': ['get', 'house_number'],
                'text-size': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  ADDRESS_LABEL_MIN_ZOOM,
                  10,
                  22,
                  13,
                ],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                'text-anchor': 'center',
                'text-allow-overlap': false,
                'text-ignore-placement': false,
              },
              paint: {
                'text-color': '#f9fafb',
                'text-opacity': 0.95,
                'text-halo-color': '#111827',
                'text-halo-width': 1.5,
              },
            });
          }
          if (map.getLayer(addressLabelLayerId)) {
            map.setLayoutProperty(addressLabelLayerId, 'visibility', showAddressLabels ? 'visible' : 'none');
          }
          forceBuildingLayerVisibility();
          map.triggerRepaint();
          verifyRenderedBuildingsOnIdle();
          setBuildingsDebug({
            renderMode: 'geojson-source',
            sourceId,
            sourceAttached: Boolean(map.getSource(sourceId)),
            surfaceLayerAttached: Boolean(map.getLayer(surfaceLayerId)),
            extrusionLayerAttached: Boolean(map.getLayer(layerId)),
            outlineLayerAttached: Boolean(map.getLayer(outlineLayerId)),
            normalizedFeatureCount: normalizedFeatures.features.length,
            normalizedFeatureBbox: getFeatureCollectionBbox(normalizedFeatures.features),
            pitch: map.getPitch(),
            zoom: map.getZoom(),
          });
          cleanupLayerInteractionHandlers?.();

          const getInteractiveLayers = () => {
            const layers: string[] = [];
            try {
              if (!map.isStyleLoaded()) return layers;
              if (map.getLayer(layerId)) layers.push(layerId);
              if (map.getLayer(circleLayerId)) layers.push(circleLayerId);
            } catch {
              return [];
            }
            return layers;
          };

          const handleExistingLayerClick = (event: mapboxgl.MapMouseEvent) => {
            try {
              const layers = getInteractiveLayers();
              if (layers.length === 0) return;
              const features = map.queryRenderedFeatures(event.point, { layers });
              const props = features[0]?.properties as BuildingProperties | undefined;
              if (!props || !onBuildingClick) return;

              const buildingId = String(props.gers_id ?? props.building_id ?? props.id ?? '').trim();
              if (!buildingId) return;

              const addressId = String(props.address_id ?? '').trim() || undefined;
              const originalEvent = event.originalEvent as MouseEvent | undefined;
              onBuildingClick(buildingId, addressId, {
                additive: Boolean(originalEvent?.metaKey || originalEvent?.ctrlKey),
              });
            } catch {
              return;
            }
          };

          const handleExistingLayerMouseMove = (event: mapboxgl.MapMouseEvent) => {
            try {
              const layers = getInteractiveLayers();
              if (layers.length === 0) {
                map.getCanvas().style.cursor = '';
                return;
              }
              const features = map.queryRenderedFeatures(event.point, { layers });
              map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
            } catch {
              map.getCanvas().style.cursor = '';
            }
          };

          map.on('click', handleExistingLayerClick);
          map.on('mousemove', handleExistingLayerMouseMove);
          cleanupLayerInteractionHandlers = () => {
            map.off('click', handleExistingLayerClick);
            map.off('mousemove', handleExistingLayerMouseMove);
          };
        } catch (err) {
          console.error('Error updating layer paint properties:', err);
          setBuildingsDebug({
            renderMode: 'geojson-source',
            layerUpdateError: err instanceof Error ? err.message : String(err),
            normalizedFeatureCount: normalizedFeatures.features.length,
          });
          return false;
        }
      }
      return Boolean(map.getSource(sourceId) && map.getLayer(layerId));
    }; // End of updateLayers function

    let retryIntervalId: number | null = null;
    const tryUpdateLayers = () => {
      if (updateLayers() && retryIntervalId !== null) {
        window.clearInterval(retryIntervalId);
        retryIntervalId = null;
      }
    };

    tryUpdateLayers();
    map.on('idle', tryUpdateLayers);
    map.on('style.load', tryUpdateLayers);
    map.on('styledata', tryUpdateLayers);
    retryIntervalId = window.setInterval(tryUpdateLayers, 200);

    // Cleanup listeners
    return () => {
      map.off('idle', tryUpdateLayers);
      map.off('style.load', tryUpdateLayers);
      map.off('styledata', tryUpdateLayers);
      if (retryIntervalId !== null) {
        window.clearInterval(retryIntervalId);
      }
      cleanupLayerInteractionHandlers?.();
    };
  }, [map, features, zoomLevel, onBuildingClick, statusFilters, campaignId, getSupabase, onAddToCRM, showOrphans, showAddressLabels, footprintStatusColors, addressStateOverrides, isDarkMap, assignmentColorByAddressId]);

  // Update color and filter when statusFilters or campaignId changes
  useEffect(() => {
    // map.getLayer can throw during style transitions (setStyle clears
    // the layer registry temporarily). Guard with isStyleLoaded() and
    // catch any transient Mapbox internal errors.
    try {
      if (!map || !map.isStyleLoaded() || !map.getLayer(layerId)) return;
    } catch {
      return;
    }
    
    try {
      const colorExpr = getFootprintFillColor();
      const filterExpr = getFilterExpression();
      map.setPaintProperty(layerId, 'fill-extrusion-color', colorExpr);
      map.setPaintProperty(layerId, 'fill-extrusion-opacity', getFootprintFillOpacity());
      map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', getFootprintVerticalGradient());
      map.setPaintProperty(layerId, 'fill-extrusion-emissive-strength', getFootprintEmissiveStrength());

      map.setFilter(layerId, getScopedGeometryFilter(POLYGON_GEOMETRY_FILTER, filterExpr));
      safeRemoveLayer(map, surfaceLayerId);
      if (map.getLayer(leadGlowLayerId)) {
        map.setPaintProperty(leadGlowLayerId, 'line-opacity', getLeadGlowOpacityExpression());
        map.setFilter(leadGlowLayerId, getScopedGeometryFilter(POLYGON_GEOMETRY_FILTER, filterExpr));
      }
      safeRemoveLayer(map, outlineLayerId);
      if (map.getLayer(circleLeadGlowLayerId)) {
        map.setPaintProperty(circleLeadGlowLayerId, 'circle-opacity', getLeadGlowOpacityExpression());
        map.setFilter(circleLeadGlowLayerId, getScopedGeometryFilter(POINT_GEOMETRY_FILTER, filterExpr));
      }
      if (map.getLayer(circleLayerId)) {
        map.setPaintProperty(circleLayerId, 'circle-color', colorExpr);
        map.setPaintProperty(circleLayerId, 'circle-opacity', getCircleOpacity());
        map.setPaintProperty(circleLayerId, 'circle-stroke-color', footprintStatusColors ? '#ffffff' : NEUTRAL_OUTLINE_COLOR);
        map.setFilter(circleLayerId, getScopedGeometryFilter(POINT_GEOMETRY_FILTER, filterExpr));
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error updating color/filter:', err);
    }
  }, [map, statusFilters, campaignId, layerId, surfaceLayerId, outlineLayerId, showOrphans, footprintStatusColors, circleLayerId, leadGlowLayerId, isDarkMap, assignmentColorByAddressId]);

  // Update filter when showOrphans changes (toggle visibility of orphan buildings)
  useEffect(() => {
    if (!map) return;
    
    const updateFilters = () => {
      const filterExpr = getFilterExpression();
      
      try {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, getScopedGeometryFilter(POLYGON_GEOMETRY_FILTER, filterExpr));
        }
        safeRemoveLayer(map, surfaceLayerId);
        safeRemoveLayer(map, outlineLayerId);
        if (map.getLayer(circleLayerId)) {
          map.setFilter(circleLayerId, getScopedGeometryFilter(POINT_GEOMETRY_FILTER, filterExpr));
        }
      } catch (err) {
        console.error('[MapBuildingsLayer] Error updating filter for showOrphans:', err);
      }
    };

    // Apply immediately if map is loaded
    if (map.loaded()) {
      updateFilters();
    } else {
      map.once('load', updateFilters);
    }

    return () => {
      map.off('load', updateFilters);
    };
  }, [map, showOrphans, campaignId, statusFilters, layerId, surfaceLayerId, outlineLayerId, circleLayerId]);

  // Re-apply lighting and refresh colors when map style loads (important for dark mode)
  useEffect(() => {
    if (!map) return;

    const applyLightingAndColors = () => {
      try {
        // Apply lighting for 3D depth
        map.setLight({
          anchor: 'map', // Use 'map' anchor to avoid viewport anchor warnings
          color: '#cfd8e3',
          intensity: 0.35,
          position: [1.15, 210, 30]
        });

        // Refresh colors after style change (ensures they're applied correctly)
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'fill-extrusion-color', getFootprintFillColor());
          map.setPaintProperty(layerId, 'fill-extrusion-opacity', getFootprintFillOpacity());
          map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', getFootprintVerticalGradient());
          map.setPaintProperty(layerId, 'fill-extrusion-emissive-strength', getFootprintEmissiveStrength());
        }
        safeRemoveLayer(map, surfaceLayerId);
        safeRemoveLayer(map, outlineLayerId);
        if (map.getLayer(leadGlowLayerId)) {
          map.setPaintProperty(leadGlowLayerId, 'line-opacity', getLeadGlowOpacityExpression());
        }
        if (map.getLayer(circleLeadGlowLayerId)) {
          map.setPaintProperty(circleLeadGlowLayerId, 'circle-opacity', getLeadGlowOpacityExpression());
        }
        if (map.getLayer(circleLayerId)) {
          map.setPaintProperty(circleLayerId, 'circle-color', getFootprintFillColor());
          map.setPaintProperty(circleLayerId, 'circle-opacity', getCircleOpacity());
          map.setPaintProperty(circleLayerId, 'circle-stroke-color', footprintStatusColors ? '#ffffff' : NEUTRAL_OUTLINE_COLOR);
        }
      } catch (err) {
        console.warn('[MapBuildingsLayer] Error applying lighting/colors:', err);
      }
    };

    // Apply immediately if map is loaded
    if (map.loaded()) {
      applyLightingAndColors();
    }

    // Also apply when style loads (e.g., when switching between light/dark modes)
    map.once('style.load', applyLightingAndColors);

    return () => {
      map.off('style.load', applyLightingAndColors);
    };
  }, [map, layerId, surfaceLayerId, outlineLayerId, circleLayerId, footprintStatusColors, statusFilters, isDarkMap]);

  // Real-time subscription for building_stats updates
  // When a QR code is scanned, building_stats is updated via trigger
  // This subscription catches that change and updates the map colors instantly
  // Uses setFeatureState() for efficient real-time updates (no full re-render)
  useEffect(() => {
    if (!map || !campaignId || useCanonicalAddressState) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for building_stats, campaignId:', campaignId);

    const supabase = getSupabase();
    const channel = supabase
      .channel(`building-stats-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'building_stats',
        },
        (payload) => {
          console.log('[MapBuildingsLayer] Received building_stats change:', payload);
          
          if (payload.new && isMountedRef.current) {
            const newProps = toRecord(payload.new);
            const updatedGersId = getStringRecordValue(newProps, 'gers_id');
            const newStatus = getStringRecordValue(newProps, 'status') ?? 'not_visited';
            const scansTotalValue = newProps.scans_total;
            const scansTotal = typeof scansTotalValue === 'number'
              ? scansTotalValue
              : Number(scansTotalValue ?? 0) || 0;
            
            console.log('[MapBuildingsLayer] Real-time building_stats update:', {
              gers_id: updatedGersId,
              status: newStatus,
              scans_total: scansTotal,
              payload_type: payload.eventType,
            });
            
            // Use setFeatureState for instant color update (no full re-render)
            // Features use promoteId: 'gers_id'. building_stats is keyed by gers_id.
            if (updatedGersId) {
              try {
                const featureState = { 
                  status: newStatus,
                  scans_total: scansTotal,
                  qr_scanned: scansTotal > 0, // Mark as QR scanned if any scans
                };
                const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource & { _data?: GeoJSON.FeatureCollection } | undefined;
                const data = source?._data;
                const featuresToUpdate = data?.features?.filter(
                  (f: GeoJSON.Feature) => getStringRecordValue(toRecord(f.properties), 'gers_id') === updatedGersId
                ) ?? [];
                const ids = featuresToUpdate
                  .map((f: GeoJSON.Feature) => getStringRecordValue(toRecord(f.properties), 'gers_id'))
                  .filter((id): id is string => Boolean(id));
                if (ids.length === 0) {
                  // Fallback: treat gers_id as feature id (detached or legacy data without feature_id)
                  ids.push(updatedGersId);
                }
                for (const id of ids) {
                  map.setFeatureState({ source: sourceId, id }, featureState);
                }
                console.log('[MapBuildingsLayer] setFeatureState success:', updatedGersId, '->', ids.length, 'features', featureState);
              } catch (err) {
                console.warn('[MapBuildingsLayer] setFeatureState error (feature may not exist yet):', err);
              }
            } else {
              console.warn('[MapBuildingsLayer] No gers_id in building_stats update - cannot update feature state');
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[MapBuildingsLayer] Realtime subscription status:', status);
        if (err) {
          console.error('[MapBuildingsLayer] Realtime subscription error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, getSupabase, useCanonicalAddressState]);

  // Real-time subscription for scan_events (direct scan tracking)
  // This is a fallback in case building_stats trigger fails or realtime isn't enabled
  useEffect(() => {
    if (!map || !campaignId || useCanonicalAddressState) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for scan_events, campaignId:', campaignId);

    const supabase = getSupabase();
    const channel = supabase
      .channel(`scan-events-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scan_events',
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          console.log('[MapBuildingsLayer] Received scan_event INSERT:', payload);
          
          if (payload.new && isMountedRef.current) {
            const newScan = toRecord(payload.new);
            const buildingId = getStringRecordValue(newScan, 'building_id');
            
            // Look up the gers_id for this building
            if (buildingId) {
              try {
                const { data: building, error } = await supabase
                  .from('buildings')
                  .select('gers_id')
                  .eq('id', buildingId)
                  .single();
                
                if (building?.gers_id) {
                  console.log('[MapBuildingsLayer] Found gers_id for building:', building.gers_id);
                  
                  // Update feature state to show as QR scanned
                  const featureState = { 
                    status: 'visited',
                    scans_total: 1, // At least 1 scan
                    qr_scanned: true,
                  };
                  
                  map.setFeatureState(
                    { source: sourceId, id: building.gers_id },
                    featureState
                  );
                  console.log('[MapBuildingsLayer] setFeatureState from scan_events:', building.gers_id, '->', featureState);
                } else {
                  console.warn('[MapBuildingsLayer] Could not find gers_id for building:', buildingId, error);
                }
              } catch (err) {
                console.error('[MapBuildingsLayer] Error looking up building gers_id:', err);
              }
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[MapBuildingsLayer] scan_events subscription status:', status);
        if (err) {
          console.error('[MapBuildingsLayer] scan_events subscription error:', err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, getSupabase, useCanonicalAddressState]);

  // Real-time subscription for building_address_links (stable linker: map snaps grey → red as links are added)
  useEffect(() => {
    if (!map || !campaignId || isCanonicalBundleControlled) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel(`building-links-realtime-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'building_address_links',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => {
          if (!isMountedRef.current) return;
          // Re-fetch full campaign data to include the new link
          // This ensures feature_status updates from 'orphan_building' to 'matched'
          console.log('[MapBuildingsLayer] New building link detected, refreshing campaign data');
          fetchCampaignData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [map, campaignId, getSupabase, fetchCampaignData, isCanonicalBundleControlled]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (fetchTimeout.current) {
        clearTimeout(fetchTimeout.current);
      }
      if (map) {
        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
          }
          if (map.getLayer(circleLayerId)) {
            map.removeLayer(circleLayerId);
          }
          if (map.getLayer(shadowLayerId)) {
            map.removeLayer(shadowLayerId);
          }
          if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        } catch (err) {
          // Ignore cleanup errors
        }
      }
    };
  }, [map]);

  return null;
}
