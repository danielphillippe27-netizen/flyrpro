'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { CampaignAddress, CampaignType } from '@/types/database';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
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
import {
  appendTileAccessToken,
  fetchCampaignMapManifest,
  hasRenderablePmtilesAddresses,
  type CampaignMapManifest,
} from '@/lib/map/campaignMapManifest';

type ManifestAddressSource = {
  deliveryMode: 'backend_zxy';
  url: string;
  sourceLayer: string;
  promoteId: string;
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
};

type CampaignAddressPmtilesLayerProps = {
  map: mapboxgl.Map;
  campaignId: string | null | undefined;
  mapLoaded: boolean;
  visible: boolean;
  addresses: CampaignAddress[];
  campaignType?: CampaignType | null;
  statusFilters?: StatusFilters;
  deletedAddressIds?: string[];
  campaignBoundary?: GeoJSON.Polygon | null;
  campaignBbox?: [number, number, number, number] | null;
  styleKey?: string;
  isDarkMap?: boolean;
  allowFallbackFetches?: boolean;
  onAddressClick?: (
    addressId: string,
    buildingId: string | null,
    options?: {
      additive?: boolean;
    }
  ) => void;
};

type AddressApiFeature = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>;

const SOURCE_ID = 'campaign-addresses-pmtiles-source';
const GLOW_LAYER_ID = 'campaign-addresses-pmtiles-lead-glow';
const CIRCLE_LAYER_ID = 'campaign-addresses-pmtiles-circle';
const LABEL_LAYER_ID = 'campaign-addresses-pmtiles-label';
const ADDRESS_LABEL_MIN_ZOOM = 17;
const ADDRESS_CYLINDER_RADIUS_METERS = 2.6;
const ADDRESS_CYLINDER_HEIGHT_METERS = 12;
const ADDRESS_CYLINDER_COLOR = '#6b7280';
const ADDRESS_LABEL_CAP_CLEARANCE_METERS = 0.08;
const ADDRESS_LABEL_EXPRESSION: mapboxgl.Expression = [
  'coalesce',
  ['get', 'house_number_label'],
  ['get', 'house_number'],
  ['get', 'street_number'],
  '',
];
const ADDRESS_ID_EXPRESSION: mapboxgl.Expression = [
  'coalesce',
  ['get', 'address_id'],
  ['get', 'address_detail_pid'],
  ['get', 'gers_id'],
  ['get', 'building_gers_id'],
  ['get', 'id'],
  '',
];
const NO_FEATURES_FILTER: mapboxgl.Expression = ['==', ['literal', 1], 0];

function buildAddressStatusColorExpression(statusFilters: StatusFilters, isDarkMap: boolean): mapboxgl.Expression {
  const untouchedAddressColor = getMapUntouchedColor(isDarkMap);
  const getAddressStatus = () => [
    'downcase',
    ['to-string', ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], ['get', 'status'], 'none']],
  ];
  const getScansTotal = () => ['to-number', ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], ['get', 'scans'], 0], 0];
  const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
  const isQrScanned = ['any', ['==', getQrScanned(), true], ['==', getQrScanned(), 'true'], ['>', getScansTotal(), 0]];
  const isHotLead = ['in', getAddressStatus(), ['literal', HOT_LEAD_ADDRESS_STATUSES]];
  const isLead = ['in', getAddressStatus(), ['literal', LEAD_ADDRESS_STATUSES]];
  const isConversation = ['in', getAddressStatus(), ['literal', CONVERSATION_ADDRESS_STATUSES]];
  const isDoNotKnock = ['==', getAddressStatus(), 'do_not_knock'];
  const isNoOneHome = ['in', getAddressStatus(), ['literal', NO_ONE_HOME_ADDRESS_STATUSES]];
  const isTouched = ['in', getAddressStatus(), ['literal', TOUCHED_ADDRESS_STATUSES]];
  const isUntouched = ['in', getAddressStatus(), ['literal', UNTOUCHED_ADDRESS_STATUSES]];

  return [
    'case',
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
    untouchedAddressColor,
    ADDRESS_CYLINDER_COLOR,
  ] as mapboxgl.Expression;
}

