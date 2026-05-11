'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { CampaignAddress, CampaignType } from '@/types/database';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import type { StatusFilters } from '@/lib/constants/mapStatus';

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
  onAddressClick?: (
    addressId: string,
    buildingId: string | null,
    options?: {
      additive?: boolean;
    }
  ) => void;
};

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

function canAddCustomMapLayers(map: mapboxgl.Map): boolean {
  try {
    const style = map.getStyle();
    return Boolean(style && Array.isArray(style.layers) && style.sources);
  } catch {
    return false;
  }
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
  deletedAddressIds = [],
  styleKey,
  onAddressClick,
}: CampaignAddressPmtilesLayerProps) {
  const [manifestSource, setManifestSource] = useState<null | undefined>(undefined);
  const onAddressClickRef = useRef(onAddressClick);
  const deletedAddressSet = useMemo(
    () => new Set(deletedAddressIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
    [deletedAddressIds]
  );
  const campaignAddressIds = useMemo(() => {
    const ids = new Set<string>();
    for (const address of addresses) {
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
  }, [addresses]);

  useEffect(() => {
    onAddressClickRef.current = onAddressClick;
  }, [onAddressClick]);

  const getVisibilityFilter = (): mapboxgl.Expression | undefined => {
    if (deletedAddressSet.size === 0) return undefined;
    return ['!', ['in', ADDRESS_ID_EXPRESSION, ['literal', Array.from(deletedAddressSet)]]] as mapboxgl.Expression;
  };

  const getCampaignScopeFilter = (): mapboxgl.Expression => {
    if (campaignAddressIds.size === 0) return NO_FEATURES_FILTER;
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
      if (!campaignId || !visible) {
        setManifestSource(null);
        return;
      }

      if (!cancelled) setManifestSource(null);
    };

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [campaignId, visible, addresses.length]);

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

      const geojson = buildFallbackAddressFeatureCollection(addresses, deletedAddressSet);
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
        paint: {
          'fill-extrusion-color': ADDRESS_CYLINDER_COLOR,
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-height': ADDRESS_CYLINDER_HEIGHT_METERS,
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-emissive-strength': 0.45,
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

      map.on('click', CIRCLE_LAYER_ID, clickHandler);
      map.on('mouseenter', CIRCLE_LAYER_ID, enterHandler);
      map.on('mouseleave', CIRCLE_LAYER_ID, leaveHandler);

      return () => {
        map.off('click', CIRCLE_LAYER_ID, clickHandler);
        map.off('mouseenter', CIRCLE_LAYER_ID, enterHandler);
        map.off('mouseleave', CIRCLE_LAYER_ID, leaveHandler);
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
        cleanupHandlers = addLocalCylinderLayers();
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
  }, [map, mapLoaded, visible, manifestSource, styleKey, addresses, deletedAddressSet, campaignAddressIds]);

  useEffect(() => {
    if (!map || !visible) return;
    if (manifestSource === undefined) return;

    if (manifestSource === null) {
      try {
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(buildFallbackAddressFeatureCollection(addresses, deletedAddressSet));
        }
        if (map.getLayer(GLOW_LAYER_ID)) {
          map.setFilter(GLOW_LAYER_ID, getLayerFilter('Polygon'));
        }
        if (map.getLayer(CIRCLE_LAYER_ID)) {
          map.setFilter(CIRCLE_LAYER_ID, getLayerFilter('Polygon'));
          map.setPaintProperty(CIRCLE_LAYER_ID, 'fill-extrusion-color', ADDRESS_CYLINDER_COLOR);
        }
        if (map.getLayer(LABEL_LAYER_ID)) {
          map.setFilter(LABEL_LAYER_ID, getLayerFilter('Point'));
        }
      } catch (error) {
        console.warn('[CampaignAddressPmtilesLayer] Failed to refresh local address cylinder styling:', error);
      }
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, manifestSource, visible, deletedAddressSet, addresses, campaignAddressIds]);

  return null;
}
