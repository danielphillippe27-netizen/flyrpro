'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import type { PostgrestError } from '@supabase/supabase-js';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as turf from '@turf/turf';
import { Maximize2, Minimize2, Trash2 } from 'lucide-react';
import Lottie from 'lottie-react';
import type { CampaignAddress, CampaignV2, CampaignParcel } from '@/types/database';
import { MapBuildingsLayer, type MapBuildingsRenderState } from '@/components/map/MapBuildingsLayer';
import { CampaignAddressPmtilesLayer } from '@/components/map/CampaignAddressPmtilesLayer';
import { CampaignParcelPmtilesLayer } from '@/components/map/CampaignParcelPmtilesLayer';
import type { BuildingFeatureCollection } from '@/types/map-buildings';
import { MapInfoButton } from '@/components/map/MapInfoButton';
import { LocationCard } from '@/components/map/LocationCard';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { Button } from '@/components/ui/button';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import { createClient } from '@/lib/supabase/client';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { useTheme } from '@/lib/theme-provider';
import { useMapStyle } from '@/lib/map-style-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { applyPresetVisualTweaks, applyResolvedMapStyle, getResolvedMapInitOptions, hideBaseBuildingLayers, resolveMapStyle } from '@/lib/map-styles';
import {
  DEFAULT_STATUS_FILTERS,
  MAP_STATUS_CONFIG,
  MAP_STATUS_PRIORITY,
  type MapStatusKey,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import { useFullscreen } from '@/lib/hooks/useFullscreen';

const PARCEL_SOURCE_ID = 'campaign-parcels';
const PARCEL_LABEL_SOURCE_ID = 'campaign-parcels-labels';
const PARCEL_FILL_LAYER = 'campaign-parcels-fill';
const PARCEL_LINE_LAYER = 'campaign-parcels-line';
const PARCEL_LABEL_LAYER = 'campaign-parcels-label';

const BOUNDARY_SOURCE_RAW = 'campaign-boundary-raw';
const BOUNDARY_SOURCE_SNAPPED = 'campaign-boundary-snapped';
const BOUNDARY_LAYER_RAW_FILL = 'campaign-boundary-raw-fill';
const BOUNDARY_LAYER_RAW_LINE = 'campaign-boundary-raw-line';
const BOUNDARY_LAYER_SNAPPED_FILL = 'campaign-boundary-snapped-fill';
const BOUNDARY_LAYER_SNAPPED_LINE = 'campaign-boundary-snapped-line';
const SHOW_CAMPAIGN_BOUNDARY_OVERLAY = false;
const SHOW_PARCEL_VIEW = false;
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

type MapViewMode = 'buildings' | 'addresses' | 'parcels';

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

type GenericFeatureCollection<G extends GeoJSON.Geometry = GeoJSON.Geometry> = GeoJSON.FeatureCollection<G, Record<string, unknown>>;

type CampaignMapBundle = {
  campaign_id?: string;
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

function isFeatureCollection<G extends GeoJSON.Geometry>(
  value: unknown
): value is GenericFeatureCollection<G> {
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
  collection?: GenericFeatureCollection<GeoJSON.Point>
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

    return [{
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
    } satisfies CampaignAddress];
  });
}