function safeRemoveLayer(map: mapboxgl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // Map style may be mid-transition.
  }
}

function safeRemoveSource(map: mapboxgl.Map, sourceId: string) {
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    // Map style may be mid-transition.
  }
}

function cleanupAddressLayers(map: mapboxgl.Map) {
  safeRemoveLayer(map, LABEL_LAYER_ID);
  safeRemoveLayer(map, CIRCLE_LAYER_ID);
  safeRemoveLayer(map, GLOW_LAYER_ID);
  safeRemoveSource(map, SOURCE_ID);
}

function campaignBoundaryWithinFilter(boundary?: GeoJSON.Polygon | null): mapboxgl.Expression | undefined {
  if (!boundary?.coordinates?.[0]?.length) return undefined;
  return ['within', boundary] as unknown as mapboxgl.Expression;
}

function canAddCustomMapLayers(map: mapboxgl.Map): boolean {
  try {
    const style = map.getStyle();
    return Boolean(style && Array.isArray(style.layers) && style.sources);
  } catch {
    return false;
  }
}

function toManifestAddressSource(
  manifest: CampaignMapManifest,
  accessToken: string | null
): ManifestAddressSource | null {
  const layer = manifest.layers?.addresses;
  const sourceLayer = layer?.sourceLayer ?? manifest.address_source_layer ?? manifest.source_layers?.address_circles ?? manifest.source_layers?.addresses;
  if (!sourceLayer) return null;

  const vectorTileUrlTemplate = layer?.vectorTileUrlTemplate ?? manifest.address_vector_tile_url_template;
  if (!vectorTileUrlTemplate) return null;

  return {
    deliveryMode: 'backend_zxy',
    url: appendTileAccessToken(vectorTileUrlTemplate, accessToken),
    sourceLayer,
    promoteId: layer?.promoteId ?? manifest.address_promote_id ?? manifest.promote_ids?.address_circles ?? manifest.promote_ids?.addresses ?? 'address_id',
    minzoom: layer?.minzoom ?? manifest.address_minzoom ?? 10,
    maxzoom: layer?.maxzoom ?? manifest.address_maxzoom ?? 16,
    bounds: layer?.bounds ?? manifest.address_bounds ?? manifest.bounds ?? undefined,
  };
}

function getStatusState(address: CampaignAddress) {
  const scansTotal = Number(address.scans ?? 0);
  return {
    address_status: getCampaignAddressMapStatus(address),
    scans_total: scansTotal,
    qr_scanned: scansTotal > 0 || Boolean(address.last_scanned_at),
  };
}

