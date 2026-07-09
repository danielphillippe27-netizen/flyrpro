'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as turf from '@turf/turf';
import {
  ArrowLeft,
  Clapperboard,
  Compass,
  Film,
  Maximize2,
  Minus,
  Minimize2,
  Palette,
  Play,
  Plus,
  RotateCw,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import Lottie from 'lottie-react';
import type { CampaignAddress, CampaignV2, CampaignParcel } from '@/types/database';
import { MapBuildingsLayer, type MapBuildingsRenderState } from '@/components/map/MapBuildingsLayer';
import { CampaignAddressPmtilesLayer } from '@/components/map/CampaignAddressPmtilesLayer';
import type { BuildingFeatureCollection } from '@/types/map-buildings';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { LocationCard } from '@/components/map/LocationCard';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { Button } from '@/components/ui/button';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { useMovieMapControlsEnabled } from '@/lib/hooks/useMovieMapControlsEnabled';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import {
  applyPresetVisualTweaks,
  applyResolvedMapStyle,
  getResolvedMapInitOptions,
  hideBaseBuildingLayers,
  resolveMapStyle,
} from '@/lib/map-styles';
import {
  DEFAULT_STATUS_FILTERS,
  MAP_STATUS_CONFIG,
  MAP_STATUS_PRIORITY,
  type MapStatusKey,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import {
  resolveParcelMapTarget,
  stringValue as parcelStringValue,
  type ParcelClickPayload,
  type ParcelResolutionAddress,
  type ParcelResolutionParcel,
} from '@/lib/map/parcelClickResolution';
import { useFullscreen } from '@/lib/hooks/useFullscreen';

const PARCEL_SOURCE_ID = 'campaign-parcels';
const PARCEL_LABEL_SOURCE_ID = 'campaign-parcels-labels';
const PARCEL_FILL_LAYER = 'campaign-parcels-fill';
const PARCEL_LINE_LAYER = 'campaign-parcels-line';
const PARCEL_LABEL_LAYER = 'campaign-parcels-label';
const SELECTED_PARCEL_COLOR = '#60a5fa';
const LIGHT_PARCEL_STROKE_COLOR = '#2563eb';
const LIGHT_PARCEL_FILL_COLOR = '#60a5fa';
const DARK_PARCEL_STROKE_COLOR = '#93c5fd';
const DARK_PARCEL_FILL_COLOR = '#2563eb';

const BOUNDARY_SOURCE_RAW = 'campaign-boundary-raw';
const BOUNDARY_SOURCE_SNAPPED = 'campaign-boundary-snapped';
const BOUNDARY_LAYER_RAW_FILL = 'campaign-boundary-raw-fill';
const BOUNDARY_LAYER_RAW_LINE = 'campaign-boundary-raw-line';
const BOUNDARY_LAYER_SNAPPED_FILL = 'campaign-boundary-snapped-fill';
const BOUNDARY_LAYER_SNAPPED_LINE = 'campaign-boundary-snapped-line';
const SHOW_CAMPAIGN_BOUNDARY_OVERLAY = false;
const SHOW_PARCEL_VIEW = true;
const MAP_CAMERA_PITCH_DEGREES = 45;
const MAP_ROTATE_STEP_DEGREES = 30;
const CUSTOM_BUILDING_LAYER_PREFIXES = ['map-buildings-', 'campaign-parcels'];
const RESIDENTIAL_ONLY_PRESERVE_LAYER_PREFIXES = [
  'map-buildings-',
  'campaign-',
  'route-',
  'assigned-routes-',
  'flyr-',
  'gl-draw-',
];
const RESIDENTIAL_ONLY_BASE_LAYER_TOKENS = [
  'admin',
  'aeroway',
  'airport',
  'boundary',
  'bridge',
  'ferry',
  'highway',
  'landcover',
  'landuse',
  'motorway',
  'natural',
  'park',
  'path',
  'place-label',
  'poi',
  'rail',
  'road',
  'settlement',
  'street',
  'terrain',
  'transit',
  'tunnel',
  'water',
  'waterway',
];
const DEMO_GREEN_COLOR = '#22c55e';
const DEMO_RANDOM_COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#eab308'];
const DEMO_CAMERA_PITCH_STREET_DEGREES = 68;
const DEMO_CAMERA_PITCH_3D_DEGREES = 62;
const DEMO_CAMERA_ZOOM_STREET = 18.15;

type DemoColorMode = 'status' | 'allGreen' | 'random';
type DemoCameraShot =
  | 'orbit'
  | 'birdToStreet'
  | 'flyThrough'
  | 'streetSweep'
  | 'birdFlyThrough'
  | 'craneReveal'
  | 'angledPullback'
  | 'slideLeft'
  | 'streetSegments';
type DemoCameraSpeed = 'normal' | 'superSlow';
type DemoSegmentCameraAngle = 'fixed' | 'bird' | 'threeD' | 'street';
type DemoFitCameraOptions = {
  pitch: number;
  bearing: number;
  maxZoom: number;
  duration: number;
};
type DemoAddressTarget = {
  addressId: string;
  lon: number;
  lat: number;
  streetKey: string;
  streetLabel: string;
  houseNumber: number | null;
};

type FlyrMapDebugWindow = Window & {
  __flyrMapInitDebug?: Record<string, unknown>;
};

function setFlyrMapInitDebug(debug: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  (window as FlyrMapDebugWindow).__flyrMapInitDebug = {
    ...(window as FlyrMapDebugWindow).__flyrMapInitDebug,
    ...debug,
    updatedAt: new Date().toISOString(),
  };
}

type BuildingPendingOverlayConfig = {
  title: string;
  description: string;
};

type MapViewMode = 'buildings' | 'addresses';
type InitialMapViewMode = MapViewMode | 'parcels';

type PreparedAddressPoint = {
  addressId: string;
  buildingId: string | null;
  lon: number;
  lat: number;
  statusKey: MapStatusKey;
};

type SelectedMapTarget = {
  key: string;
  buildingId: string | null;
  addressId: string | null;
  parcelId: string | null;
};

export type MapPointOverlay = {
  id: string;
  lon: number;
  lat: number;
  addressId?: string | null;
  buildingId?: string | null;
  count?: number;
  color?: string;
  label?: string | null;
};

type GenericFeatureCollection<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<
  G,
  Record<string, unknown>
>;

type CampaignMapBundle = {
  campaign_id?: string;
  asset_signature?: string;
  source_version?: string;
  status?: string;
  phase?: string;
  source?: string;
  region?: string | null;
  map_ready?: boolean;
  addresses?: GenericFeatureCollection<GeoJSON.Point>;
  buildings?: BuildingFeatureCollection;
  parcels?: GenericFeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  roads?: GenericFeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>;
  counts?: {
    addresses?: number;
    buildings?: number;
    parcels?: number;
    roads?: number;
  };
  updated_at?: string;
};

function isFeatureCollection<G extends GeoJSON.Geometry>(value: unknown): value is GenericFeatureCollection<G> {
  const collection = value as { type?: unknown; features?: unknown };
  return collection?.type === 'FeatureCollection' && Array.isArray(collection.features);
}

function getStringProperty(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function mapBundleAddressesToCampaignAddresses(
  campaignId: string,
  collection?: GenericFeatureCollection<GeoJSON.Point>,
): CampaignAddress[] {
  if (!isFeatureCollection<GeoJSON.Point>(collection)) return [];

  return collection.features.flatMap((feature, index) => {
    if (feature.geometry?.type !== 'Point') return [];
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    const properties = feature.properties ?? {};
    const id = getStringProperty(properties, ['id', 'address_id']) ?? String(feature.id ?? `bundle-address-${index}`);
    const formatted =
      getStringProperty(properties, ['formatted', 'address', 'display_address', 'full_address']) ??
      [getStringProperty(properties, ['house_number']), getStringProperty(properties, ['street_name'])]
        .filter(Boolean)
        .join(' ');

    return [
      {
        id,
        campaign_id: campaignId,
        address: formatted || id,
        formatted: formatted || undefined,
        postal_code: getStringProperty(properties, ['postal_code']) ?? undefined,
        source: 'map',
        source_id: getStringProperty(properties, ['source_id', 'gers_id']),
        gers_id: getStringProperty(properties, ['gers_id']) ?? undefined,
        building_id: getStringProperty(properties, ['building_id', 'building_gers_id']),
        building_gers_id: getStringProperty(properties, ['building_gers_id']) ?? undefined,
        coordinate: { lon, lat },
        geom: JSON.stringify(feature.geometry),
        created_at: new Date().toISOString(),
        street_name: getStringProperty(properties, ['street_name']) ?? undefined,
        house_number: getStringProperty(properties, ['house_number']) ?? undefined,
        locality: getStringProperty(properties, ['locality']) ?? undefined,
        address_status: getStringProperty(properties, ['address_status', 'status']) ?? undefined,
      } satisfies CampaignAddress,
    ];
  });
}

function addressIdentityKeys(address: CampaignAddress): string[] {
  const record = address as CampaignAddress & {
    address_detail_pid?: string | null;
  };
  return [
    address.id,
    address.source_id,
    address.gers_id,
    address.building_id,
    address.building_gers_id,
    record.address_detail_pid,
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function mergeBundleAddressesWithLiveState(
  bundleAddresses: CampaignAddress[],
  liveAddresses: CampaignAddress[],
): CampaignAddress[] {
  if (bundleAddresses.length === 0) return liveAddresses;
  if (liveAddresses.length === 0) return bundleAddresses;

  const liveAddressByKey = new Map<string, CampaignAddress>();
  for (const address of liveAddresses) {
    for (const key of addressIdentityKeys(address)) {
      if (!liveAddressByKey.has(key)) liveAddressByKey.set(key, address);
    }
  }

  return bundleAddresses.map((address) => {
    const liveAddress = addressIdentityKeys(address)
      .map((key) => liveAddressByKey.get(key))
      .find(Boolean);

    if (!liveAddress) return address;

    return {
      ...address,
      visited: liveAddress.visited ?? address.visited,
      scans: liveAddress.scans ?? address.scans,
      last_scanned_at: liveAddress.last_scanned_at ?? address.last_scanned_at,
      address_status: liveAddress.address_status ?? address.address_status,
      qr_code_base64: liveAddress.qr_code_base64 ?? address.qr_code_base64,
    };
  });
}

function mapBundleParcelsToCampaignParcels(
  campaignId: string,
  collection?: GenericFeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): CampaignParcel[] {
  if (!isFeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(collection)) return [];

  return collection.features.flatMap((feature, index) => {
    if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return [];
    const properties = feature.properties ?? {};
    const externalId = getStringProperty(properties, [
      'external_id',
      'parcel_id',
      'PARCELID',
      'gisid',
      'roll_number',
      'id',
    ]);
    const id =
      getStringProperty(properties, ['id', 'parcel_row_id']) ??
      externalId ??
      String(feature.id ?? `bundle-parcel-${index}`);

    return [
      {
        id,
        campaign_id: campaignId,
        external_id: externalId ?? undefined,
        geom: JSON.stringify(feature.geometry),
        properties,
        created_at: new Date().toISOString(),
      } satisfies CampaignParcel,
    ];
  });
}

/** Safe getLayer: avoid "getOwnLayer of undefined" during style transition or when map is hidden (e.g. tab switch). */
function safeGetLayer(m: mapboxgl.Map, layerId: string): boolean {
  try {
    if (!m.isStyleLoaded()) return false;
    return !!m.getLayer(layerId);
  } catch {
    return false;
  }
}

/** Safe getSource: avoid "getOwnSource of undefined" during style transition or cleanup after map removal. */
function safeGetSource(m: mapboxgl.Map, sourceId: string): boolean {
  try {
    if (!m.isStyleLoaded()) return false;
    return !!m.getSource(sourceId);
  } catch {
    return false;
  }
}

function bringParcelLayersToFront(mapInstance: mapboxgl.Map) {
  for (const layerId of [PARCEL_FILL_LAYER, PARCEL_LINE_LAYER, PARCEL_LABEL_LAYER]) {
    try {
      if (safeGetLayer(mapInstance, layerId)) {
        mapInstance.moveLayer(layerId);
      }
    } catch {
      // Layer order changes can race style swaps; the next idle pass retries.
    }
  }
}

function hasRenderedBaseMapFeatureAtPoint(
  mapInstance: mapboxgl.Map,
  point: mapboxgl.PointLike,
  mapViewMode: MapViewMode,
): boolean {
  const candidateLayers =
    mapViewMode === 'buildings'
      ? ['map-buildings-extrusion', 'map-buildings-extrusion-points', 'map-buildings-surface']
      : ['campaign-addresses-pmtiles-circle', 'campaign-addresses-pmtiles-lead-glow'];
  const layers = candidateLayers.filter((layerId) => safeGetLayer(mapInstance, layerId));
  if (layers.length === 0) return false;

  try {
    return mapInstance.queryRenderedFeatures(point, { layers }).length > 0;
  } catch {
    return false;
  }
}

function shouldHideResidentialOnlyBaseLayer(layer: mapboxgl.AnyLayer): boolean {
  if (RESIDENTIAL_ONLY_PRESERVE_LAYER_PREFIXES.some((prefix) => layer.id.startsWith(prefix))) {
    return false;
  }
  if (layer.type === 'background') return false;

  const layerId = layer.id.toLowerCase();
  const sourceLayer =
    typeof (layer as { 'source-layer'?: unknown })['source-layer'] === 'string'
      ? String((layer as { 'source-layer'?: unknown })['source-layer']).toLowerCase()
      : '';
  const combined = `${layerId} ${sourceLayer}`;

  if (combined.includes('building') || combined.includes('structure')) {
    return false;
  }

  return RESIDENTIAL_ONLY_BASE_LAYER_TOKENS.some((token) => combined.includes(token));
}

function hideResidentialOnlyBaseExtras(mapInstance: mapboxgl.Map) {
  const style = mapInstance.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (!shouldHideResidentialOnlyBaseLayer(layer)) continue;

    try {
      mapInstance.setLayoutProperty(layer.id, 'visibility', 'none');
      continue;
    } catch {
      // Fall through to paint-property suppression below.
    }

    try {
      if (layer.type === 'line') {
        mapInstance.setPaintProperty(layer.id, 'line-opacity', 0);
      } else if (layer.type === 'fill') {
        mapInstance.setPaintProperty(layer.id, 'fill-opacity', 0);
      } else if (layer.type === 'fill-extrusion') {
        mapInstance.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0);
      } else if (layer.type === 'circle') {
        mapInstance.setPaintProperty(layer.id, 'circle-opacity', 0);
        mapInstance.setPaintProperty(layer.id, 'circle-stroke-opacity', 0);
      } else if (layer.type === 'symbol') {
        mapInstance.setPaintProperty(layer.id, 'text-opacity', 0);
        mapInstance.setPaintProperty(layer.id, 'icon-opacity', 0);
      } else if (layer.type === 'raster') {
        mapInstance.setPaintProperty(layer.id, 'raster-opacity', 0);
      } else if (layer.type === 'hillshade') {
        mapInstance.setPaintProperty(layer.id, 'hillshade-exaggeration', 0);
      }
    } catch {
      // Ignore base style layers that do not expose the matching paint property.
    }
  }
}

function getAddressCoordinate(address: CampaignAddress): { lon: number; lat: number } | null {
  if (address.coordinate) {
    return address.coordinate;
  }

  const addressWithGeo = address as CampaignAddress & {
    geometry?: unknown;
    geom_json?: { type?: string; coordinates?: number[] };
  };

  if (
    addressWithGeo.geom_json?.type === 'Point' &&
    Array.isArray(addressWithGeo.geom_json.coordinates) &&
    addressWithGeo.geom_json.coordinates.length >= 2
  ) {
    const [lon, lat] = addressWithGeo.geom_json.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
      return { lon, lat };
    }
  }

  let geometry = addressWithGeo.geometry;
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry) as {
        type?: string;
        coordinates?: number[];
      };
    } catch {
      geometry = null;
    }
  }

  const geometryPoint = geometry as {
    type?: string;
    coordinates?: number[];
  } | null;
  if (
    geometryPoint?.type === 'Point' &&
    Array.isArray(geometryPoint.coordinates) &&
    geometryPoint.coordinates.length >= 2
  ) {
    const [lon, lat] = geometryPoint.coordinates;
    if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
      return { lon, lat };
    }
  }

  if (address.geom) {
    try {
      const geomValue = typeof address.geom === 'string' ? address.geom : JSON.stringify(address.geom);

      try {
        const parsed = JSON.parse(geomValue) as { coordinates?: number[] };
        if (Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
          const [lon, lat] = parsed.coordinates;
          if (typeof lon === 'number' && typeof lat === 'number' && !Number.isNaN(lon) && !Number.isNaN(lat)) {
            return { lon, lat };
          }
        }
      } catch {
        const wktMatch = geomValue.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (wktMatch) {
          return { lon: parseFloat(wktMatch[1]), lat: parseFloat(wktMatch[2]) };
        }
      }
    } catch {
      // Ignore malformed geometry values and fall through to null.
    }
  }

  return null;
}