function mapBundleParcelsToCampaignParcels(
  campaignId: string,
  collection?: GenericFeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
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
    const id = getStringProperty(properties, ['id', 'parcel_row_id']) ?? externalId ?? String(feature.id ?? `bundle-parcel-${index}`);

    return [{
      id,
      campaign_id: campaignId,
      external_id: externalId ?? undefined,
      geom: JSON.stringify(feature.geometry),
      properties,
      created_at: new Date().toISOString(),
    } satisfies CampaignParcel];
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

function isCustomBuildingLayer(layerId: string): boolean {
  return CUSTOM_BUILDING_LAYER_PREFIXES.some((prefix) => layerId.startsWith(prefix));
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
      geometry = JSON.parse(geometry) as { type?: string; coordinates?: number[] };
    } catch {
      geometry = null;
    }
  }

  const geometryPoint = geometry as { type?: string; coordinates?: number[] } | null;
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
  if (['appointment', 'future_seller', 'hot_lead'].includes(status)) {
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

function getCampaignParcelExternalId(parcel: CampaignParcel): string | null {
  const candidates = [
    parcel.external_id,
    parcel.properties?.parcel_id,
    parcel.properties?.external_id,
    parcel.properties?.PARCELID,
    parcel.properties?.gisid,
    parcel.properties?.roll_number,
    parcel.properties?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const normalized = String(candidate).trim();
      if (normalized) return normalized;
    }
  }

  return null;
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

export function CampaignDetailMapView({
  campaignId,
  addresses,
  campaign,
  onSnapComplete,
  renderLocationCardExtra,
  buildingPendingOverlay,
  pointOverlays = [],
  initialMapViewMode = 'buildings',
}: {
  campaignId: string;
  addresses: CampaignAddress[];
  campaign?: CampaignV2 | null;
  onSnapComplete?: () => void;
  renderLocationCardExtra?: (args: {
    selectedBuildingId: string;
    selectedAddressId?: string | null;
    campaignId: string;
  }) => ReactNode;
  buildingPendingOverlay?: BuildingPendingOverlayConfig;
  pointOverlays?: MapPointOverlay[];
  initialMapViewMode?: MapViewMode;
}) {
  const { theme } = useTheme();
  const { preset: mapPreset } = useMapStyle();
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const resolvedMapStyle = useMemo(
    () => resolveMapStyle(mapPreset, theme, 'v12'),
    [mapPreset, theme],
  );
  const mapShellRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { isFullscreen: isMapFullscreen, toggle: toggleMapFullscreen } = useFullscreen(mapShellRef);
  const [statusFilters, setStatusFilters] = useState<StatusFilters>(DEFAULT_STATUS_FILTERS);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loadingAnimationData, setLoadingAnimationData] = useState<object | null>(null);
  const [buildingsRenderState, setBuildingsRenderState] = useState<MapBuildingsRenderState>({
    isFetching: false,
    hasData: false,
    hasVisibleFeatures: false,
    hasBuildingPolygons: false,
    featureCount: 0,
    visibleFeatureCount: 0,
    zoomLevel: 15,
  });
  const [showBuildingPendingOverlay, setShowBuildingPendingOverlay] = useState(false);
  const boundsFittedRef = useRef(false);
  const initAttemptedRef = useRef(false);
  const hasRenderedBuildingsRef = useRef(false);
  
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

  const resolvedInitialMapViewMode = initialMapViewMode === 'parcels' && !SHOW_PARCEL_VIEW
    ? 'buildings'
    : initialMapViewMode;
  // Map view: residential buildings by default, with address points available as a focused overlay.
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>(resolvedInitialMapViewMode);
  // Boundary: Snap to Roads and Raw vs Snapped toggle
  const [snapping, setSnapping] = useState(false);
  const [parcels, setParcels] = useState<CampaignParcel[]>([]);
  const [mapBundle, setMapBundle] = useState<CampaignMapBundle | null>(null);
  const [pmtilesParcelsReady, setPmtilesParcelsReady] = useState(false);
  const [parcelFetchSuppressed, setParcelFetchSuppressed] = useState(false);
  const parcelFetchFailureCountRef = useRef(0);
  const parcelEnrichmentStatus = campaign?.parcel_enrichment_status ?? 'not_started';
  const hasParcelPmtilesScope = parcels.length > 0 || Boolean(campaign?.territory_boundary);
  const parcelsReady = SHOW_PARCEL_VIEW && (parcels.length > 0 || (pmtilesParcelsReady && hasParcelPmtilesScope));
  const parcelsProcessing = parcelEnrichmentStatus === 'queued' || parcelEnrichmentStatus === 'processing';
  const showGeojsonParcels = SHOW_PARCEL_VIEW && mapViewMode === 'parcels' && parcels.length > 0;
  const parcelStrokeColor = theme === 'dark' ? '#ffffff' : '#000000';
  const parcelFillOpacity = theme === 'dark' ? 0.12 : 0.1;
  const parcelLineOpacity = theme === 'dark' ? 0.38 : 0.28;
  const parcelLineWidth = theme === 'dark' ? 0.52 : 0.46;
  const parcelLabelHaloColor = theme === 'dark' ? 'rgba(0, 0, 0, 0.82)' : 'rgba(255, 255, 255, 0.92)';
  const lottieSrc = useMemo(
    () => (theme === 'dark' ? '/loading/white.json' : '/loading/black.json'),
    [theme]
  );

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
        previous.featureCount === state.featureCount &&
        previous.visibleFeatureCount === state.visibleFeatureCount &&
        previous.zoomLevel === state.zoomLevel
      ) {
        return previous;
      }
      return state;
    });
  }, []);

  const visibleAddresses = useMemo(
    () =>
      addresses.filter((address) => !optimisticallyDeletedAddressIds.includes(address.id)),
    [addresses, optimisticallyDeletedAddressIds]
  );
  const bundleAddresses = useMemo(
    () => mapBundleAddressesToCampaignAddresses(campaignId, mapBundle?.addresses),
    [campaignId, mapBundle?.addresses]
  );
  const mapAddresses = visibleAddresses.length > 0 ? visibleAddresses : bundleAddresses;
  const visibleAddressesRef = useRef(visibleAddresses);
  const mapProvisionRefreshKey = [
    campaign?.provision_status ?? '',
    campaign?.provision_phase ?? '',
    campaign?.map_mode ?? '',
    campaign?.map_ready_at ?? '',
    campaign?.optimized_at ?? '',
    mapAddresses.length,
  ].join(':');
  const lastMapProvisionRefreshKeyRef = useRef<string | null>(null);

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
        new Set(
          buildingIds
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
        )
      );
      const normalizedAddressIds = Array.from(
        new Set(
          addressIds
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
        )
      );

      if (normalizedBuildingIds.length > 0) {
        setOptimisticallyHiddenBuildingIds((prev) =>
          Array.from(new Set([...prev, ...normalizedBuildingIds]))
        );
      }

      if (normalizedAddressIds.length > 0) {
        setOptimisticallyDeletedAddressIds((prev) =>
          Array.from(new Set([...prev, ...normalizedAddressIds]))
        );
      }

      if (normalizedBuildingIds.length > 0 || normalizedAddressIds.length > 0) {
        setMapRefreshKey((prev) => prev + 1);
      }
    },
    []
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
    setParcels([]);
    setMapBundle(null);
    setParcelFetchSuppressed(false);
    parcelFetchFailureCountRef.current = 0;
  }, [campaignId, resolvedInitialMapViewMode]);

  useEffect(() => {
    if (!campaignId) {
      setMapBundle(null);
      return;
    }

    let cancelled = false;

    const loadMapBundle = async () => {
      try {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/map-bundle`, {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Campaign map bundle request failed with status ${response.status}`);
        }

        const bundle = await response.json() as CampaignMapBundle;
        if (cancelled) return;

        setMapBundle(bundle);

        if (SHOW_PARCEL_VIEW) {
          const parcelRows = mapBundleParcelsToCampaignParcels(campaignId, bundle.parcels);
          if (parcelRows.length > 0) {
            parcelFetchFailureCountRef.current = 0;
            setParcels(parcelRows);
            setParcelFetchSuppressed(true);
          }
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
  }, [campaignId, mapProvisionRefreshKey, parcelsProcessing]);

  useEffect(() => {
    if ((!SHOW_PARCEL_VIEW || !parcelsReady) && mapViewMode === 'parcels') {
      setMapViewMode('buildings');
    }
  }, [mapViewMode, parcelsReady]);

  useEffect(() => {
    setPmtilesParcelsReady(false);
  }, [campaignId]);

  // Fetch parcels for this campaign
  useEffect(() => {
    if (!SHOW_PARCEL_VIEW || !campaignId || parcelFetchSuppressed) return;

    let cancelled = false;
    const maxParcelFetchFailures = 3;

    const fetchParcels = async () => {
      const supabase = createClient();
      try {
        const dbParcels = await fetchAllInPages<CampaignParcel>((from, to) =>
          supabase
            .from('campaign_parcels')
            .select('*')
            .eq('campaign_id', campaignId)
            .order('id', { ascending: true })
            .range(from, to) as unknown as Promise<{ data: CampaignParcel[] | null; error: PostgrestError | null }>
        );

        let data: CampaignParcel[];
        if (dbParcels.length > 0) {
          parcelFetchFailureCountRef.current = 0;
          data = dbParcels;
        } else {
          const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/parcels`, {
            credentials: 'include',
          });
          if (!response.ok) {
            const nextFailureCount = parcelFetchFailureCountRef.current + 1;
            parcelFetchFailureCountRef.current = nextFailureCount;

            if (nextFailureCount >= maxParcelFetchFailures) {
              console.warn('Disabling campaign parcel API retries after repeated failures', {
                campaignId,
                status: response.status,
                failures: nextFailureCount,
              });
              if (!cancelled) {
                setParcelFetchSuppressed(true);
                setParcels([]);
              }
            }

            throw new Error(`Campaign parcels request failed with status ${response.status}`);
          }

          if (response.headers.get('X-FLYR-Parcels-Suppressed')) {
            setParcelFetchSuppressed(true);
          }

          parcelFetchFailureCountRef.current = 0;
          const payload = await response.json() as unknown;
          data = Array.isArray(payload) ? payload as CampaignParcel[] : [];
        }

        if (!cancelled) {
          setParcels(data);
        }
      } catch (error) {
        console.error('Failed to fetch campaign parcels:', error);
        if (!cancelled) {
          setParcels([]);
        }
      }
    };

    void fetchParcels();

    if (parcelsProcessing) {
      const interval = setInterval(() => {
        void fetchParcels();
      }, 5000);

      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [campaignId, parcelFetchSuppressed, parcelsProcessing]);

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
    buildingDeleteId?: string | null
  ) => {
    console.log('Map target clicked:', { locationCardId, addressId, parcelId, buildingDeleteId });
    setSelectedBuildingId(locationCardId);
    setSelectedBuildingDeleteId(buildingDeleteId ?? null);
    setSelectedAddressIdForCard(addressId || null);
    setSelectedParcelId(parcelId ?? null);
    setLocationCardOpen(true);
  };

  const handleMapTargetClick = useCallback((
    target: {
      buildingId?: string | null;
      addressId?: string | null;
      parcelId?: string | null;
    },
    options?: {
      additive?: boolean;
    }
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
      openLocationCard(
        buildingId ?? addressId ?? '',
        addressId ?? undefined,
        parcelId,
        buildingId ?? null
      );
    }
  }, [toggleMultiSelection]);

  const handleBuildingClick = (
    buildingId: string,
    addressId?: string,
    options?: {
      additive?: boolean;
    }
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
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  type AuthRequestOptions = RequestInit & {
    ignoreStatuses?: number[];
  };

  const requestWithAuth = useCallback(async (url: string, init?: AuthRequestOptions) => {
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
  }, [getAccessToken]);

  const deleteJsonWithAuth = useCallback(async (url: string, options?: { allowMissing?: boolean }) => {
    const response = await requestWithAuth(url, {
      method: 'DELETE',
      ignoreStatuses: options?.allowMissing ? [404] : undefined,
    });
    if (response.status === 404) {
      return null;
    }
    return response.json().catch(() => null);
  }, [requestWithAuth]);

  const handleDeleteSelectedLocation = useCallback(async () => {
    const addressId = selectedAddressIdForCard;
    const buildingId = selectedBuildingDeleteId;
    const parcelId = selectedParcelId;

    if (!addressId && !buildingId && !parcelId) return;
    if (!window.confirm('Delete this location from the campaign? Any linked address, building, and parcel shown here will be removed.')) {
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
        multiSelectedTargets
          .map((target) => target.buildingId)
          .filter((value): value is string => Boolean(value))
      )
    );

    if (!window.confirm(`Delete ${multiSelectedTargets.length} selected house${multiSelectedTargets.length === 1 ? '' : 's'}?`)) {
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
        ])
      );

      for (const addressId of uniqueAddressIds) {
        const result = await deleteJsonWithAuth(`/api/campaigns/${campaignId}/addresses/${addressId}`, { allowMissing: true });
        if (typeof result?.address_id === 'string') {
          deletedAddressIds.push(result.address_id);
        }
      }

      for (const buildingId of uniqueBuildingIds) {
        const result = await deleteJsonWithAuth(`/api/campaigns/${campaignId}/buildings/${buildingId}`, { allowMissing: true });
        if (typeof result?.building_id === 'string') {
          deletedBuildingIds.push(result.building_id);
        }
        if (Array.isArray(result?.deleted_address_ids)) {
          deletedAddressIds.push(
            ...result.deleted_address_ids.filter((value: unknown): value is string => typeof value === 'string')
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
  }, [campaignId, deleteJsonWithAuth, handleCloseLocationCard, multiSelectedTargets, router, applyOptimisticMapDeletion]);

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
  };

  useEffect(() => {
    if (map.current || initAttemptedRef.current) return;
    let cancelled = false;
    let retryFrameId: number | null = null;
    let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
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
        });
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
        setFlyrMapInitDebug({ stage: 'map_loaded' });
        setMapLoaded(true);
        
        // Clean up problematic layers and hide building layers
        const cleanupLayers = () => {
          if (!map.current) return;
          
          try {
            const style = map.current.getStyle();
            if (style && style.layers) {
              applyPresetVisualTweaks(map.current, resolvedMapStyle, {
                preserveLayerPrefixes: ['map-buildings-', 'campaign-', 'route-', 'assigned-routes-', 'flyr-', 'gl-draw-'],
              });
              hideBaseBuildingLayers(map.current, {
                preserveLayerPrefixes: CUSTOM_BUILDING_LAYER_PREFIXES,
              });
              hideResidentialOnlyBaseExtras(map.current);
              style.layers.forEach((layer) => {
                // Remove layers that reference non-existent source layers
                if (layer.id && (
                  layer.id.includes('road-label') || 
                  layer.id.includes('road_label')
                )) {
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
        const isSourceLayerError = errorMessage.includes('does not exist on source') || 
                                   errorMessage.includes('Source layer');
        
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
                    if (layer.id && (
                      layer.id.includes('road-label') || 
                      layer.id.includes('road_label')
                    )) {
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
        .map(addr => getAddressCoordinate(addr))
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
          });

          map.current.once('moveend', () => {
            if (!map.current) return;
            if (map.current.getZoom() < 12) {
              map.current.easeTo({
                zoom: 12,
                duration: 300,
              });
            }
          });
        }, 200);
      }
    }
    // Buildings are handled by MapBuildingsLayer component which provides fill extrusions.
  }, [campaign?.bbox, campaign?.territory_boundary, mapLoaded, mapViewMode, mapAddresses]);

  const preparedAddressPoints = useMemo<PreparedAddressPoint[]>(() => {
    return mapAddresses
      .map((address) => {
        const coordinate = getAddressCoordinate(address);
        if (!coordinate) return null;
        const linkedBuildingId =
          (address as CampaignAddress & { building_id?: unknown }).building_id ??
          address.gers_id;

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

  const parcelStatusByExternalId = useMemo<Record<string, MapStatusKey>>(() => {
    const statusByExternalId: Record<string, MapStatusKey> = {};

    for (const parcel of parcels) {
      const externalId = getCampaignParcelExternalId(parcel);
      if (!externalId) continue;

      let geom: unknown = parcel.geom;
      if (typeof geom === 'string') {
        try {
          geom = JSON.parse(geom);
        } catch {
          continue;
        }
      }
      if (
        !geom ||
        typeof geom !== 'object' ||
        !['Polygon', 'MultiPolygon'].includes((geom as { type?: string }).type ?? '')
      ) {
        continue;
      }

      const parcelFeature = turf.feature(geom as GeoJSON.Polygon | GeoJSON.MultiPolygon);
      const statuses = new Set<MapStatusKey>();
      for (const addressPoint of preparedAddressPoints) {
        const point = turf.point([addressPoint.lon, addressPoint.lat]);
        if (turf.booleanPointInPolygon(point, parcelFeature)) {
          statuses.add(addressPoint.statusKey);
        }
      }

      statusByExternalId[externalId] = MAP_STATUS_PRIORITY.find((key) => statuses.has(key)) ?? 'UNTOUCHED';
    }

    return statusByExternalId;
  }, [parcels, preparedAddressPoints]);

  const pointOverlaySourceId = 'campaign-point-overlays';
  const pointOverlayCircleLayerId = 'campaign-point-overlays-circle';
  const pointOverlayLabelLayerId = 'campaign-point-overlays-label';

  useEffect(() => {
    const mapInstance = map.current;
    if (!mapInstance || !mapLoaded) return;

    const buildPointOverlayGeoJSON = (): GeoJSON.FeatureCollection<GeoJSON.Point> | null => {
      const visiblePointOverlays = mapViewMode === 'parcels' ? [] : pointOverlays;
      const features: GeoJSON.Feature<GeoJSON.Point>[] = visiblePointOverlays
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
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['coalesce', ['get', 'count'], 1],
                1,
                8,
                5,
                12,
              ],
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
          { buildingId: buildingId ?? null, addressId: addressId ?? null, parcelId: null },
          {
            additive: Boolean((event.originalEvent as MouseEvent | undefined)?.metaKey || (event.originalEvent as MouseEvent | undefined)?.ctrlKey),
          }
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

    if (mapViewMode === 'parcels' || pointOverlays.length === 0) {
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
          hideResidentialOnlyBaseExtras(map.current);
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

    map.current.once('style.load', () => {
      cleanupLayers();
    });
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
      [BOUNDARY_LAYER_RAW_FILL, BOUNDARY_LAYER_RAW_LINE, BOUNDARY_LAYER_SNAPPED_FILL, BOUNDARY_LAYER_SNAPPED_LINE].forEach((id) => {
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
        m.addSource(BOUNDARY_SOURCE_RAW, { type: 'geojson', data: polyToFeature(raw!) });
        m.addSource(BOUNDARY_SOURCE_SNAPPED, { type: 'geojson', data: polyToFeature(snapped!) });
        m.addLayer({ id: BOUNDARY_LAYER_RAW_FILL, type: 'fill', source: BOUNDARY_SOURCE_RAW, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.08 } });
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
        m.addLayer({ id: BOUNDARY_LAYER_SNAPPED_FILL, type: 'fill', source: BOUNDARY_SOURCE_SNAPPED, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 } });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 1 },
        });
      } else {
        m.addSource(BOUNDARY_SOURCE_SNAPPED, { type: 'geojson', data: polyToFeature(boundary) });
        m.addLayer({ id: BOUNDARY_LAYER_SNAPPED_FILL, type: 'fill', source: BOUNDARY_SOURCE_SNAPPED, paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.15 } });
        m.addLayer({
          id: BOUNDARY_LAYER_SNAPPED_LINE,
          type: 'line',
          source: BOUNDARY_SOURCE_SNAPPED,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 1 },
        });
      }
    };

    removeBoundaryLayers();
    addBoundaryLayers();

    return () => {
      removeBoundaryLayers();
    };
  }, [mapLoaded, campaign?.id, campaign?.territory_boundary, campaign?.campaign_polygon_raw, campaign?.campaign_polygon_snapped, campaign?.address_source]);

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
        parcelStrokeColor,
      ] as mapboxgl.Expression;
    };

    const getParcelFillOpacityExpression = (): mapboxgl.Expression => {
      const status = ['get', 'status_key'];
      return [
        'case',
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

      for (const parcel of parcels) {
        const geom = typeof parcel.geom === 'string'
          ? JSON.parse(parcel.geom)
          : parcel.geom;
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
        const primaryTarget = getPrimaryParcelTarget(addressesInParcel);

        parcelFeatures.push({
          type: 'Feature',
          geometry: geom as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          properties: {
            external_id: parcel.external_id ?? null,
            parcel_row_id: parcel.id,
            address_id: primaryTarget?.addressId ?? null,
            building_id: primaryTarget?.buildingId ?? null,
            label: parcelLabel,
            feature_type: parcel.properties?.FEATURE_TYPE || parcel.properties?.feature_type || 'COMMON',
            status_key: statusKey,
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
            'line-color': getParcelFillColorExpression(),
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              12,
              0.12,
              14,
              0.18,
              16,
              0.28,
              18,
              parcelLineWidth,
            ],
            'line-opacity': parcelLineOpacity,
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
      } catch (err) {
        console.error('Error adding parcels layer:', err);
      }
    };

    const onParcelClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      const parcelRowId = feature.properties.parcel_row_id as string | undefined;
      const addressId = feature.properties.address_id as string | undefined;
      const buildingId = feature.properties.building_id as string | undefined;
      if (parcelRowId || buildingId || addressId) {
        handleMapTargetClick(
          {
            buildingId: buildingId ?? null,
            addressId: addressId ?? null,
            parcelId: parcelRowId ?? null,
          },
          {
            additive: Boolean((event.originalEvent as MouseEvent | undefined)?.metaKey || (event.originalEvent as MouseEvent | undefined)?.ctrlKey),
          }
        );
      }
    };

    // Use a map-level click handler so Mapbox does not run layer-scoped
    // queryRenderedFeatures internally during style transitions.
    const onParcelMapClick = (e: mapboxgl.MapMouseEvent) => {
      try {
        if (!m.isStyleLoaded() || !m.getLayer(PARCEL_FILL_LAYER)) return;
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
    showGeojsonParcels,
    parcels,
    preparedAddressPoints,
    statusFilters,
    parcelStrokeColor,
    parcelFillOpacity,
    parcelLineOpacity,
    parcelLineWidth,
    parcelLabelHaloColor,
    handleMapTargetClick,
  ]);

  const handleSnapToRoads = async () => {
    setSnapping(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/snap`, { method: 'POST', credentials: 'include' });
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
    (buildingsRenderState.isFetching ||
      (buildingsRenderState.hasData &&
        buildingsRenderState.zoomLevel >= 12 &&
        !buildingsRenderState.hasBuildingPolygons));
  const campaignBbox = Array.isArray(campaign?.bbox) &&
    campaign.bbox.length === 4 &&
    campaign.bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? (campaign.bbox as [number, number, number, number])
    : null;

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

  return (
    <div
      ref={mapShellRef}
      className={`relative h-full w-full ${isMapFullscreen ? 'bg-background' : ''}`}
    >
      <div ref={mapContainer} className="h-full w-full" />
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
                    {multiSelectedTargets.length} house{multiSelectedTargets.length === 1 ? '' : 's'} selected with Command-click.
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
                  {multiSelectedTargets.length} house{multiSelectedTargets.length === 1 ? '' : 's'} selected
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Open Tools to delete or clear selection
                </p>
              </div>
            </div>
          ) : null}
          {/* View switcher: Buildings | Addresses | Parcels */}
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
                    onClick={() => setMapViewMode('parcels')}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      mapViewMode === 'parcels'
                        ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    title={
                      pmtilesParcelsReady
                        ? 'Parcel PMTiles from Diamond S3'
                        : `${parcels.length} parcel${parcels.length !== 1 ? 's' : ''} in campaign polygon`
                    }
                  >
                    Parcels
                    {!pmtilesParcelsReady ? (
                      <span className="ml-1 text-xs opacity-60">
                        ({parcels.length})
                      </span>
                    ) : null}
                  </button>
                ) : null}
              </div>
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
          </div>
          {showBuildingPendingOverlay && buildingPendingOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-lg border border-border bg-background/92 p-4 shadow-lg backdrop-blur-sm">
                <div className="flex items-center gap-4">
                  <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                    {loadingAnimationData ? (
                      <Lottie
                        animationData={loadingAnimationData}
                        loop
                        className="h-full w-full"
                        rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                      />
                    ) : (
                      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {buildingPendingOverlay.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {buildingPendingOverlay.description}
                    </p>
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
              addressStateOverrides={mapAddresses}
              hiddenBuildingIds={optimisticallyHiddenBuildingIds}
              deletedAddressIds={optimisticallyDeletedAddressIds}
              campaignBoundary={(campaign?.territory_boundary as GeoJSON.Polygon | null | undefined) ?? null}
              campaignBbox={campaignBbox}
              buildingFeatures={mapBundle?.buildings ?? null}
              statusFilters={statusFilters}
              showAddressLabels={false}
              footprintStatusColors={false}
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
            onAddressClick={(addressId, buildingId, options) => {
              handleMapTargetClick({ buildingId, addressId, parcelId: null }, options);
            }}
          />
          <CampaignParcelPmtilesLayer
            map={map.current}
            campaignId={campaignId}
            mapLoaded={mapLoaded}
            visible={SHOW_PARCEL_VIEW && mapViewMode === 'parcels' && pmtilesParcelsReady && parcels.length === 0}
            parcels={parcels}
            parcelStatusByExternalId={parcelStatusByExternalId}
            statusFilters={statusFilters}
            campaignBoundary={(campaign?.territory_boundary as GeoJSON.Polygon | null | undefined) ?? null}
            campaignBbox={campaignBbox}
            styleKey={resolvedMapStyle.key}
            onParcelClick={(parcelId, options) => {
              handleMapTargetClick({ buildingId: null, addressId: null, parcelId }, options);
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
          portalContainer={mapShellRef.current}
          initialAddress={selectedAddressText}
          initialAddressId={selectedAddressId}
          initialCampaignId={campaignId}
          initialNotes={selectedContactNotes}
        />
      )}
    </div>
  );
}