function getAddressCoordinate(address: CampaignAddress): { lon: number; lat: number } | null {
  if (address.coordinate) {
    const { lon, lat } = address.coordinate;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { lon, lat };
    }
  }

  const addressWithGeo = address as CampaignAddress & {
    geometry?: unknown;
    geom_json?: unknown;
  };

  const geomJson = addressWithGeo.geom_json;
  if (geomJson && typeof geomJson === 'object' && (geomJson as GeoJSON.Point).type === 'Point') {
    const coordinates = (geomJson as GeoJSON.Point).coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const [lon, lat] = coordinates;
      if (typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)) {
        return { lon, lat };
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

  if (geometry && typeof geometry === 'object' && (geometry as GeoJSON.Point).type === 'Point') {
    const coordinates = (geometry as GeoJSON.Point).coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const [lon, lat] = coordinates;
      if (typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)) {
        return { lon, lat };
      }
    }
  }

  if (address.geom) {
    try {
      const geomValue = typeof address.geom === 'string' ? address.geom : JSON.stringify(address.geom);
      try {
        const parsed = JSON.parse(geomValue) as { coordinates?: unknown[] };
        const coordinates = parsed.coordinates;
        if (Array.isArray(coordinates) && coordinates.length >= 2) {
          const [lon, lat] = coordinates;
          if (typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat)) {
            return { lon, lat };
          }
        }
      } catch {
        const match = geomValue.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (match) {
          const lon = Number.parseFloat(match[1]);
          const lat = Number.parseFloat(match[2]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            return { lon, lat };
          }
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getHouseNumber(address: CampaignAddress): string {
  const explicit = String(address.house_number ?? '').trim();
  if (explicit) return explicit;

  const formatted = String(address.formatted ?? address.address ?? '').trim();
  return formatted.match(/^(\d+[A-Za-z0-9-]*)\b/)?.[1] ?? '';
}

function stringIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function stringProperty(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function addressFeatureToCampaignAddress(
  feature: AddressApiFeature,
  campaignId: string
): CampaignAddress | null {
  if (feature.geometry?.type !== 'Point') return null;
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const properties = feature.properties ?? {};
  const id =
    stringProperty(properties, 'id') ??
    stringProperty(properties, 'address_id') ??
    stringProperty(properties, 'address_detail_pid') ??
    (typeof feature.id === 'string' || typeof feature.id === 'number' ? String(feature.id) : undefined) ??
    `${lon},${lat}`;
  const formatted =
    stringProperty(properties, 'formatted') ??
    stringProperty(properties, 'address') ??
    stringProperty(properties, 'full_address') ??
    '';

  return {
    id,
    campaign_id: campaignId,
    address: formatted,
    formatted,
    postal_code: stringProperty(properties, 'postal_code') ?? stringProperty(properties, 'postcode'),
    source: 'map',
    source_id: stringProperty(properties, 'source_id') ?? stringProperty(properties, 'gers_id') ?? id,
    gers_id: stringProperty(properties, 'gers_id'),
    building_id: stringProperty(properties, 'building_id'),
    building_gers_id: stringProperty(properties, 'building_gers_id'),
    house_number: stringProperty(properties, 'house_number') ?? stringProperty(properties, 'number'),
    street_name: stringProperty(properties, 'street_name') ?? stringProperty(properties, 'street'),
    locality: stringProperty(properties, 'locality') ?? stringProperty(properties, 'city'),
    region: stringProperty(properties, 'region'),
    coordinate: { lon, lat },
    created_at: new Date(0).toISOString(),
    visited: Boolean(properties.visited),
    scans: Number(properties.scans_total ?? properties.scans ?? 0),
  };
}

function makeCirclePolygon(
  center: { lon: number; lat: number },
  radiusMeters: number,
  steps = 28
): GeoJSON.Polygon {
  const latRadians = center.lat * Math.PI / 180;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = Math.max(1, Math.abs(Math.cos(latRadians)) * 111_320);
  const ring: Array<[number, number]> = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusMeters;
    const dy = Math.sin(angle) * radiusMeters;
    ring.push([
      center.lon + dx / metersPerDegreeLon,
      center.lat + dy / metersPerDegreeLat,
    ]);
  }

  ring.push([...ring[0]]);
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

function buildFallbackAddressFeatureCollection(
  addresses: CampaignAddress[],
  deletedAddressSet: Set<string>
): GeoJSON.FeatureCollection<GeoJSON.Point | GeoJSON.Polygon> {
  return {
    type: 'FeatureCollection',
    features: addresses.flatMap((address) => {
      if (deletedAddressSet.has(address.id)) return [];
      const coordinate = getAddressCoordinate(address);
      if (!coordinate) return [];
      const buildingId =
        (address as CampaignAddress & { building_id?: string | null }).building_id ??
        address.building_gers_id ??
        address.gers_id ??
        null;
      const statusState = getStatusState(address);
      const properties = {
        id: address.id,
        address_id: address.id,
        building_id: buildingId,
        gers_id: address.gers_id ?? null,
        house_number: getHouseNumber(address),
        house_number_label: getHouseNumber(address),
        formatted: address.formatted ?? address.address ?? '',
        address_status: statusState.address_status,
        scans_total: statusState.scans_total,
        qr_scanned: statusState.qr_scanned,
      };

      return [
        ({
          type: 'Feature',
          id: `${address.id}:cylinder`,
          geometry: makeCirclePolygon(coordinate, ADDRESS_CYLINDER_RADIUS_METERS),
          properties: {
            ...properties,
            geometry_source: 'campaign_address_cylinder',
          },
        } satisfies GeoJSON.Feature<GeoJSON.Polygon>),
        ({
        type: 'Feature',
        id: `${address.id}:label`,
        geometry: {
          type: 'Point',
          coordinates: [coordinate.lon, coordinate.lat],
        },
        properties: {
          ...properties,
          geometry_source: 'campaign_address_point',
        },
      } satisfies GeoJSON.Feature<GeoJSON.Point>),
      ];
    }),
  };
}

export function CampaignAddressPmtilesLayer({
  map,
  campaignId,
  mapLoaded,
  visible,
  addresses,
  statusFilters = DEFAULT_STATUS_FILTERS,
  deletedAddressIds = [],
  campaignBoundary,
  styleKey,
  isDarkMap = false,
  allowFallbackFetches = true,
  onAddressClick,
}: CampaignAddressPmtilesLayerProps) {
  const [manifestSource, setManifestSource] = useState<ManifestAddressSource | null | undefined>(undefined);
  const [apiFallbackAddresses, setApiFallbackAddresses] = useState<CampaignAddress[]>([]);
  const onAddressClickRef = useRef(onAddressClick);
  const renderAddresses = addresses.length > 0 ? addresses : apiFallbackAddresses;
  const addressColorExpression = useMemo(
    () => buildAddressStatusColorExpression(statusFilters, isDarkMap),
    [statusFilters, isDarkMap]
  );
  const deletedAddressSet = useMemo(
    () => new Set(deletedAddressIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
    [deletedAddressIds]
  );
  const campaignAddressIds = useMemo(() => {
    const ids = new Set<string>();
    for (const address of renderAddresses) {
      [
        address.id,
        address.source_id,
        address.gers_id,
        address.building_gers_id,
        (address as CampaignAddress & { address_detail_pid?: string | null }).address_detail_pid,
      ].forEach((value) => {
        const normalized = stringIdentifier(value);
        if (normalized) ids.add(normalized);
      });
    }
    return ids;
  }, [renderAddresses]);

  useEffect(() => {
    if (addresses.length > 0) {
      setApiFallbackAddresses([]);
    }
  }, [addresses.length]);

  useEffect(() => {
    onAddressClickRef.current = onAddressClick;
  }, [onAddressClick]);

  const getVisibilityFilter = (): mapboxgl.Expression | undefined => {
    if (deletedAddressSet.size === 0) return undefined;
    return ['!', ['in', ADDRESS_ID_EXPRESSION, ['literal', Array.from(deletedAddressSet)]]] as mapboxgl.Expression;
  };

  const getCampaignScopeFilter = (): mapboxgl.Expression => {
    if (campaignAddressIds.size === 0) {
      return (manifestSource ? campaignBoundaryWithinFilter(campaignBoundary) : undefined) ?? NO_FEATURES_FILTER;
    }
    return ['in', ADDRESS_ID_EXPRESSION, ['literal', Array.from(campaignAddressIds)]] as mapboxgl.Expression;
  };

  const getLayerFilter = (geometryType: 'Point' | 'Polygon'): mapboxgl.Expression => {
    const visibilityFilter = getVisibilityFilter();
    const geometryFilter = ['==', ['geometry-type'], geometryType] as mapboxgl.Expression;
    return [
      'all',
      geometryFilter,
      getCampaignScopeFilter(),
      ...(visibilityFilter ? [visibilityFilter] : []),
    ] as mapboxgl.Expression;
  };

  useEffect(() => {
    let cancelled = false;

    const loadManifest = async () => {
      if (!campaignId || !visible || addresses.length > 0 || !allowFallbackFetches) {
        setManifestSource(null);
        return;
      }

      const { manifest, accessToken } = await fetchCampaignMapManifest(campaignId);
      if (cancelled) return;

      if (!hasRenderablePmtilesAddresses(manifest)) {
        setManifestSource(null);
        return;
      }

      setManifestSource(toManifestAddressSource(manifest!, accessToken));
    };

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [allowFallbackFetches, campaignId, visible, addresses.length]);

  useEffect(() => {
    let cancelled = false;

    const loadApiFallbackAddresses = async () => {
      if (!campaignId || !visible || manifestSource !== null || addresses.length > 0 || !allowFallbackFetches) {
        if (!cancelled && addresses.length > 0) setApiFallbackAddresses([]);
        if (!cancelled && !allowFallbackFetches) setApiFallbackAddresses([]);
        return;
      }

      try {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/addresses`, {
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const payload = await response.json();
        const features: AddressApiFeature[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.features)
            ? payload.features
            : [];
        const fallbackAddresses = features
          .map((feature) => addressFeatureToCampaignAddress(feature, campaignId))
          .filter((address): address is CampaignAddress => Boolean(address));
        if (!cancelled) {
          setApiFallbackAddresses(fallbackAddresses);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[CampaignAddressPmtilesLayer] Failed to load address GeoJSON fallback:', error);
        }
      }
    };

    void loadApiFallbackAddresses();

    return () => {
      cancelled = true;
    };
  }, [allowFallbackFetches, campaignId, visible, manifestSource, addresses.length]);

  useEffect(() => {
    if (!map || !mapLoaded || !visible) {
      cleanupAddressLayers(map);
      return;
    }

    if (manifestSource === undefined) {
      cleanupAddressLayers(map);
      return;
    }

    const hasExpectedAddressLayers = () =>
      Boolean(map.getSource(SOURCE_ID) && map.getLayer(CIRCLE_LAYER_ID));

    const addLocalCylinderLayers = () => {
      if (!canAddCustomMapLayers(map)) return;
      cleanupAddressLayers(map);

      const geojson = buildFallbackAddressFeatureCollection(renderAddresses, deletedAddressSet);
      if (geojson.features.length === 0) return;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson,
        promoteId: 'address_id',
      });

      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'fill-extrusion',
        source: SOURCE_ID,
        minzoom: 12,
        filter: getLayerFilter('Polygon'),
        layout: {
          'fill-extrusion-edge-radius': 0.2,
        },
        paint: {
          'fill-extrusion-color': addressColorExpression,
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-height': ADDRESS_CYLINDER_HEIGHT_METERS,
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-emissive-strength': 0.45,
          'fill-extrusion-rounded-roof': true,
        },
      } as mapboxgl.AnyLayer);

      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: ADDRESS_LABEL_MIN_ZOOM,
        filter: getLayerFilter('Point'),
        layout: {
          'text-field': ADDRESS_LABEL_EXPRESSION,
          'text-size': ['interpolate', ['linear'], ['zoom'], ADDRESS_LABEL_MIN_ZOOM, 10, 22, 13],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
          'text-pitch-alignment': 'map',
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-placement': 'point',
          'symbol-z-order': 'auto',
          'symbol-z-elevate': true,
          'symbol-elevation-reference': 'ground',
        },
        paint: {
          'text-color': '#f9fafb',
          'text-opacity': 0.95,
          'text-halo-color': '#111827',
          'text-halo-width': 1.5,
          'symbol-z-offset': ADDRESS_LABEL_CAP_CLEARANCE_METERS,
          'text-occlusion-opacity': 1,
        },
      } as mapboxgl.AnyLayer);

      const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const props = feature?.properties ?? {};
        const addressId = String(props.address_id ?? props.address_detail_pid ?? props.id ?? '').trim();
        if (!addressId) return;
        const buildingId = String(props.building_id ?? props.building_gers_id ?? props.gers_id ?? '').trim() || null;
        const originalEvent = event.originalEvent as MouseEvent | undefined;
        onAddressClickRef.current?.(addressId, buildingId, {
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
          if (!map.isStyleLoaded() || !map.getLayer(CIRCLE_LAYER_ID)) return;
          const features = map.queryRenderedFeatures(event.point, {
            layers: [CIRCLE_LAYER_ID],
          });
          if (features.length > 0) clickHandler(Object.assign(event, { features }));
        } catch {
          return;
        }
      };

      // Use map-level mousemove so hover does not depend on Mapbox's
      // layer-scoped mouseenter/mouseleave dispatch during style transitions.
      const mapMouseMoveHandler = (event: mapboxgl.MapMouseEvent) => {
        try {
          if (!map.isStyleLoaded() || !map.getLayer(CIRCLE_LAYER_ID)) {
            leaveHandler();
            return;
          }
          const features = map.queryRenderedFeatures(event.point, {
            layers: [CIRCLE_LAYER_ID],
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

    const addManifestAddressLayers = (source: ManifestAddressSource) => {
      if (!canAddCustomMapLayers(map)) return;
      cleanupAddressLayers(map);

      const vectorSource: mapboxgl.VectorSourceSpecification & {
        buffer?: number;
        promoteId?: Record<string, string>;
      } = {
        type: 'vector',
        minzoom: source.minzoom,
        maxzoom: source.maxzoom,
        buffer: 128,
        promoteId: {
          [source.sourceLayer]: source.promoteId,
        },
        tiles: [source.url],
      };
      if (source.bounds) vectorSource.bounds = source.bounds;

      map.addSource(SOURCE_ID, vectorSource);

      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: 'fill-extrusion',
        source: SOURCE_ID,
        'source-layer': source.sourceLayer,
        minzoom: source.minzoom,
        filter: getLayerFilter('Polygon'),
        layout: {
          'fill-extrusion-edge-radius': 0.2,
        },
        paint: {
          'fill-extrusion-color': addressColorExpression,
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-height': ADDRESS_CYLINDER_HEIGHT_METERS,
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-emissive-strength': 0.45,
          'fill-extrusion-rounded-roof': true,
        },
      } as mapboxgl.AnyLayer);

      map.addLayer({
        id: GLOW_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        'source-layer': source.sourceLayer,
        minzoom: source.minzoom,
        filter: getLayerFilter('Point'),
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 17, 5],
          'circle-color': addressColorExpression,
          'circle-opacity': 0.88,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#111827',
        },
      } as mapboxgl.AnyLayer);

      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        'source-layer': source.sourceLayer,
        minzoom: ADDRESS_LABEL_MIN_ZOOM,
        filter: ['in', ['geometry-type'], ['literal', ['Point', 'Polygon']]] as mapboxgl.Expression,
        layout: {
          'text-field': ADDRESS_LABEL_EXPRESSION,
          'text-size': ['interpolate', ['linear'], ['zoom'], ADDRESS_LABEL_MIN_ZOOM, 10, 22, 13],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
          'text-pitch-alignment': 'map',
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'symbol-placement': 'point',
          'symbol-z-order': 'auto',
        },
        paint: {
          'text-color': '#f9fafb',
          'text-opacity': 0.95,
          'text-halo-color': '#111827',
          'text-halo-width': 1.5,
        },
      } as mapboxgl.AnyLayer);

      const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const props = feature?.properties ?? {};
        const addressId = String(props.address_id ?? props.address_detail_pid ?? props.id ?? '').trim();
        if (!addressId) return;
        const buildingId = String(props.building_id ?? props.building_gers_id ?? props.gers_id ?? '').trim() || null;
        const originalEvent = event.originalEvent as MouseEvent | undefined;
        onAddressClickRef.current?.(addressId, buildingId, {
          additive: Boolean(originalEvent?.metaKey || originalEvent?.ctrlKey),
        });
      };
      const enterHandler = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const leaveHandler = () => {
        map.getCanvas().style.cursor = '';
      };

      const getInteractiveLayers = () => {
        const layers: string[] = [];
        try {
          if (!map.isStyleLoaded()) return layers;
          if (map.getLayer(CIRCLE_LAYER_ID)) layers.push(CIRCLE_LAYER_ID);
          if (map.getLayer(GLOW_LAYER_ID)) layers.push(GLOW_LAYER_ID);
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
          if (features.length > 0) clickHandler(Object.assign(event, { features }));
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
            leaveHandler();
            return;
          }
          const features = map.queryRenderedFeatures(event.point, { layers });
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
    let retryIntervalId: number | undefined;
    const clearRetry = () => {
      map.off('style.load', tryAddAddressLayers);
      map.off('styledata', tryAddAddressLayers);
      map.off('load', tryAddAddressLayers);
      map.off('idle', tryAddAddressLayers);
      if (retryIntervalId !== undefined) {
        window.clearInterval(retryIntervalId);
        retryIntervalId = undefined;
      }
    };
    const tryAddAddressLayers = () => {
      if (cancelled) return;
      if (hasExpectedAddressLayers()) {
        clearRetry();
        return;
      }
      if (cleanupHandlers || !canAddCustomMapLayers(map)) return;
      try {
        cleanupHandlers = manifestSource
          ? addManifestAddressLayers(manifestSource)
          : addLocalCylinderLayers();
        if (cleanupHandlers && hasExpectedAddressLayers()) clearRetry();
      } catch (error) {
        cleanupHandlers?.();
        cleanupHandlers = undefined;
        cleanupAddressLayers(map);
        console.warn('[CampaignAddressPmtilesLayer] Custom address layer attach deferred:', error);
      }
    };

    tryAddAddressLayers();
    if (!cleanupHandlers) {
      map.on('style.load', tryAddAddressLayers);
      map.on('styledata', tryAddAddressLayers);
      map.on('load', tryAddAddressLayers);
      map.on('idle', tryAddAddressLayers);
      retryIntervalId = window.setInterval(tryAddAddressLayers, 150);
    }

    return () => {
      cancelled = true;
      clearRetry();
      cleanupHandlers?.();
      cleanupAddressLayers(map);
    };
  // Layer creation is keyed to the map/style/source; paint and filter changes are refreshed below to avoid full layer teardown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, visible, manifestSource, styleKey, renderAddresses, deletedAddressSet, campaignAddressIds]);

  useEffect(() => {
    if (!map || !visible) return;
    if (manifestSource === undefined) return;

    if (manifestSource === null) {
      try {
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(buildFallbackAddressFeatureCollection(renderAddresses, deletedAddressSet));
        }
        if (map.getLayer(GLOW_LAYER_ID)) {
          map.setFilter(GLOW_LAYER_ID, getLayerFilter('Polygon'));
          map.setPaintProperty(GLOW_LAYER_ID, 'circle-color', addressColorExpression);
        }
        if (map.getLayer(CIRCLE_LAYER_ID)) {
          map.setFilter(CIRCLE_LAYER_ID, getLayerFilter('Polygon'));
          map.setPaintProperty(CIRCLE_LAYER_ID, 'fill-extrusion-color', addressColorExpression);
        }
        if (map.getLayer(LABEL_LAYER_ID)) {
          map.setFilter(LABEL_LAYER_ID, getLayerFilter('Point'));
        }
      } catch (error) {
        console.warn('[CampaignAddressPmtilesLayer] Failed to refresh local address cylinder styling:', error);
      }
      return;
    }
    try {
      if (map.getLayer(GLOW_LAYER_ID)) {
        map.setFilter(GLOW_LAYER_ID, getLayerFilter('Point'));
        map.setPaintProperty(GLOW_LAYER_ID, 'circle-color', addressColorExpression);
      }
      if (map.getLayer(CIRCLE_LAYER_ID)) {
        map.setFilter(CIRCLE_LAYER_ID, getLayerFilter('Polygon'));
        map.setPaintProperty(CIRCLE_LAYER_ID, 'fill-extrusion-color', addressColorExpression);
      }
      if (map.getLayer(LABEL_LAYER_ID)) {
        map.setFilter(LABEL_LAYER_ID, ['in', ['geometry-type'], ['literal', ['Point', 'Polygon']]] as mapboxgl.Expression);
      }
    } catch (error) {
      console.warn('[CampaignAddressPmtilesLayer] Failed to refresh address vector styling:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, manifestSource, visible, deletedAddressSet, renderAddresses, campaignAddressIds, addressColorExpression]);

  return null;
}
