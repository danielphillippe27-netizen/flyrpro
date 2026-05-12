'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
import { DEFAULT_STATUS_FILTERS, FLYER_MODE_STATUS_COLORS, MAP_STATUS_CONFIG, type StatusFilters } from '@/lib/constants/mapStatus';
import { displayAddressText, resolveHouseNumberLabel } from '@/lib/map/addressPresentation';
import {
  appendTileAccessToken,
  fetchCampaignMapManifest,
  hasDirectWebPmtiles,
  hasRenderablePmtilesBuildings,
  toPmtilesProtocolUrl,
  type CampaignMapManifest,
} from '@/lib/map/campaignMapManifest';
import { ensurePmtilesProtocolRegistered } from '@/lib/map/pmtilesProtocol';

type ManifestBuildingSource = {
  deliveryMode: 'pmtiles_protocol' | 'static_zxy_cdn' | 'backend_zxy';
  url: string;
  sourceLayer: string;
  promoteId: string;
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
};

interface MapBuildingsLayerProps {
  map: MapboxMap;
  campaignId?: string | null;
  campaignType?: CampaignType | null;
  refreshKey?: number;
  addressStateOverrides?: CampaignAddress[];
  hiddenBuildingIds?: string[];
  deletedAddressIds?: string[];
  statusFilters?: StatusFilters;
  showOrphans?: boolean; // Toggle to show/hide orphan buildings (buildings without address links)
  showAddressLabels?: boolean;
  /** When false, footprints use a neutral gray (not status colors); roads unchanged. Default true. */
  footprintStatusColors?: boolean;
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
  featureCount: number;
  visibleFeatureCount: number;
  zoomLevel: number;
};

const defaultStatusFilters: StatusFilters = DEFAULT_STATUS_FILTERS;

/** Scale factor for building footprints (1 = unchanged, <1 = skinnier). */
const FOOTPRINT_SCALE = 1;
const ADDRESS_LABEL_MIN_ZOOM = 18;
const POLYGON_GEOMETRY_FILTER: FilterSpecification = ['==', '$type', 'Polygon'];
const POINT_GEOMETRY_FILTER: FilterSpecification = ['==', '$type', 'Point'];

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
    if (!map.isStyleLoaded()) return false;
    return Boolean(map.getSource(sourceId));
  } catch {
    return false;
  }
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