function getParcelAddressStatusKey(address: CampaignAddress): MapStatusKey {
  const hasQrScan = Number(address.scans ?? 0) > 0 || Boolean(address.last_scanned_at);
  if (hasQrScan) return 'QR_SCANNED';

  const status = getCampaignAddressMapStatus(address);
  if (['appointment', 'follow_up', 'appointment_set', 'callback_requested', 'future_seller'].includes(status)) {
    return 'HOT_LEADS';
  }
  if (status === 'talked') {
    return 'CONVERSATIONS';
  }
  if (status === 'do_not_knock') {
    return 'DO_NOT_KNOCK';
  }
  if (status === 'no_answer' || status === 'not_home') {
    return 'NO_ONE_HOME';
  }
  if (status === 'none') {
    return 'UNTOUCHED';
  }
  return 'TOUCHED';
}

function getParcelAddressLabel(parcel: CampaignParcel): string {
  const properties = parcel.properties ?? {};
  const houseNumberCandidates = [
    properties.house_number,
    properties.street_number,
    properties.address_number,
    properties.addr_housenumber,
    properties.number,
    properties.number_first,
    properties.situs_house_number,
  ];

  for (const candidate of houseNumberCandidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).trim();
      if (normalized) return normalized;
    }
  }

  const rawAddressCandidates = [
    properties.address,
    properties.full_address,
    properties.display_address,
    properties.situs_address,
  ];

  for (const candidate of rawAddressCandidates) {
    if (typeof candidate !== 'string') continue;
    const houseNumber = extractLeadingHouseNumber(candidate);
    if (houseNumber) return houseNumber;
  }

  return '';
}

function stringListFromParcelProperty(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(stringListFromParcelProperty);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return stringListFromParcelProperty(JSON.parse(trimmed));
    } catch {
      // Fall through to delimiter parsing.
    }
  }
  return trimmed
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueParcelStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parcelExternalId(parcel: CampaignParcel): string | null {
  return (
    parcelStringValue(parcel.external_id) ??
    parcelStringValue(parcel.properties?.parcel_id) ??
    parcelStringValue(parcel.properties?.external_id) ??
    parcelStringValue(parcel.properties?.PARCELID) ??
    parcelStringValue(parcel.properties?.gisid) ??
    parcelStringValue(parcel.properties?.roll_number) ??
    parcelStringValue(parcel.properties?.id)
  );
}

function linkedAddressIdsForParcelProperties(properties: Record<string, unknown> | null | undefined): string[] {
  if (!properties) return [];
  return uniqueParcelStrings([
    parcelStringValue(properties.address_id),
    parcelStringValue(properties.campaign_address_id),
    parcelStringValue(properties.campaignAddressId),
    ...stringListFromParcelProperty(properties.linked_address_ids),
    ...stringListFromParcelProperty(properties.address_ids),
  ]);
}

function extractLeadingHouseNumber(formattedAddress: string): string {
  const match = formattedAddress.trim().match(/^(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)/);
  return match?.[1]?.trim() ?? '';
}

function getPrimaryParcelTarget(addressesInParcel: PreparedAddressPoint[]): PreparedAddressPoint | null {
  const withBuildings = addressesInParcel.filter((address) => address.buildingId);
  if (withBuildings.length > 0) {
    return withBuildings[0];
  }

  return addressesInParcel[0] ?? null;
}

function deterministicColorIndex(seed: string, paletteLength: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % paletteLength;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function bearingBetween(start: [number, number], end: [number, number]): number {
  const startLat = (start[1] * Math.PI) / 180;
  const startLon = (start[0] * Math.PI) / 180;
  const endLat = (end[1] * Math.PI) / 180;
  const endLon = (end[0] * Math.PI) / 180;
  const deltaLon = endLon - startLon;
  const y = Math.sin(deltaLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function demoSweepEndpoints(bounds: mapboxgl.LngLatBounds): {
  start: [number, number];
  middle: [number, number];
  end: [number, number];
  bearing: number;
} {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const center = bounds.getCenter();
  const lonSpan = Math.abs(east - west);
  const latSpan = Math.abs(north - south);
  const start: [number, number] = lonSpan >= latSpan ? [west, center.lat] : [center.lng, south];
  const end: [number, number] = lonSpan >= latSpan ? [east, center.lat] : [center.lng, north];
  const middle: [number, number] = [center.lng, center.lat];

  return {
    start,
    middle,
    end,
    bearing: bearingBetween(start, end),
  };
}

function demoStreetLabel(address: CampaignAddress): string {
  const streetName = String(address.street_name ?? '').trim();
  if (streetName) return streetName;

  const formatted = String(address.formatted ?? address.address ?? '').trim();
  const withoutLeadingNumber = formatted.replace(/^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+/, '').trim();
  const beforeComma = withoutLeadingNumber.split(',')[0]?.trim();
  return beforeComma || 'Campaign route';
}

function demoHouseNumber(address: CampaignAddress): number | null {
  const direct = String(address.house_number ?? '').trim();
  const source = direct || String(address.formatted ?? address.address ?? '').trim();
  const match = source.match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function CampaignDetailMapView({
  campaignId,
  addresses,
  campaign,
  visibleAddressIds,
  onSnapComplete,
  onContactCreated,
  renderLocationCardExtra,
  buildingPendingOverlay,
  pointOverlays = [],
  initialMapViewMode = 'buildings',
}: {
  campaignId: string;
  addresses: CampaignAddress[];
  campaign?: CampaignV2 | null;
  visibleAddressIds?: string[];
  onSnapComplete?: () => void;
  onContactCreated?: () => void;
  renderLocationCardExtra?: (args: {
    selectedBuildingId: string;
    selectedAddressId?: string | null;
    campaignId: string;
  }) => ReactNode;
  buildingPendingOverlay?: BuildingPendingOverlayConfig;
  pointOverlays?: MapPointOverlay[];
  initialMapViewMode?: InitialMapViewMode;
}) {
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const { movieMapControlsEnabled } = useMovieMapControlsEnabled(currentWorkspaceId);
  const resolvedMapStyle = useMemo(() => resolveMapStyle(mapPreset, theme, 'v12'), [mapPreset, theme]);
  const mapShellRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { isFullscreen: isMapFullscreen, toggle: toggleMapFullscreen } = useFullscreen(mapShellRef);
  const [statusFilters, setStatusFilters] = useState<StatusFilters>(DEFAULT_STATUS_FILTERS);
  const [demoColorMode, setDemoColorMode] = useState<DemoColorMode>('status');
  const [demoCameraSpeed, setDemoCameraSpeed] = useState<DemoCameraSpeed>('normal');
  const [demoSegmentCameraAngle, setDemoSegmentCameraAngle] = useState<DemoSegmentCameraAngle>('fixed');
  const [showDemoControls, setShowDemoControls] = useState(false);
  const [activeDemoCameraShot, setActiveDemoCameraShot] = useState<DemoCameraShot | null>(null);
  const [demoPlaybackColorOverrides, setDemoPlaybackColorOverrides] = useState<Record<string, string> | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapInitFailed, setMapInitFailed] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [buildingsRenderState, setBuildingsRenderState] = useState<MapBuildingsRenderState>({
    isFetching: false,
    hasData: false,
    hasVisibleFeatures: false,
    hasBuildingPolygons: false,
    buildingsUnavailable: false,
    featureCount: 0,
    visibleFeatureCount: 0,
    zoomLevel: 15,
  });
  const [showBuildingPendingOverlay, setShowBuildingPendingOverlay] = useState(false);
  const boundsFittedRef = useRef(false);
  const initAttemptedRef = useRef(false);
  const mapInitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const hasRenderedBuildingsRef = useRef(false);
  const demoCameraTimeoutsRef = useRef<number[]>([]);
  const demoCameraFrameRef = useRef<number | null>(null);
  const demoTapGestureRef = useRef({ count: 0, lastTapAt: 0 });

  // Location Card state
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedBuildingDeleteId, setSelectedBuildingDeleteId] = useState<string | null>(null);
  const [selectedAddressIdForCard, setSelectedAddressIdForCard] = useState<string | null>(null);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [multiSelectedTargets, setMultiSelectedTargets] = useState<SelectedMapTarget[]>([]);
  const [locationCardOpen, setLocationCardOpen] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<'selection' | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
  const [optimisticallyHiddenBuildingIds, setOptimisticallyHiddenBuildingIds] = useState<string[]>([]);
  const [optimisticallyDeletedAddressIds, setOptimisticallyDeletedAddressIds] = useState<string[]>([]);

  // Create Contact Dialog state
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | undefined>(undefined);
  const [selectedAddressText, setSelectedAddressText] = useState<string | undefined>(undefined);
  const [selectedContactNotes, setSelectedContactNotes] = useState<string | undefined>(undefined);

  const resolvedInitialMapViewMode: MapViewMode = initialMapViewMode === 'addresses' ? 'addresses' : 'buildings';
  const resolvedInitialParcelOverlay = SHOW_PARCEL_VIEW && initialMapViewMode === 'parcels';
  // Map view: residential buildings by default, with address points available as a focused base layer.
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>(resolvedInitialMapViewMode);
  const [showParcelsOverlay, setShowParcelsOverlay] = useState(resolvedInitialParcelOverlay);
  // Boundary: Snap to Roads and Raw vs Snapped toggle
  const [snapping, setSnapping] = useState(false);
  const [parcels, setParcels] = useState<CampaignParcel[]>([]);
  const [mapBundle, setMapBundle] = useState<CampaignMapBundle | null>(null);
  const parcelEnrichmentStatus = campaign?.parcel_enrichment_status ?? 'not_started';
  const campaignBbox =
    Array.isArray(campaign?.bbox) &&
    campaign.bbox.length === 4 &&
    campaign.bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? (campaign.bbox as [number, number, number, number])
      : null;
  const parcelsReady = SHOW_PARCEL_VIEW && parcels.length > 0;
  const parcelsProcessing = parcelEnrichmentStatus === 'queued' || parcelEnrichmentStatus === 'processing';
  const showGeojsonParcels = SHOW_PARCEL_VIEW && showParcelsOverlay && parcels.length > 0;
  const parcelStrokeColor = theme === 'dark' ? DARK_PARCEL_STROKE_COLOR : LIGHT_PARCEL_STROKE_COLOR;
  const parcelFillColor = theme === 'dark' ? DARK_PARCEL_FILL_COLOR : LIGHT_PARCEL_FILL_COLOR;
  const parcelFillOpacity = theme === 'dark' ? 0.18 : 0.16;
  const parcelLineOpacity = theme === 'dark' ? 0.86 : 0.82;
  const parcelLineWidth = theme === 'dark' ? 1.3 : 1.2;
  const parcelLabelHaloColor = theme === 'dark' ? 'rgba(0, 0, 0, 0.82)' : 'rgba(255, 255, 255, 0.92)';
  const provisionPhase = campaign?.provision_phase ?? null;
  const mapReadyKey =
    campaign?.map_ready_at ??
    (provisionPhase === 'map_ready' ||
    provisionPhase === 'linker_ready' ||
    provisionPhase === 'optimizing' ||
    provisionPhase === 'optimized'
      ? 'map-ready'
      : '');
  const optimizedKey = campaign?.optimized_at ?? '';
  const mapBundleLoadKey = [
    campaignId,
    mapReadyKey,
    optimizedKey,
    parcelsProcessing ? parcelEnrichmentStatus : '',
  ].join(':');
  const lottieSrc = useMemo(() => (theme === 'dark' ? '/loading/white.json' : '/loading/black.json'), [theme]);

  useEffect(() => {
    setFlyrMapInitDebug({ stage: 'component_mounted', campaignId });
  }, [campaignId]);
  const handleBuildingsRenderStateChange = useCallback((state: MapBuildingsRenderState) => {
    setBuildingsRenderState((previous) => {
      if (
        previous.isFetching === state.isFetching &&
        previous.hasData === state.hasData &&
        previous.hasVisibleFeatures === state.hasVisibleFeatures &&
        previous.hasBuildingPolygons === state.hasBuildingPolygons &&
        previous.buildingsUnavailable === state.buildingsUnavailable &&
        previous.featureCount === state.featureCount &&
        previous.visibleFeatureCount === state.visibleFeatureCount &&
        previous.zoomLevel === state.zoomLevel
      ) {
        return previous;
      }
      return state;
    });
  }, []);

  const visibleAddressIdSet = useMemo(() => {
    if (!visibleAddressIds) return null;
    return new Set(visibleAddressIds.map((value) => String(value ?? '').trim()).filter(Boolean));
  }, [visibleAddressIds]);
  const visibleAddresses = useMemo(
    () =>
      addresses.filter((address) => {
        if (optimisticallyDeletedAddressIds.includes(address.id)) return false;
        return !visibleAddressIdSet || visibleAddressIdSet.has(address.id);
      }),
    [addresses, optimisticallyDeletedAddressIds, visibleAddressIdSet],
  );
  const bundleAddresses = useMemo(() => {
    const mappedAddresses = mapBundleAddressesToCampaignAddresses(campaignId, mapBundle?.addresses);
    if (!visibleAddressIdSet) return mappedAddresses;
    return mappedAddresses.filter((address) => visibleAddressIdSet.has(address.id));
  }, [campaignId, mapBundle?.addresses, visibleAddressIdSet]);
  const mapAddresses = useMemo(
    () => mergeBundleAddressesWithLiveState(bundleAddresses, visibleAddresses),
    [bundleAddresses, visibleAddresses],
  );
  const demoAddressColorOverrides = useMemo(() => {
    if (!movieMapControlsEnabled) return undefined;
    if (demoPlaybackColorOverrides) return demoPlaybackColorOverrides;
    if (demoColorMode === 'status') return undefined;

    const deletedIds = new Set(optimisticallyDeletedAddressIds);
    const colors: Record<string, string> = {};
    for (const address of mapAddresses) {
      if (!address.id || deletedIds.has(address.id)) continue;
      colors[address.id] =
        demoColorMode === 'allGreen'
          ? DEMO_GREEN_COLOR
          : DEMO_RANDOM_COLORS[deterministicColorIndex(address.id, DEMO_RANDOM_COLORS.length)];
    }
    return colors;
  }, [demoColorMode, demoPlaybackColorOverrides, mapAddresses, movieMapControlsEnabled, optimisticallyDeletedAddressIds]);
  const bundleBuildings = useMemo<BuildingFeatureCollection | null>(
    () => (isFeatureCollection(mapBundle?.buildings) ? mapBundle.buildings : null),
    [mapBundle?.buildings],
  );
  const mapBundleDataKey = mapBundle?.asset_signature ?? mapBundle?.updated_at ?? mapBundle?.source_version ?? null;
  const visibleAddressesRef = useRef(visibleAddresses);
  const mapBundleSignatureRef = useRef<string | null>(null);
  const lastMapBundleLoadKeyRef = useRef<string | null>(null);
  const mapProvisionRefreshKey = [
    campaign?.provision_status ?? '',
    campaign?.map_ready_at ?? '',
    campaign?.optimized_at ?? '',
    campaign?.map_mode ?? '',
    mapBundleDataKey ?? '',
    mapAddresses.length,
  ].join(':');
  const lastMapProvisionRefreshKeyRef = useRef<string | null>(null);

  const preparedAddressPoints = useMemo<PreparedAddressPoint[]>(() => {
    return mapAddresses
      .map((address) => {
        const coordinate = getAddressCoordinate(address);
        if (!coordinate) return null;
        const linkedBuildingId =
          (address as CampaignAddress & { building_id?: unknown }).building_id ?? address.gers_id;

        return {
          addressId: address.id,
          buildingId: typeof linkedBuildingId === 'string' && linkedBuildingId.trim() ? linkedBuildingId : null,
          lon: coordinate.lon,
          lat: coordinate.lat,
          statusKey: getParcelAddressStatusKey(address),
        };
      })
      .filter((value): value is PreparedAddressPoint => value !== null);
  }, [mapAddresses]);

  const getCampaignMapBounds = useCallback((): mapboxgl.LngLatBounds | null => {
    const bounds = new mapboxgl.LngLatBounds();

    for (const point of preparedAddressPoints) {
      bounds.extend([point.lon, point.lat]);
    }

    if (bounds.isEmpty() && campaignBbox) {
      bounds.extend([campaignBbox[0], campaignBbox[1]]);
      bounds.extend([campaignBbox[2], campaignBbox[3]]);
    }

    if (bounds.isEmpty()) {
      const boundary = campaign?.territory_boundary as GeoJSON.Polygon | null | undefined;
      const ring = boundary?.coordinates?.[0] ?? [];
      for (const coordinate of ring) {
        const [lon, lat] = coordinate;
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          bounds.extend([lon, lat]);
        }
      }
    }

    return bounds.isEmpty() ? null : bounds;
  }, [campaign?.territory_boundary, campaignBbox, preparedAddressPoints]);

  const demoAddressTargets = useMemo<DemoAddressTarget[]>(() => {
    const addressById = new Map(mapAddresses.map((address) => [address.id, address]));

    return preparedAddressPoints
      .map((point) => {
        const address = addressById.get(point.addressId);
        if (!address) return null;
        const streetLabel = demoStreetLabel(address);

        return {
          addressId: point.addressId,
          lon: point.lon,
          lat: point.lat,
          streetKey: streetLabel.toLowerCase(),
          streetLabel,
          houseNumber: demoHouseNumber(address),
        };
      })
      .filter((target): target is DemoAddressTarget => target !== null)
      .sort((lhs, rhs) => {
        if (lhs.streetKey !== rhs.streetKey) return lhs.streetKey.localeCompare(rhs.streetKey);
        if (lhs.houseNumber !== null && rhs.houseNumber !== null && lhs.houseNumber !== rhs.houseNumber) {
          return lhs.houseNumber - rhs.houseNumber;
        }
        if (lhs.lat !== rhs.lat) return lhs.lat - rhs.lat;
        return lhs.lon - rhs.lon;
      });
  }, [mapAddresses, preparedAddressPoints]);

  const parcelResolutionAddresses = useMemo<ParcelResolutionAddress[]>(
    () =>
      preparedAddressPoints.map((address) => ({
        id: address.addressId,
        buildingId: address.buildingId,
        lon: address.lon,
        lat: address.lat,
      })),
    [preparedAddressPoints],
  );

  const parcelResolutionParcels = useMemo<ParcelResolutionParcel[]>(
    () =>
      parcels.map((parcel) => ({
        id: parcel.id,
        externalId: parcelExternalId(parcel),
        properties: parcel.properties ?? null,
      })),
    [parcels],
  );

  const selectedParcelIds = useMemo(
    () => uniqueParcelStrings([selectedParcelId, ...multiSelectedTargets.map((target) => target.parcelId)]),
    [multiSelectedTargets, selectedParcelId],
  );

  useEffect(() => {
    visibleAddressesRef.current = mapAddresses;
  }, [mapAddresses]);

  useEffect(() => {
    if (!campaignId || !mapLoaded) return;

    if (lastMapProvisionRefreshKeyRef.current === null) {
      lastMapProvisionRefreshKeyRef.current = mapProvisionRefreshKey;
      return;
    }

    if (lastMapProvisionRefreshKeyRef.current === mapProvisionRefreshKey) return;

    lastMapProvisionRefreshKeyRef.current = mapProvisionRefreshKey;
    hasRenderedBuildingsRef.current = false;
    setMapRefreshKey((prev) => prev + 1);
  }, [campaignId, mapLoaded, mapProvisionRefreshKey]);

  const applyOptimisticMapDeletion = useCallback(
    ({
      buildingIds = [],
      addressIds = [],
    }: {
      buildingIds?: Array<string | null | undefined>;
      addressIds?: Array<string | null | undefined>;
    }) => {
      const normalizedBuildingIds = Array.from(
        new Set(buildingIds.map((value) => String(value ?? '').trim()).filter(Boolean)),
      );
      const normalizedAddressIds = Array.from(
        new Set(addressIds.map((value) => String(value ?? '').trim()).filter(Boolean)),
      );

      if (normalizedBuildingIds.length > 0) {
        setOptimisticallyHiddenBuildingIds((prev) => Array.from(new Set([...prev, ...normalizedBuildingIds])));
      }

      if (normalizedAddressIds.length > 0) {
        setOptimisticallyDeletedAddressIds((prev) => Array.from(new Set([...prev, ...normalizedAddressIds])));
      }

      if (normalizedBuildingIds.length > 0 || normalizedAddressIds.length > 0) {
        setMapRefreshKey((prev) => prev + 1);
      }
    },
    [],
  );

  // Get user ID on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!buildingPendingOverlay) return;

    let cancelled = false;
    fetch(lottieSrc)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setLoadingAnimationData(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [buildingPendingOverlay, lottieSrc]);

  useEffect(() => {
    if (buildingsRenderState.hasBuildingPolygons) {
      hasRenderedBuildingsRef.current = true;
      setShowBuildingPendingOverlay(false);
    }
  }, [buildingsRenderState.hasBuildingPolygons]);

  useEffect(() => {
    hasRenderedBuildingsRef.current = false;
    setBuildingsRenderState({
      isFetching: false,
      hasData: false,
      hasVisibleFeatures: false,
      hasBuildingPolygons: false,
      buildingsUnavailable: false,
      featureCount: 0,
      visibleFeatureCount: 0,
      zoomLevel: 15,
    });
    setShowBuildingPendingOverlay(false);
    setMultiSelectedTargets([]);
    setSelectedBuildingId(null);
    setSelectedBuildingDeleteId(null);
    setSelectedAddressIdForCard(null);
    setSelectedParcelId(null);
    setLocationCardOpen(false);
    setMapRefreshKey(0);
    setOptimisticallyHiddenBuildingIds([]);
    setOptimisticallyDeletedAddressIds([]);
    setMapViewMode(resolvedInitialMapViewMode);
    setShowParcelsOverlay(resolvedInitialParcelOverlay);
    setParcels([]);
    setMapBundle(null);
    mapBundleSignatureRef.current = null;
    lastMapBundleLoadKeyRef.current = null;
  }, [campaignId, resolvedInitialMapViewMode, resolvedInitialParcelOverlay]);

  useEffect(() => {
    if (!campaignId) {
      setMapBundle(null);
      mapBundleSignatureRef.current = null;
      lastMapBundleLoadKeyRef.current = null;
      return;
    }

    if (!parcelsProcessing && lastMapBundleLoadKeyRef.current === mapBundleLoadKey) {
      return;
    }
    lastMapBundleLoadKeyRef.current = mapBundleLoadKey;

    let cancelled = false;

    const loadMapBundle = async () => {
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token ?? null;
        const signature = mapBundleSignatureRef.current;
        const url = new URL(`/api/campaigns/${encodeURIComponent(campaignId)}/map-bundle`, window.location.origin);
        if (signature) {
          url.searchParams.set('signature', signature);
        }
        const response = await fetch(url.toString(), {
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            ...(signature ? { 'If-None-Match': `"${signature.replace(/"/g, '')}"` } : {}),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
        if (response.status === 304) {
          return;
        }
        if (!response.ok) {
          throw new Error(`Campaign map bundle request failed with status ${response.status}`);
        }

        const bundle = (await response.json()) as CampaignMapBundle;
        if (cancelled) return;

        mapBundleSignatureRef.current = bundle.asset_signature ?? null;
        setMapBundle(bundle);

        if (SHOW_PARCEL_VIEW) {
          setParcels(mapBundleParcelsToCampaignParcels(campaignId, bundle.parcels));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[CampaignDetailMapView] Failed to load campaign map bundle:', error);
        }
      }
    };

    void loadMapBundle();

    if (parcelsProcessing) {
      const interval = window.setInterval(() => {
        void loadMapBundle();
      }, 5000);

      return () => {
        cancelled = true;
        window.clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [campaignId, mapBundleLoadKey, parcelsProcessing]);

  useEffect(() => {
    if ((!SHOW_PARCEL_VIEW || !parcelsReady) && showParcelsOverlay) {
      setShowParcelsOverlay(false);
    }
  }, [parcelsReady, showParcelsOverlay]);

  // Handle building click - opens LocationCard
  // For unit slices, addressId is passed to show specific unit
  const toggleMultiSelection = useCallback((target: SelectedMapTarget) => {
    setMultiSelectedTargets((prev) => {
      const exists = prev.some((item) => item.key === target.key);
      if (exists) {
        return prev.filter((item) => item.key !== target.key);
      }
      return [...prev, target];
    });
  }, []);

  const openLocationCard = (
    locationCardId: string,
    addressId?: string,
    parcelId?: string | null,
    buildingDeleteId?: string | null,
  ) => {
    console.log('Map target clicked:', {
      locationCardId,
      addressId,
      parcelId,
      buildingDeleteId,
    });
    setSelectedBuildingId(locationCardId);
    setSelectedBuildingDeleteId(buildingDeleteId ?? null);
    setSelectedAddressIdForCard(addressId || null);
    setSelectedParcelId(parcelId ?? null);
    setLocationCardOpen(true);
  };

  const handleMapTargetClick = useCallback(
    (
      target: {
        buildingId?: string | null;
        addressId?: string | null;
        parcelId?: string | null;
      },
      options?: {
        additive?: boolean;
      },
    ) => {
      const buildingId = target.buildingId ?? null;
      const addressId = target.addressId ?? null;
      const parcelId = target.parcelId ?? null;
      const key = parcelId
        ? `parcel:${parcelId}`
        : buildingId
          ? `building:${buildingId}:${addressId ?? ''}`
          : `address:${addressId ?? ''}`;

      if (options?.additive) {
        setLocationCardOpen(false);
        setSelectedBuildingId(null);
        setSelectedBuildingDeleteId(null);
        setSelectedAddressIdForCard(null);
        setSelectedParcelId(null);
        toggleMultiSelection({
          key,
          buildingId,
          addressId,
          parcelId,
        });
        return;
      }

      setMultiSelectedTargets([]);
      if (buildingId || addressId) {
        openLocationCard(buildingId ?? addressId ?? '', addressId ?? undefined, parcelId, buildingId ?? null);
        return;
      }

      if (parcelId) {
        setSelectedBuildingId(null);
        setSelectedBuildingDeleteId(null);
        setSelectedAddressIdForCard(null);
        setSelectedParcelId(parcelId);
        setLocationCardOpen(false);
      }
    },
    [toggleMultiSelection],
  );

  const handleParcelClick = useCallback(
    (
      payload: ParcelClickPayload,
      options?: {
        additive?: boolean;
      },
    ) => {
      const resolved = resolveParcelMapTarget({
        payload,
        parcels: parcelResolutionParcels,
        addresses: parcelResolutionAddresses,
      });

      handleMapTargetClick(
        {
          buildingId: resolved.buildingId,
          addressId: resolved.addressId,
          parcelId: resolved.parcelId,
        },
        options,
      );
    },
    [handleMapTargetClick, parcelResolutionAddresses, parcelResolutionParcels],
  );

  const handleBuildingClick = (
    buildingId: string,
    addressId?: string,
    options?: {
      additive?: boolean;
    },
  ) => {
    handleMapTargetClick({ buildingId, addressId: addressId ?? null, parcelId: null }, options);
  };

  // Handle closing the location card
  const handleCloseLocationCard = useCallback(() => {
    setLocationCardOpen(false);
    setSelectedBuildingId(null);
    setSelectedBuildingDeleteId(null);
    setSelectedAddressIdForCard(null);
    setSelectedParcelId(null);
  }, []);

  const getAccessToken = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  type AuthRequestOptions = RequestInit & {
    ignoreStatuses?: number[];
  };

  const requestWithAuth = useCallback(
    async (url: string, init?: AuthRequestOptions) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const { ignoreStatuses, ...requestInit } = init ?? {};
      const response = await fetch(url, {
        ...requestInit,
        headers: {
          ...(requestInit.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (ignoreStatuses?.includes(response.status)) {
          return response;
        }

        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Delete failed');
      }

      return response;
    },
    [getAccessToken],
  );

  const deleteJsonWithAuth = useCallback(
    async (url: string, options?: { allowMissing?: boolean }) => {
      const response = await requestWithAuth(url, {
        method: 'DELETE',
        ignoreStatuses: options?.allowMissing ? [404] : undefined,
      });
      if (response.status === 404) {
        return null;
      }
      return response.json().catch(() => null);
    },
    [requestWithAuth],
  );

  const handleDeleteSelectedLocation = useCallback(async () => {
    const addressId = selectedAddressIdForCard;
    const buildingId = selectedBuildingDeleteId;
    const parcelId = selectedParcelId;

    if (!addressId && !buildingId && !parcelId) return;
    if (
      !window.confirm(
        'Delete this location from the campaign? Any linked address, building, and parcel shown here will be removed.',
      )
    ) {
      return;
    }

    setDeletingTarget('selection');
    try {
      const response = await requestWithAuth(`/api/campaigns/${campaignId}/location`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          buildingId,
          addressId,
          parcelId,
        }),
      });
      const result = await response.json().catch(() => null);
      const deletedAddressIds = Array.isArray(result?.deleted_address_ids)
        ? result.deleted_address_ids.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const deletedBuildingId = typeof result?.building_id === 'string' ? result.building_id : null;

      applyOptimisticMapDeletion({
        buildingIds: deletedBuildingId ? [deletedBuildingId] : [],
        addressIds: deletedAddressIds,
      });

      if (parcelId) {
        setParcels((prev) => prev.filter((parcel) => parcel.id !== parcelId));
      }

      handleCloseLocationCard();
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete selected location');
    } finally {
      setDeletingTarget(null);
    }
  }, [
    campaignId,
    applyOptimisticMapDeletion,
    handleCloseLocationCard,
    requestWithAuth,
    router,
    selectedAddressIdForCard,
    selectedBuildingDeleteId,
    selectedParcelId,
  ]);

  const handleBulkDeleteSelectedTargets = useCallback(async () => {
    if (multiSelectedTargets.length === 0) return;
    const uniqueBuildingIds = Array.from(
      new Set(
        multiSelectedTargets.map((target) => target.buildingId).filter((value): value is string => Boolean(value)),
      ),
    );

    if (
      !window.confirm(
        `Delete ${multiSelectedTargets.length} selected house${multiSelectedTargets.length === 1 ? '' : 's'}?`,
      )
    ) {
      return;
    }

    setBulkDeleting(true);
    try {
      const deletedAddressIds: string[] = [];
      const deletedBuildingIds: string[] = [];
      const uniqueAddressIds = Array.from(
        new Set([
          ...multiSelectedTargets
            .filter((target) => !target.buildingId && target.addressId)
            .map((target) => target.addressId)
            .filter((value): value is string => Boolean(value)),
        ]),
      );

      for (const addressId of uniqueAddressIds) {
        const result = await deleteJsonWithAuth(`/api/campaigns/${campaignId}/addresses/${addressId}`, {
          allowMissing: true,
        });
        if (typeof result?.address_id === 'string') {
          deletedAddressIds.push(result.address_id);
        }
      }

      for (const buildingId of uniqueBuildingIds) {
        const result = await deleteJsonWithAuth(`/api/campaigns/${campaignId}/buildings/${buildingId}`, {
          allowMissing: true,
        });
        if (typeof result?.building_id === 'string') {
          deletedBuildingIds.push(result.building_id);
        }
        if (Array.isArray(result?.deleted_address_ids)) {
          deletedAddressIds.push(
            ...result.deleted_address_ids.filter((value: unknown): value is string => typeof value === 'string'),
          );
        }
      }

      applyOptimisticMapDeletion({
        buildingIds: deletedBuildingIds,
        addressIds: deletedAddressIds,
      });

      setMultiSelectedTargets([]);
      handleCloseLocationCard();
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete selected houses');
    } finally {
      setBulkDeleting(false);
    }
  }, [
    campaignId,
    deleteJsonWithAuth,
    handleCloseLocationCard,
    multiSelectedTargets,
    router,
    applyOptimisticMapDeletion,
  ]);

  // Handle adding a contact from LocationCard
  const handleAddContact = (addressId?: string, addressText?: string, notes?: string) => {
    setSelectedAddressId(addressId);
    setSelectedAddressText(addressText);
    setSelectedContactNotes(notes);
    setCreateContactOpen(true);
  };

  // Handle contact creation success
  const handleContactCreated = () => {
    setCreateContactOpen(false);
    setSelectedAddressId(undefined);
    setSelectedAddressText(undefined);
    setSelectedContactNotes(undefined);
    // Refresh the location card data
    if (selectedBuildingId) {
      // Force re-render by toggling
      const currentId = selectedBuildingId;
      setSelectedBuildingId(null);
      setTimeout(() => setSelectedBuildingId(currentId), 100);
    }
    onContactCreated?.();
  };

  useEffect(() => {
    if (map.current || initAttemptedRef.current) return;
    setMapInitFailed(false);
    retryCountRef.current = 0;
    let cancelled = false;
    let retryFrameId: number | null = null;
    let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      retryCountRef.current += 1;
      if (retryCountRef.current > 60) {
        console.error('[CampaignDetailMapView] Map container not ready after max retries');
        setMapInitFailed(true);
        return;
      }
      retryFrameId = requestAnimationFrame(() => {
        void checkAndInit();
      });
    };

    // Check if container has dimensions before initializing
    const checkAndInit = async () => {
      if (cancelled) return;

      if (!mapContainer.current) {
        setFlyrMapInitDebug({ stage: 'waiting_for_container' });
        scheduleRetry();
        return;
      }

      const rect = mapContainer.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setFlyrMapInitDebug({
          stage: 'waiting_for_dimensions',
          width: rect.width,
          height: rect.height,
        });
        // Container not visible yet, try again on next frame
        scheduleRetry();
        return;
      }

      try {
        initAttemptedRef.current = true;
        setFlyrMapInitDebug({
          stage: 'initializing',
          width: rect.width,
          height: rect.height,
          styleKey: resolvedMapStyle.key,
        });
        const token = getMapboxToken();
        mapboxgl.accessToken = token;

        // Helper to get initial center from addresses (GeoJSON-first approach)
        const getInitialCenter = (): [number, number] => {
          const currentVisibleAddresses = visibleAddressesRef.current;
          if (currentVisibleAddresses.length > 0) {
            const addr = currentVisibleAddresses[0];
            const coordinate = getAddressCoordinate(addr);
            if (coordinate) {
              return [coordinate.lon, coordinate.lat];
            }
          }

          const bbox = campaign?.bbox;
          if (
            Array.isArray(bbox) &&
            bbox.length === 4 &&
            bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
          ) {
            return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
          }

          const boundary = campaign?.territory_boundary as GeoJSON.Polygon | null | undefined;
          const ring = boundary?.coordinates?.[0] ?? [];
          if (ring.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            for (const coordinate of ring) {
              const [lon, lat] = coordinate;
              if (Number.isFinite(lon) && Number.isFinite(lat)) {
                bounds.extend([lon, lat]);
              }
            }
            if (!bounds.isEmpty()) {
              const center = bounds.getCenter();
              return [center.lng, center.lat];
            }
          }

          return [-79.3832, 43.6532]; // Toronto default
        };

        const mapInitOptions = await getResolvedMapInitOptions(resolvedMapStyle);
        if (cancelled || !mapContainer.current || map.current) {
          initAttemptedRef.current = false;
          return;
        }

        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          ...(mapInitOptions as Pick<mapboxgl.MapOptions, 'style' | 'config'>),
          center: getInitialCenter(),
          zoom: 12,
          pitch: 45,
          bearing: -12,
        });
        mapInitTimeoutRef.current = setTimeout(() => {
          if (!mapLoaded) {
            console.error('[CampaignDetailMapView] Map load timed out after 15s');
            setMapInitFailed(true);
          }
        }, 15000);
        setFlyrMapInitDebug({ stage: 'map_created' });
      } catch (error) {
        console.error('[CampaignDetailMapView] Failed to initialize Mapbox map:', error);
        setFlyrMapInitDebug({
          stage: 'init_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        initAttemptedRef.current = false;
        scheduleRetry();
        return;
      }

      map.current.on('load', () => {
        if (mapInitTimeoutRef.current) {
          clearTimeout(mapInitTimeoutRef.current);
          mapInitTimeoutRef.current = null;
        }
        setFlyrMapInitDebug({ stage: 'map_loaded' });
        setMapInitFailed(false);
        setMapLoaded(true);

        // Clean up problematic layers and hide building layers
        const cleanupLayers = () => {
          if (!map.current) return;

          try {
            const style = map.current.getStyle();
            if (style && style.layers) {
              applyPresetVisualTweaks(map.current, resolvedMapStyle, {
                preserveLayerPrefixes: [
                  'map-buildings-',
                  'campaign-',
                  'route-',
                  'assigned-routes-',
                  'flyr-',
                  'gl-draw-',
                ],
              });
              hideBaseBuildingLayers(map.current, {
                preserveLayerPrefixes: CUSTOM_BUILDING_LAYER_PREFIXES,
              });
              style.layers.forEach((layer) => {
                // Remove layers that reference non-existent source layers
                if (layer.id && (layer.id.includes('road-label') || layer.id.includes('road_label'))) {
                  try {
                    map.current?.removeLayer(layer.id);
                  } catch (err) {
                    // Layer might not exist or already removed
                  }
                }
              });
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        };

        cleanupLayers();
      });

      // Handle non-critical source layer errors
      map.current.on('error', (e) => {
        const errorMessage = e.error?.message || String(e.error);
        const isSourceLayerError =
          errorMessage.includes('does not exist on source') || errorMessage.includes('Source layer');

        if (isSourceLayerError) {
          // This is a style validation error - log but don't show to user
          console.warn('Mapbox style layer warning (non-critical):', errorMessage);

          // Try to remove the problematic layer after style loads
          if (map.current) {
            map.current.once('style.load', () => {
              try {
                const style = map.current?.getStyle();
                if (style && style.layers) {
                  style.layers.forEach((layer) => {
                    if (layer.id && (layer.id.includes('road-label') || layer.id.includes('road_label'))) {
                      try {
                        map.current?.removeLayer(layer.id);
                      } catch (removeErr) {
                        // Layer might already be removed
                      }
                    }
                  });
                }
              } catch (cleanupErr) {
                // Ignore cleanup errors
              }
            });
          }
        }
      });

      // Trigger resize after a short delay to ensure map renders properly
      resizeTimeoutId = setTimeout(() => {
        if (!cancelled && map.current) {
          try {
            map.current.resize();
          } catch (resizeError) {
            console.warn('Mapbox resize skipped during teardown:', resizeError);
          }
        }
      }, 100);
    };

    // Use requestAnimationFrame to ensure container is rendered
    const frameId = requestAnimationFrame(() => {
      void checkAndInit();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (retryFrameId !== null) {
        cancelAnimationFrame(retryFrameId);
      }
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      if (mapInitTimeoutRef.current) {
        clearTimeout(mapInitTimeoutRef.current);
        mapInitTimeoutRef.current = null;
      }
      const mapInstance = map.current;
      map.current = null;
      if (mapInstance) {
        removeMapboxMapWhenSafe(mapInstance);
      }
      // Synchronously clear any remaining Mapbox DOM from the container.
      // removeMapboxMapWhenSafe may defer map.remove() if the map is not
      // yet loaded. If the effect re-runs before removal completes, a new
      // map would initialize into a dirty container, breaking interactivity.
      // Clearing the container here ensures the next map always starts clean.
      if (mapContainer.current) {
        mapContainer.current.innerHTML = '';
      }
      if (initAttemptedRef.current) {
        initAttemptedRef.current = false;
        setMapLoaded(false);
      }
    };
  }, [resolvedMapStyle]);

  // Keep Mapbox canvas in sync with container size (sidebar collapse/expand, viewport changes).
  useEffect(() => {
    if (!mapLoaded || !map.current || !mapContainer.current) return;

    const mapInstance = map.current;
    const container = mapContainer.current;
    let frameId: number | null = null;

    const resizeMap = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        try {
          mapInstance.resize();
        } catch {
          // Ignore transient resize errors during style swaps/unmount.
        }
      });
    };

    const observer = new ResizeObserver(() => {
      resizeMap();
    });
    observer.observe(container);

    window.addEventListener('resize', resizeMap);
    window.addEventListener('orientationchange', resizeMap);
    resizeMap();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeMap);
      window.removeEventListener('orientationchange', resizeMap);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    if (!boundsFittedRef.current) {
      const bounds = new mapboxgl.LngLatBounds();
      mapAddresses
        .map((addr) => getAddressCoordinate(addr))
        .filter((coord): coord is { lon: number; lat: number } => coord !== null)
        .forEach((coord) => {
          bounds.extend([coord.lon, coord.lat]);
        });

      if (bounds.isEmpty()) {
        const bbox = campaign?.bbox;

        if (
          Array.isArray(bbox) &&
          bbox.length === 4 &&
          bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
        ) {
          bounds.extend([bbox[0], bbox[1]]);
          bounds.extend([bbox[2], bbox[3]]);
        } else {
          const boundary = campaign?.territory_boundary as GeoJSON.Polygon | null | undefined;
          const ring = boundary?.coordinates?.[0] ?? [];
          for (const coordinate of ring) {
            const [lon, lat] = coordinate;
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
              bounds.extend([lon, lat]);
            }
          }
        }
      }

      if (bounds.isEmpty()) {
        const boundary = campaign?.territory_boundary as GeoJSON.Polygon | null | undefined;
        const ring = boundary?.coordinates?.[0] ?? [];
        for (const coordinate of ring) {
          const [lon, lat] = coordinate;
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            bounds.extend([lon, lat]);
          }
        }
      }

      if (!bounds.isEmpty()) {
        setTimeout(() => {
          if (!map.current || boundsFittedRef.current) return;
          boundsFittedRef.current = true;
          map.current.fitBounds(bounds, {
            padding: {
              top: 40,
              right: 40,
              bottom: 132,
              left: 40,
            },
            maxZoom: 15,
            duration: 1000,
            pitch: 45,
            bearing: -12,
          });

          map.current.once('moveend', () => {
            if (!map.current) return;
            map.current.easeTo({
              zoom: Math.max(map.current.getZoom(), 12),
              pitch: 45,
              bearing: -12,
              duration: 300,
            });
          });
        }, 200);
      }
    }
    // Buildings are handled by MapBuildingsLayer component which provides fill extrusions.
  }, [campaign?.bbox, campaign?.territory_boundary, mapLoaded, mapViewMode, mapAddresses]);

  const pointOverlaySourceId = 'campaign-point-overlays';
  const pointOverlayCircleLayerId = 'campaign-point-overlays-circle';
  const pointOverlayLabelLayerId = 'campaign-point-overlays-label';

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    const buildPointOverlayGeoJSON = (): GeoJSON.FeatureCollection<GeoJSON.Point> | null => {
      const features: GeoJSON.Feature<GeoJSON.Point>[] = pointOverlays
        .filter((overlay) => Number.isFinite(overlay.lon) && Number.isFinite(overlay.lat))
        .map((overlay) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [overlay.lon, overlay.lat],
          },
          properties: {
            feature_id: overlay.id,
            address_id: overlay.addressId ?? null,
            building_id: overlay.buildingId ?? null,
            count: overlay.count ?? 0,
            label: overlay.label ?? (overlay.count ? String(overlay.count) : ''),
            color: overlay.color ?? '#ef4444',
          },
        }));

      return features.length > 0 ? { type: 'FeatureCollection', features } : null;
    };

    const removePointOverlayLayers = () => {
      try {
        if (safeGetLayer(mapInstance, pointOverlayLabelLayerId)) mapInstance.removeLayer(pointOverlayLabelLayerId);
        if (safeGetLayer(mapInstance, pointOverlayCircleLayerId)) mapInstance.removeLayer(pointOverlayCircleLayerId);
        if (safeGetSource(mapInstance, pointOverlaySourceId)) mapInstance.removeSource(pointOverlaySourceId);
      } catch {}
    };

    const addPointOverlayLayers = () => {
      if (!mapInstance.isStyleLoaded()) return;

      const geo = buildPointOverlayGeoJSON();
      if (!geo) {
        removePointOverlayLayers();
        return;
      }

      try {
        const existingSource = mapInstance.getSource(pointOverlaySourceId);
        if (existingSource && 'setData' in existingSource) {
          (existingSource as mapboxgl.GeoJSONSource).setData(geo);
        } else if (!existingSource) {
          mapInstance.addSource(pointOverlaySourceId, {
            type: 'geojson',
            data: geo,
            promoteId: 'feature_id',
          });
        }

        if (!safeGetLayer(mapInstance, pointOverlayCircleLayerId)) {
          mapInstance.addLayer({
            id: pointOverlayCircleLayerId,
            type: 'circle',
            source: pointOverlaySourceId,
            paint: {
              'circle-color': ['coalesce', ['get', 'color'], '#ef4444'],
              'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'count'], 1], 1, 8, 5, 12],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.95,
            },
          });
        }

        if (!safeGetLayer(mapInstance, pointOverlayLabelLayerId)) {
          mapInstance.addLayer({
            id: pointOverlayLabelLayerId,
            type: 'symbol',
            source: pointOverlaySourceId,
            layout: {
              'text-field': ['coalesce', ['get', 'label'], ''],
              'text-size': 11,
              'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-offset': [0, 0],
              'text-anchor': 'center',
            },
            paint: {
              'text-color': '#ffffff',
            },
          });
        }
      } catch (error) {
        console.error('[CampaignDetailMapView] Error adding point overlay layer:', error);
      }
    };

    const onPointOverlayClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      const addressId = feature.properties.address_id as string | undefined;
      const buildingId = feature.properties.building_id as string | undefined;
      if (buildingId || addressId) {
        handleMapTargetClick(
          {
            buildingId: buildingId ?? null,
            addressId: addressId ?? null,
            parcelId: null,
          },
          {
            additive: Boolean(
              (event.originalEvent as MouseEvent | undefined)?.metaKey ||
              (event.originalEvent as MouseEvent | undefined)?.ctrlKey,
            ),
          },
        );
      }
    };

    // Use a map-level click handler so Mapbox does not run layer-scoped
    // queryRenderedFeatures internally during style transitions.
    const onPointOverlayMapClick = (e: mapboxgl.MapMouseEvent) => {
      try {
        if (!mapInstance.isStyleLoaded() || !mapInstance.getLayer(pointOverlayCircleLayerId)) return;
        const features = mapInstance.queryRenderedFeatures(e.point, {
          layers: [pointOverlayCircleLayerId],
        });
        if (features.length > 0) onPointOverlayClick(Object.assign(e, { features }));
      } catch {
        return;
      }
    };

    if (pointOverlays.length === 0) {
      removePointOverlayLayers();
      return;
    }

    if (mapInstance.isStyleLoaded()) {
      addPointOverlayLayers();
    } else {
      mapInstance.once('style.load', addPointOverlayLayers);
    }

    mapInstance.off('click', onPointOverlayMapClick);
    mapInstance.on('click', onPointOverlayMapClick);

    return () => {
      mapInstance.off('click', onPointOverlayMapClick);
      removePointOverlayLayers();
    };
  }, [handleMapTargetClick, mapLoaded, mapViewMode, pointOverlays, resolvedMapStyle.key]);

  // Sync map style with the selected map preset.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      applyResolvedMapStyle(map.current, resolvedMapStyle);
    } catch (err) {
      console.error('Error setting map style:', err);
    }

    const cleanupLayers = () => {
      if (!map.current) return;
      try {
        if (!map.current.isStyleLoaded()) return;
        const style = map.current.getStyle();
        if (style?.layers) {
          applyPresetVisualTweaks(map.current, resolvedMapStyle, {
            preserveLayerPrefixes: ['map-buildings-', 'campaign-', 'route-', 'assigned-routes-', 'flyr-', 'gl-draw-'],
          });
          hideBaseBuildingLayers(map.current, {
            preserveLayerPrefixes: CUSTOM_BUILDING_LAYER_PREFIXES,
          });
          style.layers.forEach((layer) => {
            try {
              if (layer.id && (layer.id.includes('road-label') || layer.id.includes('road_label'))) {
                if (safeGetLayer(map.current!, layer.id)) map.current?.removeLayer(layer.id);
              }
            } catch {
              // Ignore per-layer errors during style cleanup (e.g. getOwnLayer of undefined)
            }
          });
        }
      } catch {}
    };

    const cleanupOnStyleReady = () => {
      cleanupLayers();
      window.setTimeout(cleanupLayers, 250);
      window.setTimeout(cleanupLayers, 1000);
    };

    cleanupOnStyleReady();
    map.current.on('style.load', cleanupOnStyleReady);
    map.current.on('styledata', cleanupOnStyleReady);

    return () => {
      map.current?.off('style.load', cleanupOnStyleReady);
      map.current?.off('styledata', cleanupOnStyleReady);
    };
  }, [mapLoaded, resolvedMapStyle]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const resizeMap = () => {
      try {
        map.current?.resize();
      } catch {
        // Ignore transient resize errors while fullscreen state is changing.
      }
    };

    resizeMap();
    const timeoutId = window.setTimeout(resizeMap, 150);
    return () => window.clearTimeout(timeoutId);
  }, [isMapFullscreen, mapLoaded]);

  // Boundary layer cleanup. The saved campaign territory is metadata for provisioning/snap,
  // but the live campaign map should render actual buildings, addresses, and parcels.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !campaign?.territory_boundary) return;
    if (campaign.address_source !== 'map') return;

    const boundary = campaign.territory_boundary as GeoJSON.Polygon;
    const raw = campaign.campaign_polygon_raw as GeoJSON.Polygon | undefined;
    const snapped = campaign.campaign_polygon_snapped as GeoJSON.Polygon | undefined;
    const hasBoth = !!(raw && snapped);

    const removeBoundaryLayers = () => {
      [
        BOUNDARY_LAYER_RAW_FILL,
        BOUNDARY_LAYER_RAW_LINE,
        BOUNDARY_LAYER_SNAPPED_FILL,
        BOUNDARY_LAYER_SNAPPED_LINE,
      ].forEach((id) => {
        if (safeGetLayer(m, id)) m.removeLayer(id);
      });
      if (safeGetSource(m, BOUNDARY_SOURCE_RAW)) m.removeSource(BOUNDARY_SOURCE_RAW);
      if (safeGetSource(m, BOUNDARY_SOURCE_SNAPPED)) m.removeSource(BOUNDARY_SOURCE_SNAPPED);
    };

    if (!SHOW_CAMPAIGN_BOUNDARY_OVERLAY) {
      removeBoundaryLayers();
      return () => {
        removeBoundaryLayers();
      };
    }

    if (!m.isStyleLoaded()) {
      m.once('style.load', () => {
        removeBoundaryLayers();
        addBoundaryLayers();
      });
      return () => {};
    }

    const addBoundaryLayers = () => {
      const polyToFeature = (p: GeoJSON.Polygon): GeoJSON.Feature<GeoJSON.Polygon> => ({
        type: 'Feature',
        geometry: p,
        properties: {},
      });

      if (hasBoth) {
        m.addSource(BOUNDARY_SOURCE_RAW, {
          type: 'geojson',
          data: polyToFeature(raw!),
        });
        m.addSource(BOUNDARY_SOURCE_SNAPPED, {
          type: 'geojson',
          data: polyToFeature(snapped!),
        });
        m.addLayer({
          id: BOUNDARY_LAYER_RAW_FILL,
          type: 'fill',
          source: BOUNDARY_SOURCE_RAW,
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.08 },
        });
        m.addLayer({
          id: BOUNDARY_LAYER_RAW_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_RAW,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ef4444',
            'line-width': 2,
            'line-opacity': 0.3,
            'line-dasharray': [1, 1.5],
          },
        });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_FILL,
          type: 'fill',
          source: BOUNDARY_SOURCE_SNAPPED,
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 },
        });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
            'line-opacity': 1,
          },
        });
      } else {
        m.addSource(BOUNDARY_SOURCE_SNAPPED, {
          type: 'geojson',
          data: polyToFeature(boundary),
        });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_FILL,
          type: 'fill',
          source: BOUNDARY_SOURCE_SNAPPED,
          paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 },
        });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ef4444',
            'line-width': 3,
            'line-opacity': 1,
          },
        });
      }
    };

    removeBoundaryLayers();
    addBoundaryLayers();

    return () => {
      removeBoundaryLayers();
    };
  }, [
    mapLoaded,
    campaign?.id,
    campaign?.territory_boundary,
    campaign?.campaign_polygon_raw,
    campaign?.campaign_polygon_snapped,
    campaign?.address_source,
  ]);

  const hasMapBoundary = campaign?.address_source === 'map' && campaign?.territory_boundary;
  const hasRawAndSnapped = !!(campaign?.campaign_polygon_raw && campaign?.campaign_polygon_snapped);

  // Boundary line opacity: snapped emphasized (raw dimmed)
  useEffect(() => {
    const m = map.current;
    if (!SHOW_CAMPAIGN_BOUNDARY_OVERLAY) return;
    if (!m || !mapLoaded || !hasRawAndSnapped) return;
    if (!safeGetLayer(m, BOUNDARY_LAYER_RAW_LINE) || !safeGetLayer(m, BOUNDARY_LAYER_SNAPPED_LINE)) return;
    m.setPaintProperty(BOUNDARY_LAYER_RAW_LINE, 'line-opacity', 0.3);
    m.setPaintProperty(BOUNDARY_LAYER_SNAPPED_LINE, 'line-opacity', 1);
  }, [mapLoaded, hasRawAndSnapped]);

  // Parcels layer: show/hide when toggle changes
  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    const removeParcelsLayer = () => {
      if (safeGetLayer(m, PARCEL_LABEL_LAYER)) m.removeLayer(PARCEL_LABEL_LAYER);
      if (safeGetLayer(m, PARCEL_FILL_LAYER)) m.removeLayer(PARCEL_FILL_LAYER);
      if (safeGetLayer(m, PARCEL_LINE_LAYER)) m.removeLayer(PARCEL_LINE_LAYER);
      if (safeGetSource(m, PARCEL_LABEL_SOURCE_ID)) m.removeSource(PARCEL_LABEL_SOURCE_ID);
      if (safeGetSource(m, PARCEL_SOURCE_ID)) m.removeSource(PARCEL_SOURCE_ID);
    };

    if (parcels.length === 0) {
      removeParcelsLayer();
      return;
    }

    const getParcelFillColorExpression = (): mapboxgl.Expression => {
      const status = ['get', 'status_key'];
      return [
        'case',
        ['all', ['==', status, 'QR_SCANNED'], statusFilters.QR_SCANNED],
        MAP_STATUS_CONFIG.QR_SCANNED.color,
        ['all', ['==', status, 'HOT_LEADS'], statusFilters.HOT_LEADS],
        MAP_STATUS_CONFIG.HOT_LEADS.color,
        ['all', ['==', status, 'LEADS'], statusFilters.LEADS],
        MAP_STATUS_CONFIG.LEADS.color,
        ['all', ['==', status, 'CONVERSATIONS'], statusFilters.CONVERSATIONS],
        MAP_STATUS_CONFIG.CONVERSATIONS.color,
        ['all', ['==', status, 'DO_NOT_KNOCK'], statusFilters.DO_NOT_KNOCK],
        MAP_STATUS_CONFIG.DO_NOT_KNOCK.color,
        ['all', ['==', status, 'NO_ONE_HOME'], statusFilters.NO_ONE_HOME],
        MAP_STATUS_CONFIG.NO_ONE_HOME.color,
        ['all', ['==', status, 'TOUCHED'], statusFilters.TOUCHED],
        MAP_STATUS_CONFIG.TOUCHED.color,
        ['all', ['==', status, 'UNTOUCHED'], statusFilters.UNTOUCHED],
        MAP_STATUS_CONFIG.UNTOUCHED.color,
        parcelFillColor,
      ] as mapboxgl.Expression;
    };

    const getParcelFillOpacityExpression = (): mapboxgl.Expression => {
      const status = ['get', 'status_key'];
      return [
        'case',
        ['boolean', ['get', 'is_selected'], false],
        Math.min(parcelFillOpacity + 0.16, 0.42),
        ['all', ['==', status, 'QR_SCANNED'], statusFilters.QR_SCANNED],
        parcelFillOpacity,
        ['all', ['==', status, 'HOT_LEADS'], statusFilters.HOT_LEADS],
        parcelFillOpacity,
        ['all', ['==', status, 'LEADS'], statusFilters.LEADS],
        parcelFillOpacity,
        ['all', ['==', status, 'CONVERSATIONS'], statusFilters.CONVERSATIONS],
        parcelFillOpacity,
        ['all', ['==', status, 'DO_NOT_KNOCK'], statusFilters.DO_NOT_KNOCK],
        parcelFillOpacity,
        ['all', ['==', status, 'NO_ONE_HOME'], statusFilters.NO_ONE_HOME],
        parcelFillOpacity,
        ['all', ['==', status, 'TOUCHED'], statusFilters.TOUCHED],
        parcelFillOpacity,
        ['all', ['==', status, 'UNTOUCHED'], statusFilters.UNTOUCHED],
        parcelFillOpacity,
        0,
      ] as mapboxgl.Expression;
    };

    const addParcelsLayer = () => {
      if (!m.isStyleLoaded()) return;

      removeParcelsLayer();

      const parcelFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>> = [];
      const parcelLabelFeatures: Array<GeoJSON.Feature<GeoJSON.Point>> = [];
      const selectedParcelIdSet = new Set(selectedParcelIds.map((parcelId) => parcelId.toLowerCase()));
      const addressPointById = new Map(
        preparedAddressPoints.map((address) => [address.addressId.toLowerCase(), address]),
      );

      for (const parcel of parcels) {
        const geom = typeof parcel.geom === 'string' ? JSON.parse(parcel.geom) : parcel.geom;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

        const turfFeature = turf.feature(geom as GeoJSON.Polygon | GeoJSON.MultiPolygon);
        const statuses = new Set<MapStatusKey>();
        const addressesInParcel: PreparedAddressPoint[] = [];
        for (const addressPoint of preparedAddressPoints) {
          const point = turf.point([addressPoint.lon, addressPoint.lat]);
          if (turf.booleanPointInPolygon(point, turfFeature)) {
            statuses.add(addressPoint.statusKey);
            addressesInParcel.push(addressPoint);
          }
        }

        const statusKey = MAP_STATUS_PRIORITY.find((key) => statuses.has(key)) ?? 'UNTOUCHED';
        const parcelLabel = getParcelAddressLabel(parcel);
        const propertyLinkedAddressIds = linkedAddressIdsForParcelProperties(parcel.properties);
        const linkedTargetsFromProperties = propertyLinkedAddressIds
          .map((addressId) => addressPointById.get(addressId.toLowerCase()))
          .filter((address): address is PreparedAddressPoint => Boolean(address));
        const targetAddresses =
          linkedTargetsFromProperties.length > 0 ? linkedTargetsFromProperties : addressesInParcel;
        const primaryTarget = getPrimaryParcelTarget(targetAddresses);
        const externalId = parcelExternalId(parcel);
        const linkedAddressIds = uniqueParcelStrings([
          ...propertyLinkedAddressIds,
          ...addressesInParcel.map((address) => address.addressId),
        ]);
        const isSelected = [parcel.id, externalId, parcel.properties?.parcel_id, parcel.properties?.external_id]
          .map((value) => parcelStringValue(value)?.toLowerCase())
          .some((value) => (value ? selectedParcelIdSet.has(value) : false));

        parcelFeatures.push({
          type: 'Feature',
          geometry: geom as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          properties: {
            ...(parcel.properties ?? {}),
            external_id: externalId,
            parcel_row_id: parcel.id,
            parcel_id: parcel.properties?.parcel_id ?? externalId ?? parcel.id,
            campaign_parcel_id: parcel.properties?.campaign_parcel_id ?? parcel.id,
            address_id: primaryTarget?.addressId ?? null,
            linked_address_ids: linkedAddressIds,
            address_ids: linkedAddressIds,
            address_count: linkedAddressIds.length,
            is_linked: linkedAddressIds.length > 0,
            building_id: primaryTarget?.buildingId ?? null,
            label: parcelLabel,
            feature_type: parcel.properties?.FEATURE_TYPE || parcel.properties?.feature_type || 'COMMON',
            status_key: statusKey,
            is_selected: isSelected,
          },
        });

        if (parcelLabel) {
          const labelPoint = turf.pointOnFeature(turfFeature);
          parcelLabelFeatures.push({
            type: 'Feature',
            geometry: labelPoint.geometry,
            properties: {
              label: parcelLabel,
            },
          });
        }
      }

      const geojson: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
        type: 'FeatureCollection',
        features: parcelFeatures,
      };

      const labelGeojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: parcelLabelFeatures,
      };

      try {
        m.addSource(PARCEL_SOURCE_ID, {
          type: 'geojson',
          data: geojson,
        });
        m.addSource(PARCEL_LABEL_SOURCE_ID, {
          type: 'geojson',
          data: labelGeojson,
        });

        m.addLayer({
          id: PARCEL_FILL_LAYER,
          type: 'fill',
          source: PARCEL_SOURCE_ID,
          paint: {
            'fill-color': getParcelFillColorExpression(),
            'fill-opacity': getParcelFillOpacityExpression(),
          },
        });

        m.addLayer({
          id: PARCEL_LINE_LAYER,
          type: 'line',
          source: PARCEL_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['get', 'is_selected'], false],
              SELECTED_PARCEL_COLOR,
              parcelStrokeColor,
            ],
            'line-width': [
              'case',
              ['boolean', ['get', 'is_selected'], false],
              ['interpolate', ['linear'], ['zoom'], 12, 1.4, 14, 2.1, 16, 2.8, 18, 3.4],
              ['interpolate', ['linear'], ['zoom'], 12, 0.75, 14, 1.05, 16, 1.25, 18, parcelLineWidth],
            ],
            'line-opacity': ['case', ['boolean', ['get', 'is_selected'], false], 1, parcelLineOpacity],
          },
        });

        m.addLayer({
          id: PARCEL_LABEL_LAYER,
          type: 'symbol',
          source: PARCEL_LABEL_SOURCE_ID,
          minzoom: 16,
          layout: {
            'text-field': ['coalesce', ['get', 'label'], ''],
            'text-size': 12,
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
          },
          paint: {
            'text-color': parcelStrokeColor,
            'text-halo-color': parcelLabelHaloColor,
            'text-halo-width': 1,
            'text-opacity': 0.9,
          },
        });
        bringParcelLayersToFront(m);
      } catch (err) {
        console.error('Error adding parcels layer:', err);
      }
    };

    const onParcelClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      handleParcelClick(
        {
          parcelId: parcelStringValue(feature.properties.parcel_row_id),
          externalParcelId: parcelStringValue(feature.properties.external_id ?? feature.properties.parcel_id),
          featureId: typeof feature.id === 'string' || typeof feature.id === 'number' ? feature.id : null,
          properties: feature.properties,
          lngLat: event.lngLat,
        },
        {
          additive: Boolean(
            (event.originalEvent as MouseEvent | undefined)?.metaKey ||
            (event.originalEvent as MouseEvent | undefined)?.ctrlKey,
          ),
        },
      );
    };

    // Use a map-level click handler so Mapbox does not run layer-scoped
    // queryRenderedFeatures internally during style transitions.
    const onParcelMapClick = (e: mapboxgl.MapMouseEvent) => {
      try {
        if (!m.isStyleLoaded() || !m.getLayer(PARCEL_FILL_LAYER)) return;
        if (hasRenderedBaseMapFeatureAtPoint(m, e.point, mapViewMode)) return;
        const features = m.queryRenderedFeatures(e.point, {
          layers: [PARCEL_FILL_LAYER],
        });
        if (features.length > 0) onParcelClick(Object.assign(e, { features }));
      } catch {
        return;
      }
    };

    // Replace layer-scoped mouseenter/mouseleave with a map-level
    // mousemove handler. Layer-scoped hover events cause Mapbox to
    // internally call queryRenderedFeatures on every mousemove, which
    // throws during style transitions when the layer registry is
    // temporarily unavailable. A map-level mousemove with explicit
    // isStyleLoaded() and try/catch guards avoids this entirely.
    const onParcelMouseMove = (e: mapboxgl.MapMouseEvent) => {
      try {
        if (!m.isStyleLoaded() || !m.getLayer(PARCEL_FILL_LAYER)) {
          m.getCanvas().style.cursor = '';
          return;
        }
        if (hasRenderedBaseMapFeatureAtPoint(m, e.point, mapViewMode)) {
          m.getCanvas().style.cursor = 'pointer';
          return;
        }
        const features = m.queryRenderedFeatures(e.point, {
          layers: [PARCEL_FILL_LAYER],
        });
        m.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
      } catch {
        m.getCanvas().style.cursor = '';
      }
    };

    if (!showGeojsonParcels) {
      m.off('click', onParcelMapClick);
      m.off('mousemove', onParcelMouseMove);
      removeParcelsLayer();
      return;
    }

    if (m.isStyleLoaded()) {
      addParcelsLayer();
    } else {
      m.once('style.load', addParcelsLayer);
    }

    m.off('click', onParcelMapClick);
    m.off('mousemove', onParcelMouseMove);
    m.on('click', onParcelMapClick);
    m.on('mousemove', onParcelMouseMove);

    return () => {
      m.off('click', onParcelMapClick);
      m.off('mousemove', onParcelMouseMove);
      removeParcelsLayer();
    };
  }, [
    mapLoaded,
    mapViewMode,
    showGeojsonParcels,
    parcels,
    preparedAddressPoints,
    statusFilters,
    parcelStrokeColor,
    parcelFillOpacity,
    parcelLineOpacity,
    parcelLineWidth,
    parcelLabelHaloColor,
    handleParcelClick,
    selectedParcelIds,
  ]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded || !showGeojsonParcels) return;

    const promoteParcelLayers = () => {
      bringParcelLayersToFront(m);
    };

    promoteParcelLayers();
    const frameId = window.requestAnimationFrame(promoteParcelLayers);
    const timeoutId = window.setTimeout(promoteParcelLayers, 250);
    m.on('idle', promoteParcelLayers);
    m.on('styledata', promoteParcelLayers);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      m.off('idle', promoteParcelLayers);
      m.off('styledata', promoteParcelLayers);
    };
  }, [mapLoaded, showGeojsonParcels, mapViewMode, resolvedMapStyle.key, mapBundleDataKey]);

  const handleSnapToRoads = async () => {
    setSnapping(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/snap`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) onSnapComplete?.();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Snap to roads failed');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Snap to roads failed');
    } finally {
      setSnapping(false);
    }
  };

  const anyStatusFilterActive = Object.values(statusFilters).some(Boolean);
  const waitingForInitialBuildingRender =
    Boolean(buildingPendingOverlay) &&
    mapLoaded &&
    mapViewMode === 'buildings' &&
    anyStatusFilterActive &&
    !hasRenderedBuildingsRef.current &&
    !buildingsRenderState.buildingsUnavailable &&
    (buildingsRenderState.isFetching ||
      (buildingsRenderState.hasData &&
        buildingsRenderState.zoomLevel >= 12 &&
        !buildingsRenderState.hasBuildingPolygons));
  useEffect(() => {
    if (mapViewMode !== 'buildings') {
      setShowBuildingPendingOverlay(false);
      return;
    }

    if (!waitingForInitialBuildingRender) {
      setShowBuildingPendingOverlay(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowBuildingPendingOverlay(true);
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mapViewMode, waitingForInitialBuildingRender]);

  const clearDemoCameraTimers = useCallback(() => {
    for (const timeoutId of demoCameraTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    demoCameraTimeoutsRef.current = [];
    if (demoCameraFrameRef.current !== null) {
      window.cancelAnimationFrame(demoCameraFrameRef.current);
      demoCameraFrameRef.current = null;
    }
  }, []);

  const stopDemoCamera = useCallback(() => {
    clearDemoCameraTimers();
    map.current?.stop();
    setActiveDemoCameraShot(null);
    setDemoPlaybackColorOverrides(null);
  }, [clearDemoCameraTimers]);

  const playDemoCamera = useCallback(
    (shot: DemoCameraShot) => {
      const currentMap = map.current;
      if (!movieMapControlsEnabled || !currentMap || !mapLoaded) return;

      const bounds = getCampaignMapBounds();
      const center = bounds?.getCenter() ?? currentMap.getCenter();
      const centerTuple: [number, number] = [center.lng, center.lat];
      const sweep = bounds ? demoSweepEndpoints(bounds) : null;
      const fallbackZoom = Math.max(15, Math.min(17.2, currentMap.getZoom() || 15));
      const speedMultiplier = demoCameraSpeed === 'superSlow' ? 2.6 : 1;
      const speed = (milliseconds: number) => Math.round(milliseconds * speedMultiplier);

      clearDemoCameraTimers();
      currentMap.stop();
      currentMap.resize();
      setDemoPlaybackColorOverrides(null);
      setMapViewMode('buildings');
      setShowDemoControls(true);
      setActiveDemoCameraShot(shot);

      const schedule = (callback: () => void, delay: number) => {
        const timeoutId = window.setTimeout(callback, speed(delay));
        demoCameraTimeoutsRef.current.push(timeoutId);
      };

      const finishAfter = (delay: number) => {
        schedule(() => setActiveDemoCameraShot(null), delay);
      };

      const fitCampaign = (options: DemoFitCameraOptions) => {
        if (bounds) {
          currentMap.fitBounds(bounds, {
            padding: { top: 84, right: 84, bottom: 120, left: 84 },
            ...options,
          });
          return;
        }
        currentMap.easeTo({
          center: centerTuple,
          zoom: fallbackZoom,
          pitch: options.pitch,
          bearing: options.bearing,
          duration: options.duration,
          easing: easeInOutCubic,
        });
      };

      if (shot === 'orbit') {
        fitCampaign({
          maxZoom: 16,
          duration: speed(900),
          pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
          bearing: -35,
        });
        schedule(() => {
          const startAt = performance.now();
          const startBearing = currentMap.getBearing();
          const orbitZoom = Math.max(15.4, Math.min(17, currentMap.getZoom() + 0.45));
          const duration = speed(11000);

          const step = (now: number) => {
            const progress = Math.min(1, (now - startAt) / duration);
            currentMap.jumpTo({
              center: centerTuple,
              zoom: orbitZoom,
              pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
              bearing: startBearing + progress * 360,
            });

            if (progress < 1) {
              demoCameraFrameRef.current = window.requestAnimationFrame(step);
            } else {
              demoCameraFrameRef.current = null;
              setActiveDemoCameraShot(null);
            }
          };

          demoCameraFrameRef.current = window.requestAnimationFrame(step);
        }, 980);
        return;
      }

      if (shot === 'birdToStreet') {
        fitCampaign({
          maxZoom: 15.2,
          duration: speed(900),
          pitch: 0,
          bearing: 0,
        });
        schedule(() => {
          currentMap.flyTo({
            center: centerTuple,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
            bearing: sweep?.bearing ?? 35,
            duration: speed(4200),
            essential: true,
          });
        }, 1050);
        finishAfter(5400);
        return;
      }

      if (shot === 'birdFlyThrough') {
        const start = sweep?.start ?? centerTuple;
        const middle = sweep?.middle ?? centerTuple;
        const end = sweep?.end ?? centerTuple;
        const bearing = sweep?.bearing ?? 0;
        currentMap.flyTo({
          center: start,
          zoom: Math.max(17.1, fallbackZoom + 0.9),
          pitch: 0,
          bearing,
          duration: speed(1050),
          essential: true,
        });
        schedule(() => {
          currentMap.easeTo({
            center: middle,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: 0,
            bearing,
            duration: speed(3000),
            easing: easeInOutCubic,
          });
        }, 1080);
        schedule(() => {
          currentMap.easeTo({
            center: end,
            zoom: DEMO_CAMERA_ZOOM_STREET,
            pitch: 0,
            bearing,
            duration: speed(3300),
            easing: easeInOutCubic,
          });
        }, 4150);
        finishAfter(7600);
        return;
      }

      if (shot === 'craneReveal') {
        const bearing = sweep?.bearing ?? -25;
        currentMap.flyTo({
          center: centerTuple,
          zoom: DEMO_CAMERA_ZOOM_STREET,
          pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
          bearing,
          duration: speed(1100),
          essential: true,
        });
        schedule(() => {
          fitCampaign({
            maxZoom: 15.3,
            duration: speed(5200),
            pitch: 0,
            bearing: bearing + 42,
          });
        }, 1150);
        finishAfter(6600);
        return;
      }

      if (shot === 'angledPullback') {
        const currentCenter = currentMap.getCenter();
        const startCenter: [number, number] = [currentCenter.lng, currentCenter.lat];
        const startZoom = currentMap.getZoom();
        const startPitch = currentMap.getPitch();
        const startBearing = currentMap.getBearing();
        const duration = speed(5600);
        const targetPitch = startPitch > 45 ? 45 : startPitch;
        const startAt = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - startAt) / duration);
          const eased = easeInOutCubic(progress);

          currentMap.jumpTo({
            center: startCenter,
            zoom: Math.max(13.4, startZoom - 1.85 * eased),
            pitch: startPitch + (targetPitch - startPitch) * eased,
            bearing: startBearing,
          });

          if (progress < 1) {
            demoCameraFrameRef.current = window.requestAnimationFrame(step);
          } else {
            demoCameraFrameRef.current = null;
            setActiveDemoCameraShot(null);
          }
        };

        demoCameraFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      if (shot === 'slideLeft') {
        const startCenter = currentMap.getCenter();
        const startCenterTuple: [number, number] = [startCenter.lng, startCenter.lat];
        const startPoint = currentMap.project(startCenter);
        const canvas = currentMap.getCanvas();
        const endCenter = currentMap.unproject([
          startPoint.x - Math.max(360, canvas.clientWidth * 0.62),
          startPoint.y,
        ]);
        const endCenterTuple: [number, number] = [endCenter.lng, endCenter.lat];
        const zoom = currentMap.getZoom();
        const pitch = currentMap.getPitch();
        const bearing = currentMap.getBearing();
        const duration = speed(5200);
        const startAt = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - startAt) / duration);
          const eased = easeInOutCubic(progress);

          currentMap.jumpTo({
            center: [
              startCenterTuple[0] + (endCenterTuple[0] - startCenterTuple[0]) * eased,
              startCenterTuple[1] + (endCenterTuple[1] - startCenterTuple[1]) * eased,
            ],
            zoom,
            pitch,
            bearing,
          });

          if (progress < 1) {
            demoCameraFrameRef.current = window.requestAnimationFrame(step);
          } else {
            demoCameraFrameRef.current = null;
            setActiveDemoCameraShot(null);
          }
        };

        demoCameraFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      if (shot === 'streetSegments') {
        const orderedTargets = demoAddressTargets.length > 0 ? demoAddressTargets : [];
        if (demoSegmentCameraAngle !== 'fixed') {
          const segmentCamera = {
            bird: {
              maxZoom: 16.8,
              pitch: 0,
              bearing: 0,
            },
            threeD: {
              maxZoom: 16.2,
              pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
              bearing: sweep?.bearing ?? -12,
            },
            street: {
              maxZoom: 17.4,
              pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
              bearing: sweep?.bearing ?? 35,
            },
          }[demoSegmentCameraAngle];

          fitCampaign({
            ...segmentCamera,
            duration: speed(900),
          });
        }
        setDemoPlaybackColorOverrides({});

        const litColors: Record<string, string> = {};
        let delay = 1050;
        let previousStreetKey: string | null = null;
        orderedTargets.forEach((target, index) => {
          if (previousStreetKey && previousStreetKey !== target.streetKey) {
            delay += 420;
          }
          previousStreetKey = target.streetKey;

          schedule(() => {
            litColors[target.addressId] =
              demoColorMode === 'random'
                ? DEMO_RANDOM_COLORS[deterministicColorIndex(target.addressId, DEMO_RANDOM_COLORS.length)]
                : DEMO_GREEN_COLOR;
            setDemoPlaybackColorOverrides({ ...litColors });
          }, delay);
          delay += index < 35 ? 110 : 70;
        });

        finishAfter(Math.max(1800, delay + 500));
        return;
      }

      if (shot === 'flyThrough') {
        const start = sweep?.start ?? centerTuple;
        const middle = sweep?.middle ?? centerTuple;
        const end = sweep?.end ?? centerTuple;
        const bearing = sweep?.bearing ?? currentMap.getBearing();
        currentMap.flyTo({
          center: start,
          zoom: Math.max(16, fallbackZoom),
          pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
          bearing,
          duration: speed(1200),
          essential: true,
        });
        schedule(() => {
          currentMap.easeTo({
            center: middle,
            zoom: Math.max(17, fallbackZoom + 0.6),
            pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
            bearing,
            duration: speed(3600),
            easing: easeInOutCubic,
          });
        }, 1250);
        schedule(() => {
          currentMap.easeTo({
            center: end,
            zoom: Math.max(17, fallbackZoom + 0.6),
            pitch: DEMO_CAMERA_PITCH_3D_DEGREES,
            bearing,
            duration: speed(3600),
            easing: easeInOutCubic,
          });
        }, 4900);
        finishAfter(8700);
        return;
      }

      const start = sweep?.start ?? centerTuple;
      const end = sweep?.end ?? centerTuple;
      const bearing = sweep?.bearing ?? 35;
      currentMap.flyTo({
        center: start,
        zoom: DEMO_CAMERA_ZOOM_STREET,
        pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
        bearing,
        duration: speed(1000),
        essential: true,
      });
      schedule(() => {
        currentMap.easeTo({
          center: end,
          zoom: DEMO_CAMERA_ZOOM_STREET,
          pitch: DEMO_CAMERA_PITCH_STREET_DEGREES,
          bearing,
          duration: speed(6200),
          easing: easeInOutCubic,
        });
      }, 1100);
      finishAfter(7600);
    },
    [clearDemoCameraTimers, demoAddressTargets, demoCameraSpeed, demoColorMode, demoSegmentCameraAngle, getCampaignMapBounds, mapLoaded, movieMapControlsEnabled],
  );

  useEffect(() => {
    return () => {
      clearDemoCameraTimers();
      map.current?.stop();
    };
  }, [clearDemoCameraTimers]);

  useEffect(() => {
    if (movieMapControlsEnabled) return;
    setShowDemoControls(false);
    setDemoColorMode('status');
    stopDemoCamera();
  }, [movieMapControlsEnabled, stopDemoCamera]);

  const handleDemoColorModeChange = useCallback((mode: DemoColorMode) => {
    setDemoPlaybackColorOverrides(null);
    setDemoColorMode(mode);
    if (mode !== 'status') {
      setMapViewMode('buildings');
    }
  }, []);

  const handleMapShellPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="button"], .mapboxgl-ctrl')) return;

    const now = performance.now();
    const nextCount = now - demoTapGestureRef.current.lastTapAt < 700 ? demoTapGestureRef.current.count + 1 : 1;
    demoTapGestureRef.current = { count: nextCount, lastTapAt: now };

    if (nextCount >= 4) {
      demoTapGestureRef.current = { count: 0, lastTapAt: 0 };
      setShowDemoControls(true);
    }
  }, []);

  const zoomMapIn = useCallback(() => {
    map.current?.zoomIn({ duration: 260 });
  }, []);

  const zoomMapOut = useCallback(() => {
    map.current?.zoomOut({ duration: 260 });
  }, []);

  const toggleMapPitch = useCallback(() => {
    const currentMap = map.current;
    if (!currentMap) return;
    currentMap.easeTo({
      pitch: currentMap.getPitch() > 10 ? 0 : MAP_CAMERA_PITCH_DEGREES,
      duration: 320,
    });
  }, []);

  const rotateMapClockwise = useCallback(() => {
    const currentMap = map.current;
    if (!currentMap) return;
    currentMap.easeTo({
      bearing: currentMap.getBearing() + MAP_ROTATE_STEP_DEGREES,
      duration: 320,
    });
  }, []);

  return (
    <div
      ref={mapShellRef}
      onPointerDown={handleMapShellPointerDown}
      className={`relative h-full w-full ${isMapFullscreen ? 'bg-background' : ''}`}
    >
      <div ref={mapContainer} className="h-full w-full" />
      {mapInitFailed ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background p-6">
          <div className="max-w-sm rounded-lg border border-border bg-card p-5 text-center shadow-lg">
            <p className="text-sm font-semibold text-foreground">Map could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">Please refresh the page.</p>
            <Button className="mt-4" size="sm" onClick={() => window.location.reload()}>
              Refresh
            </Button>
          </div>
        </div>
      ) : null}
      {map.current && mapLoaded && (
        <>
          <MapInfoButton
            show
            statusFilters={statusFilters}
            onStatusFiltersChange={setStatusFilters}
            portalContainer={mapShellRef.current}
            extraContent={
              multiSelectedTargets.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    {multiSelectedTargets.length} house
                    {multiSelectedTargets.length === 1 ? '' : 's'} selected with Command-click.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBulkDeleteSelectedTargets}
                      disabled={bulkDeleting}
                      className="h-8 gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {bulkDeleting ? 'Deleting…' : 'Delete Selected'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMultiSelectedTargets([])}
                      disabled={bulkDeleting}
                      className="h-8 px-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Hold Command and click houses on the map to multi-select them for deletion.
                </p>
              )
            }
          />
          {multiSelectedTargets.length > 0 ? (
            <div className="pointer-events-none absolute top-14 left-3 z-20">
              <div className="rounded-xl border border-amber-200 bg-white/92 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-amber-900/50 dark:bg-black/82">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {multiSelectedTargets.length} house
                  {multiSelectedTargets.length === 1 ? '' : 's'} selected
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">Open Tools to delete or clear selection</p>
              </div>
            </div>
          ) : null}
          {/* View switcher: Buildings | Addresses, with parcels as an overlay */}
          <div className="pointer-events-none absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
            <div className="pointer-events-auto flex items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-black/80 backdrop-blur-sm shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMapViewMode('buildings')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${mapViewMode === 'buildings' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  Buildings
                </button>
                <button
                  type="button"
                  onClick={() => setMapViewMode('addresses')}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${mapViewMode === 'addresses' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  Addresses
                </button>
                {SHOW_PARCEL_VIEW && parcelsReady ? (
                  <button
                    type="button"
                    onClick={() => setShowParcelsOverlay((current) => !current)}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      showParcelsOverlay
                        ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    aria-pressed={showParcelsOverlay}
                    title={`${parcels.length} parcel${parcels.length !== 1 ? 's' : ''} linked in the campaign map bundle`}
                  >
                    Parcels
                    <span className="ml-1 text-xs opacity-60">({parcels.length})</span>
                  </button>
                ) : null}
              </div>
              {movieMapControlsEnabled ? (
                <button
                  type="button"
                  onClick={() => setShowDemoControls((current) => !current)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white/90 text-sm font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-black/80 dark:hover:bg-gray-800 ${
                    showDemoControls
                      ? 'text-gray-950 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                  aria-label="Demo controls"
                  aria-pressed={showDemoControls}
                  title="Demo controls"
                >
                  <Clapperboard className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void toggleMapFullscreen()}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white/90 text-sm font-medium text-gray-600 shadow-sm backdrop-blur-sm transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-black/80 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label={isMapFullscreen ? 'Exit full screen map' : 'Full screen map'}
                title={isMapFullscreen ? 'Exit full screen map' : 'Full screen map'}
              >
                {isMapFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
            {movieMapControlsEnabled && showDemoControls ? (
              <div className="pointer-events-auto w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white/94 p-2 shadow-lg backdrop-blur-sm dark:border-gray-700 dark:bg-black/86">
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { mode: 'status' as DemoColorMode, label: 'Status', icon: Palette },
                    { mode: 'allGreen' as DemoColorMode, label: 'Green', icon: Sparkles },
                    { mode: 'random' as DemoColorMode, label: 'Random', icon: Shuffle },
                  ].map(({ mode, label, icon: Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleDemoColorModeChange(mode)}
                      className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
                        demoColorMode === mode
                          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                      aria-pressed={demoColorMode === mode}
                      title={`${label} demo colors`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {[
                    { angle: 'fixed' as DemoSegmentCameraAngle, label: 'Fixed' },
                    { angle: 'bird' as DemoSegmentCameraAngle, label: 'Bird' },
                    { angle: 'threeD' as DemoSegmentCameraAngle, label: '3D' },
                    { angle: 'street' as DemoSegmentCameraAngle, label: 'Street' },
                  ].map(({ angle, label }) => (
                    <button
                      key={angle}
                      type="button"
                      onClick={() => setDemoSegmentCameraAngle(angle)}
                      className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1.5 text-[11px] font-medium transition-colors ${
                        demoSegmentCameraAngle === angle
                          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                      aria-pressed={demoSegmentCameraAngle === angle}
                      title={`Street segments ${label} camera`}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  {[
                    { speed: 'normal' as DemoCameraSpeed, label: 'Normal' },
                    { speed: 'superSlow' as DemoCameraSpeed, label: 'Super slow' },
                  ].map(({ speed, label }) => (
                    <button
                      key={speed}
                      type="button"
                      onClick={() => setDemoCameraSpeed(speed)}
                      className={`flex h-8 min-w-0 items-center justify-center rounded-md px-2 text-[11px] font-medium transition-colors ${
                        demoCameraSpeed === speed
                          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                      aria-pressed={demoCameraSpeed === speed}
                      title={`${label} demo speed`}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1">
                  {[
                    { shot: 'orbit' as DemoCameraShot, label: 'Orbit', icon: Compass },
                    { shot: 'birdToStreet' as DemoCameraShot, label: 'Bird to street', icon: Film },
                    { shot: 'birdFlyThrough' as DemoCameraShot, label: 'Bird fly', icon: Play },
                    { shot: 'craneReveal' as DemoCameraShot, label: 'Crane reveal', icon: Film },
                    { shot: 'angledPullback' as DemoCameraShot, label: 'Angle pullback', icon: Maximize2 },
                    { shot: 'slideLeft' as DemoCameraShot, label: 'Slide left', icon: ArrowLeft },
                    { shot: 'flyThrough' as DemoCameraShot, label: 'Fly-through', icon: Play },
                    { shot: 'streetSweep' as DemoCameraShot, label: 'Street sweep', icon: RotateCw },
                    { shot: 'streetSegments' as DemoCameraShot, label: 'Street segments', icon: Sparkles },
                  ].map(({ shot, label, icon: Icon }) => (
                    <button
                      key={shot}
                      type="button"
                      onClick={() => playDemoCamera(shot)}
                      className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
                        activeDemoCameraShot === shot
                          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                      aria-pressed={activeDemoCameraShot === shot}
                      title={`Play ${label}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
                {activeDemoCameraShot ? (
                  <button
                    type="button"
                    onClick={stopDemoCamera}
                    className="mt-1.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-red-50 px-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/35 dark:text-red-300 dark:hover:bg-red-950/55"
                    title="Stop demo camera"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="pointer-events-none absolute right-4 bottom-8 z-20 flex flex-col items-end gap-1.5">
            <div className="pointer-events-auto overflow-hidden rounded-lg border border-gray-200 bg-white/92 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-black/82">
              <button
                type="button"
                onClick={zoomMapIn}
                className="flex h-8 w-8 items-center justify-center text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </button>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <button
                type="button"
                onClick={zoomMapOut}
                className="flex h-8 w-8 items-center justify-center text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
            <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/92 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-black/82">
              <button
                type="button"
                onClick={rotateMapClockwise}
                className="flex h-8 w-8 items-center justify-center text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-label="Rotate map"
                title="Rotate map"
              >
                <RotateCw className="h-4 w-4" />
              </button>
              <div className="h-px bg-gray-200 dark:bg-gray-700" />
              <button
                type="button"
                onClick={toggleMapPitch}
                className="flex h-8 w-8 items-center justify-center text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                aria-label="Toggle map tilt"
                title="Toggle map tilt"
              >
                <Compass className="h-4 w-4" />
              </button>
            </div>
          </div>
          {buildingsRenderState.buildingsUnavailable && mapViewMode === 'buildings' ? (
            <div className="pointer-events-none absolute bottom-4 left-4 z-20">
              <div className="rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                Building data unavailable
              </div>
            </div>
          ) : showBuildingPendingOverlay && buildingPendingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-lg border border-border bg-background/92 p-4 shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                    {loadingAnimationData ? (
                      <Lottie
                        animationData={loadingAnimationData}
                        loop
                        className="h-full w-full"
                        rendererSettings={{
                          preserveAspectRatio: 'xMidYMid meet',
                        }}
                      />
                    ) : (
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{buildingPendingOverlay.title}</p>
                    <p className="text-sm text-muted-foreground">{buildingPendingOverlay.description}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {mapViewMode === 'buildings' && (
            <MapBuildingsLayer
              map={map.current}
              campaignId={campaignId}
              campaignType={campaign?.type ?? null}
              refreshKey={mapRefreshKey}
              buildingFeatures={bundleBuildings}
              buildingDataKey={mapBundleDataKey}
              addressStateOverrides={mapAddresses}
              assignmentColorByAddressId={demoAddressColorOverrides}
              visibleAddressIds={visibleAddressIds}
              hiddenBuildingIds={optimisticallyHiddenBuildingIds}
              deletedAddressIds={optimisticallyDeletedAddressIds}
              campaignBoundary={(campaign?.territory_boundary as GeoJSON.Polygon | null | undefined) ?? null}
              campaignBbox={campaignBbox}
              statusFilters={statusFilters}
              showAddressLabels={false}
              footprintStatusColors
              isDarkMap={theme === 'dark'}
              onBuildingClick={handleBuildingClick}
              onRenderStateChange={handleBuildingsRenderStateChange}
            />
          )}
          <CampaignAddressPmtilesLayer
            map={map.current}
            campaignId={campaignId}
            mapLoaded={mapLoaded}
            visible={mapViewMode === 'addresses'}
            addresses={mapAddresses}
            campaignType={campaign?.type ?? null}
            statusFilters={statusFilters}
            deletedAddressIds={optimisticallyDeletedAddressIds}
            campaignBoundary={(campaign?.territory_boundary as GeoJSON.Polygon | null | undefined) ?? null}
            campaignBbox={campaignBbox}
            styleKey={resolvedMapStyle.key}
            allowFallbackFetches={false}
            onAddressClick={(addressId, buildingId, options) => {
              handleMapTargetClick({ buildingId, addressId, parcelId: null }, options);
            }}
          />
          {/* Location Card - floating card when building is clicked */}
          {locationCardOpen && selectedBuildingId && (
            <div className="absolute bottom-6 left-4 z-20">
              <LocationCard
                gersId={selectedBuildingId}
                campaignId={campaignId}
                preferredAddressId={selectedAddressIdForCard}
                onSelectAddress={(id) => setSelectedAddressIdForCard(id ?? null)}
                onClose={handleCloseLocationCard}
                onAddContact={handleAddContact}
                extraContent={
                  <div className="space-y-2">
                    {(selectedParcelId || selectedBuildingDeleteId || selectedAddressIdForCard) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDeleteSelectedLocation}
                        disabled={deletingTarget !== null}
                        className="w-full justify-start gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                        {deletingTarget === 'selection' ? 'Deleting location…' : 'Delete Location'}
                      </Button>
                    )}
                    {renderLocationCardExtra
                      ? renderLocationCardExtra({
                          selectedBuildingId,
                          selectedAddressId: selectedAddressIdForCard,
                          campaignId,
                        })
                      : null}
                  </div>
                }
              />
            </div>
          )}
        </>
      )}

      {/* Create Contact Dialog */}
      {userId && (
        <CreateContactDialog
          open={createContactOpen}
          onClose={() => {
            setCreateContactOpen(false);
            setSelectedAddressId(undefined);
            setSelectedAddressText(undefined);
            setSelectedContactNotes(undefined);
          }}
          onSuccess={handleContactCreated}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
          initialAddress={selectedAddressText}
          initialAddressId={selectedAddressId}
          initialCampaignId={campaignId}
          initialNotes={selectedContactNotes}
        />
      )}
    </div>
  );
}