function toManifestBuildingSource(
  manifest: CampaignMapManifest,
  accessToken: string | null
): ManifestBuildingSource | null {
  const sourceLayer = manifest.source_layers?.buildings;
  if (!sourceLayer) return null;

  if (hasDirectWebPmtiles(manifest) && manifest.pmtiles_url) {
    const pmtilesUrl = toPmtilesProtocolUrl(manifest.pmtiles_url);
    if (pmtilesUrl && ensurePmtilesProtocolRegistered()) {
      return {
        deliveryMode: 'pmtiles_protocol',
        url: pmtilesUrl,
        sourceLayer,
        promoteId: manifest.promote_ids?.buildings ?? 'building_id',
        minzoom: manifest.minzoom ?? 13,
        maxzoom: manifest.maxzoom ?? 18,
        bounds: manifest.bounds ?? undefined,
      };
    }
  }

  if (manifest.static_vector_tile_url_template) {
    return {
      deliveryMode: 'static_zxy_cdn',
      url: manifest.static_vector_tile_url_template,
      sourceLayer,
      promoteId: manifest.promote_ids?.buildings ?? 'building_id',
      minzoom: manifest.minzoom ?? 13,
      maxzoom: manifest.maxzoom ?? 18,
      bounds: manifest.bounds ?? undefined,
    };
  }

  if (!manifest.vector_tile_url_template) return null;

  return {
    deliveryMode: 'backend_zxy',
    url: appendTileAccessToken(manifest.vector_tile_url_template, accessToken),
    sourceLayer,
    promoteId: manifest.promote_ids?.buildings ?? 'building_id',
    minzoom: manifest.minzoom ?? 13,
    maxzoom: manifest.maxzoom ?? 18,
    bounds: manifest.bounds ?? undefined,
  };
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

export function MapBuildingsLayer({
  map,
  campaignId,
  campaignType,
  refreshKey = 0,
  addressStateOverrides,
  hiddenBuildingIds = [],
  deletedAddressIds = [],
  statusFilters = defaultStatusFilters,
  showOrphans = true,
  showAddressLabels = true,
  footprintStatusColors = true,
  onBuildingClick,
  onAddToCRM,
  onRenderStateChange,
}: MapBuildingsLayerProps) {
  const isFlyerMode = campaignType === 'flyer';
  const [features, setFeatures] = useState<BuildingFeatureCollection | null>(null);
  const [manifestSource, setManifestSource] = useState<ManifestBuildingSource | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(15);
  const sourceId = 'map-buildings-source';
  const layerId = 'map-buildings-extrusion';
  const shadowLayerId = 'map-buildings-shadow';
  const leadGlowLayerId = 'map-buildings-lead-glow';
  const circleLayerId = 'map-buildings-extrusion-points';
  const circleLeadGlowLayerId = 'map-buildings-lead-glow-points';
  const addressLabelSourceId = 'map-address-centroid-label-source';
  const addressLabelLayerId = 'map-address-centroid-labels';
  const supabase = createClient();
  const useCanonicalAddressState = Boolean(addressStateOverrides?.length);
  
  // Debounce fetching to prevent spamming Supabase during rapid panning
  const fetchTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const isMountedRef = useRef(true);
  // Geometry is precomputed once when features are fetched.
  // This eliminates the JSON.parse deep-clone + scaleFootprint call from the hot update path.
  const normalizedFeaturesRef = useRef<BuildingFeatureCollection | null>(null);
  const lastSetDataRef = useRef<BuildingFeatureCollection | null>(null);
  const onBuildingClickRef = useRef(onBuildingClick);
  const onRenderStateChangeRef = useRef(onRenderStateChange);
  const isFetchingRef = useRef(isFetching);

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
        },
      ])
    );

    const buildingStateById = new Map<
      string,
      { status: 'not_visited' | 'visited' | 'hot' | 'lead' | 'hot_lead' | 'no_answer' | 'do_not_knock'; scans_total: number; qr_scanned: boolean }
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

        const featureState =
          (props.address_id ? addressStateById.get(props.address_id) : undefined) ??
          (props.building_id ? buildingStateById.get(props.building_id) : undefined) ??
          (props.gers_id ? buildingStateById.get(props.gers_id) : undefined);

        if (!featureState) continue;

        try {
          map.setFeatureState({ source: sourceId, id: featureId }, featureState);
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
  }, [map, campaignId, features, addressStateOverrides]);

  // Status toggles now control color emphasis (not visibility).
  // Non-selected statuses render as neutral gray baseline.
  const getFilterExpression = (): FilterSpecification | undefined => {
    return undefined;
  };

  // Generate unified color expression based on status priority
  // Priority: QR_SCANNED > LEADS > CONVERSATIONS > DO_NOT_KNOCK > NO_ONE_HOME > TOUCHED > UNTOUCHED
  // Uses ['feature-state', ...] for real-time updates via setFeatureState(),
  // with fallback to ['get', ...] for initial data from properties
  const getColorExpression = (): ExpressionSpecification => {
    // Helper expressions - check feature-state first (real-time), then source properties (initial load)
    const getStatusValue = () => ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited'];
    const getAddressStatus = () => ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none'];
    const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];
    const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
    if (isFlyerMode) {
      const isVisited = [
        'any',
        ['==', getStatusValue(), 'visited'],
        ['==', getStatusValue(), 'hot'],
        ['==', getStatusValue(), 'lead'],
        ['==', getStatusValue(), 'hot_lead'],
        ['==', getStatusValue(), 'no_answer'],
        ['==', getStatusValue(), 'do_not_knock'],
        ['!=', getAddressStatus(), 'none'],
        ['==', getQrScanned(), true],
        ['>', getScansTotal(), 0],
      ];
      return ['case', isVisited, FLYER_MODE_STATUS_COLORS.visited, FLYER_MODE_STATUS_COLORS.unvisited] as ExpressionSpecification;
    }
    const isQrScanned = ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
    const isHotLead = ['any', ['==', getStatusValue(), 'hot_lead'], ['in', getAddressStatus(), ['literal', ['appointment', 'future_seller']]]];
    const isLead = ['any', ['==', getStatusValue(), 'lead'], ['in', getAddressStatus(), ['literal', ['lead', 'interested', 'hot_lead']]]];
    const isConversation = ['any', ['==', getStatusValue(), 'hot'], ['==', getAddressStatus(), 'talked']];
    const isDoNotKnock = ['any', ['==', getStatusValue(), 'do_not_knock'], ['==', getAddressStatus(), 'do_not_knock']];
    const isNoOneHome = ['any', ['==', getStatusValue(), 'no_answer'], ['in', getAddressStatus(), ['literal', ['no_answer', 'not_home', 'attempted']]]];
    const isTouched = ['any', ['==', getStatusValue(), 'visited'], ['==', getAddressStatus(), 'delivered']];
    const isUntouched = ['all', ['==', getStatusValue(), 'not_visited'], ['==', getAddressStatus(), 'none']];
    
    return [
      'case',
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
      MAP_STATUS_CONFIG.UNTOUCHED.color,

      // Baseline when no toggle applies
      NEUTRAL_FOOTPRINT_COLOR,
    ] as ExpressionSpecification;
  };

  const getLeadGlowOpacityExpression = (): ExpressionSpecification => {
    if (isFlyerMode) return ['case', false, 0, 0] as ExpressionSpecification;
    const getStatusValue = () => ['coalesce', ['feature-state', 'status'], ['get', 'status'], 'not_visited'];
    const getAddressStatus = () => ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none'];
    const isLead = ['any', ['==', getStatusValue(), 'lead'], ['in', getAddressStatus(), ['literal', ['lead', 'interested', 'hot_lead']]]];

    return ['case', ['all', isLead, statusFilters.LEADS], 0.82, 0] as ExpressionSpecification;
  };

  /** Neutral footprint when not using status colors (visible on map, not loud red/salmon). */
  const NEUTRAL_FOOTPRINT_COLOR = '#6b7280';
  const NEUTRAL_EXTRUSION_OPACITY = 0.55;
  const NEUTRAL_CIRCLE_OPACITY = 0.88;
  const getFootprintFillColor = (): string | ExpressionSpecification =>
    footprintStatusColors ? getColorExpression() : NEUTRAL_FOOTPRINT_COLOR;
  const getFootprintFillOpacity = (): number =>
    footprintStatusColors ? 1 : NEUTRAL_EXTRUSION_OPACITY;
  const getCircleOpacity = (): number =>
    footprintStatusColors ? 0.9 : NEUTRAL_CIRCLE_OPACITY;

  // Track if campaign data has been loaded (for "fetch once, render forever" pattern)
  const campaignDataLoadedRef = useRef<string | null>(null);

  const cleanupRenderedLayers = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, addressLabelLayerId);
    safeRemoveLayer(map, circleLayerId);
    safeRemoveLayer(map, circleLeadGlowLayerId);
    safeRemoveLayer(map, leadGlowLayerId);
    safeRemoveLayer(map, layerId);
    safeRemoveLayer(map, shadowLayerId);
    safeRemoveSource(map, addressLabelSourceId);
    safeRemoveSource(map, sourceId);
  }, [map, addressLabelLayerId, circleLayerId, circleLeadGlowLayerId, leadGlowLayerId, layerId, shadowLayerId, addressLabelSourceId, sourceId]);

  // CAMPAIGN MODE: Fetch ALL campaign features once (no viewport filtering)
  // This enables "fetch once, render forever" for buttery smooth pan/zoom
  const fetchCampaignData = useCallback(async () => {
    if (!isMountedRef.current || !campaignId) return;

    setIsFetching(true);
    const campaignDataKey = `${campaignId}:${refreshKey}`;

    try {
      const { manifest, accessToken } = await fetchCampaignMapManifest(campaignId);
      if (hasRenderablePmtilesBuildings(manifest)) {
        const nextSource = toManifestBuildingSource(manifest!, accessToken);
        if (nextSource) {
          campaignDataLoadedRef.current = campaignDataKey;
          setFeatures(null);
          setManifestSource(nextSource);
          return;
        }
      }

      console.warn('[MapBuildingsLayer] PMTiles building layer unavailable.');
      campaignDataLoadedRef.current = campaignDataKey;
      setManifestSource(null);
      setFeatures({ type: 'FeatureCollection', features: [] } as BuildingFeatureCollection);
    } catch (err) {
      console.error('[MapBuildingsLayer] Error in fetchCampaignData:', err);
    } finally {
      if (isMountedRef.current) {
        setIsFetching(false);
      }
    }
  }, [campaignId, refreshKey]);

  // Precompute scaled geometry once per fetch — never inside the render/update effect.
  useEffect(() => {
    if (!features) {
      normalizedFeaturesRef.current = null;
      lastSetDataRef.current = null;
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

        return [{
          ...f,
          geometry: (scaledGeom ?? geom) as GeoJSON.Polygon,
          properties: {
            ...props,
            address_text: displayAddressText({
              formatted: props.address_text,
              house_number: props.house_number,
              street_name: props.street_name,
            }),
            house_number: resolveHouseNumberLabel({
              house_number: props.house_number,
              formatted: props.address_text,
            }),
            feature_id: fid ?? f.id,
          },
        }];
      }),
    } as BuildingFeatureCollection;
    lastSetDataRef.current = null;
  }, [deletedAddressIds, features, hiddenBuildingIds]);

  // EXPLORATION MODE: Fetch buildings in viewport bounding box (when no campaignId)
  const fetchBuildingsInViewport = useCallback(async (bounds: { ne: [number, number]; sw: [number, number] }) => {
    if (!isMountedRef.current) return;


    try {
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
  }, [supabase]);

  // Handle zoom changes (for layer visibility control)
  // In campaign mode: just track zoom for layer visibility (data already loaded)
  // In exploration mode: track zoom AND trigger viewport fetch
  const onZoomChanged = useCallback(() => {
    if (!map || !isMountedRef.current) return;

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Remove layers if zoomed out too far
    if (zoom < 12) {
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(leadGlowLayerId)) {
        try {
          map.removeLayer(leadGlowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(circleLayerId)) {
        try {
          map.removeLayer(circleLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(circleLeadGlowLayerId)) {
        try {
          map.removeLayer(circleLeadGlowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(shadowLayerId)) {
        try {
          map.removeLayer(shadowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
    }
  }, [map, circleLayerId]);

  // EXPLORATION MODE ONLY: Handle viewport changes (pan/zoom)
  // Campaign mode doesn't use this - data is already fully loaded
  const onViewportChanged = useCallback(() => {
    if (!map || !isMountedRef.current || campaignId) return; // Skip if campaign mode

    const zoom = map.getZoom();
    setZoomLevel(zoom);

    // Only fetch if zoomed in enough (zoom >= 12 for better visibility)
    if (zoom < 12) {
      // Remove layers if zoomed out too far
      if (map.getLayer(layerId)) {
        try {
          map.removeLayer(layerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(leadGlowLayerId)) {
        try {
          map.removeLayer(leadGlowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(circleLayerId)) {
        try {
          map.removeLayer(circleLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(circleLeadGlowLayerId)) {
        try {
          map.removeLayer(circleLeadGlowLayerId);
        } catch (err) {
          // Layer might not exist
        }
      }
      if (map.getLayer(shadowLayerId)) {
        try {
          map.removeLayer(shadowLayerId);
        } catch (err) {
          // Layer might not exist
        }
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
  }, [map, campaignId, fetchBuildingsInViewport]);

  // CAMPAIGN MODE: Fetch full campaign data once when campaignId is set
  // This is the "fetch once, render forever" pattern for smooth pan/zoom
  useEffect(() => {
    if (!map || !campaignId) {
      return;
    }
    
    // Only fetch if we haven't already loaded this campaign's data
    const campaignDataKey = `${campaignId}:${refreshKey}`;
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
  }, [map, campaignId, fetchCampaignData, onZoomChanged, refreshKey]);

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

      if (map && map.isStyleLoaded() && zoomLevel >= 12) {
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
  }, [circleLayerId, features, isFetching, layerId, map, onRenderStateChange, zoomLevel]);

  useEffect(() => {
    if (!map || !manifestSource) return;

    const addManifestLayers = () => {
      if (!map.isStyleLoaded()) return;
      cleanupRenderedLayers();

      const vectorSource: mapboxgl.VectorSourceSpecification & { promoteId?: Record<string, string> } = {
        type: 'vector',
        minzoom: manifestSource.minzoom,
        maxzoom: manifestSource.maxzoom,
        promoteId: {
          [manifestSource.sourceLayer]: manifestSource.promoteId,
        },
      };
      if (manifestSource.deliveryMode === 'pmtiles_protocol') {
        vectorSource.url = manifestSource.url;
      } else {
        vectorSource.tiles = [manifestSource.url];
      }
      if (manifestSource.bounds) vectorSource.bounds = manifestSource.bounds;

      map.addSource(sourceId, vectorSource);
      const filterExpr = getFilterExpression();

      map.addLayer({
        id: layerId,
        type: 'fill-extrusion',
        source: sourceId,
        'source-layer': manifestSource.sourceLayer,
        minzoom: manifestSource.minzoom,
        filter: filterExpr ? ['all', POLYGON_GEOMETRY_FILTER, filterExpr] : POLYGON_GEOMETRY_FILTER,
        paint: {
          'fill-extrusion-color': getFootprintFillColor(),
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], ['get', 'height_m'], ['get', 'render_height'], 10] as ExpressionSpecification,
          'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0] as ExpressionSpecification,
          'fill-extrusion-opacity': getFootprintFillOpacity(),
          'fill-extrusion-emissive-strength': 0.85,
        },
      });

      map.addLayer({
        id: leadGlowLayerId,
        type: 'line',
        source: sourceId,
        'source-layer': manifestSource.sourceLayer,
        minzoom: manifestSource.minzoom,
        filter: filterExpr ? ['all', POLYGON_GEOMETRY_FILTER, filterExpr] : POLYGON_GEOMETRY_FILTER,
        paint: {
          'line-color': MAP_STATUS_CONFIG.LEADS.color,
          'line-width': 7,
          'line-opacity': getLeadGlowOpacityExpression(),
          'line-blur': 5,
        },
      });

      try {
        map.setLight({
          anchor: 'map',
          color: 'white',
          intensity: 0.6,
          position: [1.15, 210, 30],
        });
      } catch (error) {
        console.warn('[MapBuildingsLayer] Error setting PMTiles map lighting:', error);
      }

      const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const props = feature?.properties as BuildingProperties | undefined;
        if (!props) return;
        const buildingId = String(props.building_id ?? props.gers_id ?? props.id ?? '').trim();
        if (!buildingId) return;
        const addressId = String(props.address_id ?? '').trim() || undefined;
        const originalEvent = event.originalEvent as MouseEvent | undefined;
        onBuildingClickRef.current?.(buildingId, addressId, {
          additive: Boolean(originalEvent?.metaKey || originalEvent?.ctrlKey),
        });
      };
      const enterHandler = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const leaveHandler = () => {
        map.getCanvas().style.cursor = '';
      };

      // Use map-level handlers so Mapbox does not run layer-scoped
      // queryRenderedFeatures internally during style transitions.
      const mapClickHandler = (event: mapboxgl.MapMouseEvent) => {
        try {
          if (!map.isStyleLoaded() || !map.getLayer(layerId)) return;
          const features = map.queryRenderedFeatures(event.point, {
            layers: [layerId],
          });
          if (features.length > 0) clickHandler(Object.assign(event, { features }));
        } catch {
          return;
        }
      };
      const mapMouseMoveHandler = (event: mapboxgl.MapMouseEvent) => {
        try {
          if (!map.isStyleLoaded() || !map.getLayer(layerId)) {
            leaveHandler();
            return;
          }
          const features = map.queryRenderedFeatures(event.point, {
            layers: [layerId],
          });
          if (features.length > 0) {
            enterHandler();
          } else {
            leaveHandler();
          }
        } catch {
          leaveHandler();
        }
      };

      map.on('click', mapClickHandler);
      map.on('mousemove', mapMouseMoveHandler);

      return () => {
        map.off('click', mapClickHandler);
        map.off('mousemove', mapMouseMoveHandler);
      };
    };

    let cleanupHandlers: (() => void) | undefined;
    let cancelled = false;
    const onStyleLoad = () => {
      if (!cancelled) cleanupHandlers = addManifestLayers();
    };

    if (map.isStyleLoaded()) {
      cleanupHandlers = addManifestLayers();
    } else {
      map.once('style.load', onStyleLoad);
    }

    const reportRenderState = () => {
      const report = onRenderStateChangeRef.current;
      if (!report) return;
      let visibleFeatureCount = 0;
      if (map.isStyleLoaded()) {
        try {
          visibleFeatureCount = map.queryRenderedFeatures({ layers: [layerId] }).length;
        } catch {
          visibleFeatureCount = 0;
        }
      }
      report({
        isFetching: isFetchingRef.current,
        hasData: true,
        hasVisibleFeatures: visibleFeatureCount > 0,
        hasBuildingPolygons: true,
        featureCount: visibleFeatureCount,
        visibleFeatureCount,
        zoomLevel: map.getZoom(),
      });
    };

    map.on('idle', reportRenderState);
    map.on('moveend', reportRenderState);
    map.on('zoomend', reportRenderState);

    return () => {
      cancelled = true;
      map.off('style.load', onStyleLoad);
      cleanupHandlers?.();
      map.off('idle', reportRenderState);
      map.off('moveend', reportRenderState);
      map.off('zoomend', reportRenderState);
      cleanupRenderedLayers();
    };
  }, [map, manifestSource, cleanupRenderedLayers, sourceId, layerId, leadGlowLayerId]);

  useEffect(() => {
    if (!map || !manifestSource || !campaignId || !addressStateOverrides?.length) return;

    let frameId: number | null = null;
    const statusRank = { not_visited: 0, visited: 1, no_answer: 2, do_not_knock: 3, hot: 4, lead: 5, hot_lead: 6 } as const;
    const buildingStateById = new Map<
      string,
      { status: 'not_visited' | 'visited' | 'hot' | 'lead' | 'hot_lead' | 'no_answer' | 'do_not_knock'; scans_total: number; qr_scanned: boolean }
    >();
    const addressStateById = new Map<
      string,
      { status: 'not_visited' | 'visited' | 'hot' | 'lead' | 'hot_lead' | 'no_answer' | 'do_not_knock'; scans_total: number; qr_scanned: boolean }
    >();

    for (const address of addressStateOverrides) {
      addressStateById.set(address.id, {
        status: getCampaignBuildingStatus(address),
        scans_total: Number(address.scans ?? 0),
        qr_scanned: Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at),
      });

      const buildingId =
        (address as CampaignAddress & { building_id?: string | null }).building_id ??
        address.gers_id ??
        null;
      if (!buildingId) continue;

      const nextState = {
        status: getCampaignBuildingStatus(address),
        scans_total: Number(address.scans ?? 0),
        qr_scanned: Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at),
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
      });
    }

    const applyState = (attempt = 0) => {
      if (!safeGetSource(map, sourceId)) {
        if (attempt < 8) frameId = requestAnimationFrame(() => applyState(attempt + 1));
        return;
      }

      for (const [addressId, featureState] of addressStateById.entries()) {
        try {
          map.setFeatureState(
            { source: sourceId, sourceLayer: manifestSource.sourceLayer, id: addressId },
            featureState
          );
        } catch (error) {
          console.warn('[MapBuildingsLayer] Failed to apply PMTiles address feature-state:', error);
        }
      }

      for (const [buildingId, featureState] of buildingStateById.entries()) {
        try {
          map.setFeatureState(
            { source: sourceId, sourceLayer: manifestSource.sourceLayer, id: buildingId },
            featureState
          );
        } catch (error) {
          console.warn('[MapBuildingsLayer] Failed to apply PMTiles building feature-state:', error);
        }
      }
    };

    applyState();

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [map, manifestSource, campaignId, addressStateOverrides, sourceId]);

  // Update Mapbox source and layer when features change
  useEffect(() => {
    if (manifestSource) return;
    // Only bail if map doesn't exist
    if (!map) {
      return;
    }

    let cleanupLayerInteractionHandlers: (() => void) | undefined;

    // Define the update logic as a function we can call or defer
    const updateLayers = () => {
      // Check if style is loaded - we need this to add layers
      if (!map.isStyleLoaded()) {
        return;
      }

      const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      const labelSource = map.getSource(addressLabelSourceId) as mapboxgl.GeoJSONSource | undefined;
      const addressLabelFeatures = buildAddressLabelFeatureCollection(addressStateOverrides);

      // Use precomputed geometry — no clone/rescale on this path.
      const normalizedFeatures = normalizedFeaturesRef.current;

      // Only call setData if geometry actually changed.
      if (source && normalizedFeatures && normalizedFeatures !== lastSetDataRef.current) {
        source.setData(normalizedFeatures);
        lastSetDataRef.current = normalizedFeatures;
      }

      if (labelSource) {
        labelSource.setData(addressLabelFeatures);
      }

      if (!normalizedFeatures || normalizedFeatures.features.length === 0) {
        return;
      }
      
      if (zoomLevel < 12) {
        return;
      }

      // Remove any existing route layers/sources that might conflict with buildings
      // This prevents z-fighting and rendering issues
      const routeLayers = ['route-lines', 'route-lines-inter', 'route-lines-glow', 'route-points', 'route-labels', 'route-start', 'block-stops', 'block-stop-labels'];
      const routeSources = ['route-source', 'route-source-inter', 'route-points-source', 'block-stops-source'];
      
      routeLayers.forEach(id => {
        if (map.getLayer(id)) {
          try { map.removeLayer(id); } catch (e) {}
        }
      });
      
      routeSources.forEach(id => {
        if (map.getSource(id)) {
          try { map.removeSource(id); } catch (e) {}
        }
      });

      // Create source if it doesn't exist yet (source update already handled above)
      if (!source) {
        try {
          map.addSource(sourceId, {
            type: 'geojson',
            data: normalizedFeatures,
            // promoteId enables setFeatureState() for real-time color updates
            // Use feature_id (unique per feature: unit id or gers_id for detached)
            promoteId: 'feature_id',
            // Buffer extends tile loading 512px beyond viewport edge
            // This prevents edge-clipping when panning in campaign mode
            buffer: 512,
            // Tolerance for geometry simplification (smaller = more detail)
            tolerance: 0.5,
          });
          lastSetDataRef.current = normalizedFeatures;
        } catch (err) {
          console.error('Error adding source:', err);
          return;
        }
      }

      if (!labelSource) {
        try {
          map.addSource(addressLabelSourceId, {
            type: 'geojson',
            data: addressLabelFeatures,
            promoteId: 'feature_id',
          });
        } catch (err) {
          console.error('Error adding address label source:', err);
        }
      }

      // Add or update fill-extrusion layer (for Polygon/MultiPolygon geometries)
      if (!map.getLayer(layerId)) {
        try {
          // NOTE: Shadow layer removed to fix "dark square" visual artifact
          // The 3D fill-extrusion with proper lighting provides sufficient visual depth
          const filterExpr = getFilterExpression();

          // Filter for polygon features only
          const polygonFilter: FilterSpecification = POLYGON_GEOMETRY_FILTER;
          const buildingHeightExpression = ['coalesce', ['get', 'height'], ['get', 'height_m'], 14] as ExpressionSpecification;
          
          // Add the main building layer
          // Add without beforeId to place at end (on top of everything, including labels)
          const layerConfig: FillExtrusionLayerSpecification = {
            id: layerId,
            type: 'fill-extrusion',
            source: sourceId,
            minzoom: 12,
            filter: filterExpr ? ['all', polygonFilter, filterExpr] : polygonFilter,
            paint: {
              'fill-extrusion-color': getFootprintFillColor(),
              'fill-extrusion-vertical-gradient': true,
              'fill-extrusion-height': buildingHeightExpression,
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': getFootprintFillOpacity(),
              'fill-extrusion-emissive-strength': 0.85,
            },
          };
          
          // Add without beforeId - this places it at the end (on top of everything)
          map.addLayer(layerConfig);

          if (!map.getLayer(leadGlowLayerId)) {
            const leadGlowLayerConfig: LineLayerSpecification = {
              id: leadGlowLayerId,
              type: 'line',
              source: sourceId,
              minzoom: 12,
              filter: filterExpr ? ['all', polygonFilter, filterExpr] : polygonFilter,
              paint: {
                'line-color': MAP_STATUS_CONFIG.LEADS.color,
                'line-width': 7,
                'line-opacity': getLeadGlowOpacityExpression(),
                'line-blur': 5,
              },
            };
            map.addLayer(leadGlowLayerConfig);
          }
          
          // Add circle layer for Point geometries (addresses without building polygons)
          if (!map.getLayer(circleLeadGlowLayerId)) {
            map.addLayer({
              id: circleLeadGlowLayerId,
              type: 'circle' as const,
              source: sourceId,
              minzoom: 12,
              filter: filterExpr
                ? ['all', ['==', ['geometry-type'], 'Point'], filterExpr]
                : ['==', ['geometry-type'], 'Point'],
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
              minzoom: 12,
              filter: filterExpr 
                ? ['all', ['==', ['geometry-type'], 'Point'], filterExpr]
                : ['==', ['geometry-type'], 'Point'],
              paint: {
                'circle-radius': 5,
                'circle-color': getFootprintFillColor(),
                'circle-opacity': getCircleOpacity(),
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
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

        // Outline layer removed to eliminate dark shadow effect underneath buildings

        // Set map lighting for 3D depth visualization
        // Use 'map' anchor instead of 'viewport' to avoid lighting warnings and ensure consistent 3D depth
        try {
          map.setLight({
            anchor: 'map',
            color: 'white',
            intensity: 0.6, // Increased intensity for better visibility on dark backgrounds
            position: [1.15, 210, 30]
          });
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
          
          const gersId = props.gers_id || props.id;
          
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
        }
      } else {
        // Update paint properties for existing layer to ensure opacity is correct
        try {
          map.setPaintProperty(layerId, 'fill-extrusion-opacity', getFootprintFillOpacity());
          map.setPaintProperty(layerId, 'fill-extrusion-color', getFootprintFillColor());
          map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);

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
        } catch (err) {
          console.error('Error updating layer paint properties:', err);
        }
      }
    }; // End of updateLayers function

    // Always attempt to run updateLayers - it will handle style loading state internally
    // If style isn't loaded yet, we also set up an idle listener as backup
    const styleLoaded = map.isStyleLoaded();
    
    // Wrapper for idle listener so we can remove it
    const onIdle = () => {
      updateLayers();
    };
    
    // Wrapper for style.load listener
    const onStyleLoad = () => {
      updateLayers();
    };
    
    if (styleLoaded) {
      // Style is ready - run immediately
      updateLayers();
    } else {
      // Style not ready - set up idle listener as backup
      map.once('idle', onIdle);
    }
    
    // Also listen for style.load to handle style changes (e.g., switching map themes)
    map.on('style.load', onStyleLoad);

    // Cleanup listeners
    return () => {
      map.off('idle', onIdle);
      map.off('style.load', onStyleLoad);
      cleanupLayerInteractionHandlers?.();
    };
  }, [map, features, zoomLevel, onBuildingClick, statusFilters, campaignId, supabase, onAddToCRM, showOrphans, showAddressLabels, footprintStatusColors, addressStateOverrides]);

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
      map.setFilter(layerId, filterExpr ? ['all', POLYGON_GEOMETRY_FILTER, filterExpr] : POLYGON_GEOMETRY_FILTER);
      if (map.getLayer(leadGlowLayerId)) {
        map.setPaintProperty(leadGlowLayerId, 'line-opacity', getLeadGlowOpacityExpression());
        map.setFilter(leadGlowLayerId, filterExpr ? ['all', POLYGON_GEOMETRY_FILTER, filterExpr] : POLYGON_GEOMETRY_FILTER);
      }
      if (map.getLayer(circleLeadGlowLayerId)) {
        map.setPaintProperty(circleLeadGlowLayerId, 'circle-opacity', getLeadGlowOpacityExpression());
        map.setFilter(circleLeadGlowLayerId, filterExpr ? ['all', POINT_GEOMETRY_FILTER, filterExpr] : POINT_GEOMETRY_FILTER);
      }
      if (map.getLayer(circleLayerId)) {
        map.setPaintProperty(circleLayerId, 'circle-color', colorExpr);
        map.setPaintProperty(circleLayerId, 'circle-opacity', getCircleOpacity());
        map.setFilter(circleLayerId, filterExpr ? ['all', POINT_GEOMETRY_FILTER, filterExpr] : POINT_GEOMETRY_FILTER);
      }
    } catch (err) {
      console.error('[MapBuildingsLayer] Error updating color/filter:', err);
    }
  }, [map, statusFilters, campaignId, layerId, showOrphans, footprintStatusColors, circleLayerId]);

  // Update filter when showOrphans changes (toggle visibility of orphan buildings)
  useEffect(() => {
    if (!map) return;
    
    const updateFilters = () => {
      const filterExpr = getFilterExpression();
      
      try {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, filterExpr ? ['all', POLYGON_GEOMETRY_FILTER, filterExpr] : POLYGON_GEOMETRY_FILTER);
        }
        if (map.getLayer(circleLayerId)) {
          map.setFilter(circleLayerId, filterExpr ? ['all', POINT_GEOMETRY_FILTER, filterExpr] : POINT_GEOMETRY_FILTER);
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
  }, [map, showOrphans, campaignId, statusFilters, layerId, circleLayerId]);

  // Re-apply lighting and refresh colors when map style loads (important for dark mode)
  useEffect(() => {
    if (!map) return;

    const applyLightingAndColors = () => {
      try {
        // Apply lighting for 3D depth
        map.setLight({
          anchor: 'map', // Use 'map' anchor to avoid viewport anchor warnings
          color: 'white',
          intensity: 0.6, // Increased intensity for better visibility on dark backgrounds
          position: [1.15, 210, 30]
        });

        // Refresh colors after style change (ensures they're applied correctly)
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'fill-extrusion-color', getFootprintFillColor());
          map.setPaintProperty(layerId, 'fill-extrusion-opacity', getFootprintFillOpacity());
          map.setPaintProperty(layerId, 'fill-extrusion-vertical-gradient', true);
        }
        if (map.getLayer(leadGlowLayerId)) {
          map.setPaintProperty(leadGlowLayerId, 'line-opacity', getLeadGlowOpacityExpression());
        }
        if (map.getLayer(circleLeadGlowLayerId)) {
          map.setPaintProperty(circleLeadGlowLayerId, 'circle-opacity', getLeadGlowOpacityExpression());
        }
        if (map.getLayer(circleLayerId)) {
          map.setPaintProperty(circleLayerId, 'circle-color', getFootprintFillColor());
          map.setPaintProperty(circleLayerId, 'circle-opacity', getCircleOpacity());
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
  }, [map, layerId, circleLayerId, footprintStatusColors]);

  // Real-time subscription for building_stats updates
  // When a QR code is scanned, building_stats is updated via trigger
  // This subscription catches that change and updates the map colors instantly
  // Uses setFeatureState() for efficient real-time updates (no full re-render)
  useEffect(() => {
    if (!map || !campaignId || useCanonicalAddressState) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for building_stats, campaignId:', campaignId);

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
            // Features use promoteId: 'feature_id' (unit id or gers_id for detached). building_stats is keyed by gers_id.
            // So we update every feature whose gers_id matches (one for detached, multiple for unit slices).
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
                  .map((f: GeoJSON.Feature) => getStringRecordValue(toRecord(f.properties), 'feature_id'))
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
  }, [map, campaignId, supabase, useCanonicalAddressState]);

  // Real-time subscription for scan_events (direct scan tracking)
  // This is a fallback in case building_stats trigger fails or realtime isn't enabled
  useEffect(() => {
    if (!map || !campaignId || useCanonicalAddressState) return;

    console.log('[MapBuildingsLayer] Setting up real-time subscription for scan_events, campaignId:', campaignId);

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
  }, [map, campaignId, supabase, useCanonicalAddressState]);

  // Real-time subscription for building_address_links (stable linker: map snaps grey → red as links are added)
  useEffect(() => {
    if (!map || !campaignId) return;

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
  }, [map, campaignId, supabase, fetchCampaignData]);

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

  return null; // This component doesn't render anything directly
}
