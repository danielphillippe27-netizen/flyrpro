'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import {
  appendTileAccessToken,
  fetchCampaignMapManifest,
  hasRenderablePmtilesParcels,
  type CampaignMapManifest,
} from '@/lib/map/campaignMapManifest';
import {
  DEFAULT_STATUS_FILTERS,
  MAP_STATUS_CONFIG,
  MAP_STATUS_PRIORITY,
  type MapStatusKey,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import type { ParcelClickPayload } from '@/lib/map/parcelClickResolution';

type ManifestParcelSource = {
  deliveryMode: 'backend_zxy';
  url: string;
  sourceLayer: string;
  promoteId: string;
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
};

type CampaignParcelPmtilesLayerProps = {
  map: mapboxgl.Map;
  campaignId: string | null | undefined;
  mapLoaded: boolean;
  visible: boolean;
  parcels?: Array<{
    id: string;
    external_id?: string | null;
    properties?: Record<string, unknown> | null;
  }>;
  parcelStatusByExternalId?: Record<string, MapStatusKey>;
  selectedParcelIds?: string[];
  statusFilters?: StatusFilters;
  campaignBoundary?: GeoJSON.Polygon | null;
  campaignBbox?: [number, number, number, number] | null;
  styleKey?: string;
  onParcelClick?: (
    payload: ParcelClickPayload,
    options?: {
      additive?: boolean;
    }
  ) => void;
};

const SOURCE_ID = 'campaign-parcels-pmtiles-source';
const FILL_LAYER_ID = 'campaign-parcels-pmtiles-fill';
const LINE_LAYER_ID = 'campaign-parcels-pmtiles-line';
const SELECTED_PARCEL_COLOR = '#60a5fa';
const PARCEL_ID_PROPERTY_NAMES = [
  'parcel_id',
  'external_id',
  'PARCELID',
  'gisid',
  'roll_number',
  'id',
];
const PARCEL_DEFAULT_COLOR = MAP_STATUS_CONFIG.UNTOUCHED.color;
const PARCEL_ID_EXPRESSION: mapboxgl.Expression = [
  'to-string',
  [
    'coalesce',
    ...PARCEL_ID_PROPERTY_NAMES.map((propertyName) => ['get', propertyName]),
    '',
  ],
];

function safeRemoveLayer(map: mapboxgl.Map, layerId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    // Ignore transient style teardown errors.
  }
}

function safeRemoveSource(map: mapboxgl.Map, sourceId: string) {
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    // Ignore transient style teardown errors.
  }
}

function cleanupParcelLayers(map: mapboxgl.Map) {
  safeRemoveLayer(map, LINE_LAYER_ID);
  safeRemoveLayer(map, FILL_LAYER_ID);
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

function combineMapFilters(
  ...filters: Array<mapboxgl.FilterSpecification | undefined | null>
): mapboxgl.FilterSpecification {
  const activeFilters = filters.filter(Boolean) as mapboxgl.FilterSpecification[];
  if (activeFilters.length === 0) return ['all'];
  if (activeFilters.length === 1) return activeFilters[0];
  return ['all', ...activeFilters] as mapboxgl.FilterSpecification;
}

function toManifestParcelSource(
  manifest: CampaignMapManifest,
  accessToken: string | null
): ManifestParcelSource | null {
  const layer = manifest.layers?.parcels;
  const sourceLayer = layer?.sourceLayer ?? manifest.parcel_source_layer ?? manifest.source_layers?.parcels ?? null;
  if (!sourceLayer) return null;

  const baseSource = {
    sourceLayer,
    promoteId: layer?.promoteId ?? manifest.parcel_promote_id ?? manifest.promote_ids?.parcels ?? 'parcel_id',
    minzoom: layer?.minzoom ?? manifest.parcel_minzoom ?? 10,
    maxzoom: layer?.maxzoom ?? manifest.parcel_maxzoom ?? 16,
    bounds: layer?.bounds ?? manifest.parcel_bounds ?? manifest.bounds ?? undefined,
  };

  const vectorTileUrlTemplate = layer?.vectorTileUrlTemplate ?? manifest.parcel_vector_tile_url_template;
  if (vectorTileUrlTemplate) {
    return {
      ...baseSource,
      deliveryMode: 'backend_zxy',
      url: appendTileAccessToken(vectorTileUrlTemplate, accessToken),
    };
  }

  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    return normalized || null;
  }

  return null;
}

function getParcelExternalId(parcel: NonNullable<CampaignParcelPmtilesLayerProps['parcels']>[number]): string | null {
  const directId = stringValue(parcel.external_id);
  if (directId) return directId;

  for (const propertyName of PARCEL_ID_PROPERTY_NAMES) {
    const propertyId = stringValue(parcel.properties?.[propertyName]);
    if (propertyId) return propertyId;
  }

  return null;
}

function getFeatureParcelExternalId(properties: Record<string, unknown>): string | null {
  for (const propertyName of PARCEL_ID_PROPERTY_NAMES) {
    const propertyId = stringValue(properties[propertyName]);
    if (propertyId) return propertyId;
  }

  return null;
}

function getFeatureId(feature: mapboxgl.MapboxGeoJSONFeature | undefined): string | number | null {
  const id = feature?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function buildParcelScopeFilter(
  parcelExternalIds: string[],
  campaignBoundary?: GeoJSON.Polygon | null,
  campaignBbox?: [number, number, number, number] | null
): mapboxgl.FilterSpecification | null {
  const geometryFilter: mapboxgl.FilterSpecification = ['==', ['geometry-type'], 'Polygon'];

  if (campaignBbox) {
    return combineMapFilters(
      geometryFilter,
      ['within', bboxToPolygon(campaignBbox)] as mapboxgl.FilterSpecification
    );
  }

  if (parcelExternalIds.length > 0) {
    return combineMapFilters(
      geometryFilter,
      ['in', PARCEL_ID_EXPRESSION, ['literal', parcelExternalIds]] as mapboxgl.FilterSpecification
    );
  }

  const fallbackBoundary = campaignBoundary ?? null;
  if (fallbackBoundary) {
    return combineMapFilters(
      geometryFilter,
      ['within', fallbackBoundary] as mapboxgl.FilterSpecification
    );
  }

  return geometryFilter;
}

function bboxToPolygon([west, south, east, north]: [number, number, number, number]): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function buildParcelColorExpression(
  parcelStatusByExternalId: Record<string, MapStatusKey>,
  statusFilters: StatusFilters
): mapboxgl.Expression {
  const idExpression = [
    'to-string',
    [
      'coalesce',
      ...PARCEL_ID_PROPERTY_NAMES.map((propertyName) => ['get', propertyName]),
    ],
  ];
  const caseExpression: unknown[] = ['case'];

  for (const statusKey of MAP_STATUS_PRIORITY) {
    if (!statusFilters[statusKey]) continue;
    const externalIds = Object.entries(parcelStatusByExternalId)
      .filter(([, parcelStatusKey]) => parcelStatusKey === statusKey)
      .map(([externalId]) => externalId);

    if (externalIds.length === 0) continue;
    caseExpression.push(
      ['match', idExpression, externalIds, true, false],
      MAP_STATUS_CONFIG[statusKey].color
    );
  }

  caseExpression.push(PARCEL_DEFAULT_COLOR);
  return caseExpression as mapboxgl.Expression;
}

function buildSelectedParcelExpression(selectedParcelIds: string[]): mapboxgl.Expression {
  const normalizedIds = selectedParcelIds
    .map((parcelId) => parcelId.trim())
    .filter(Boolean);

  if (normalizedIds.length === 0) return false as unknown as mapboxgl.Expression;

  return [
    'match',
    PARCEL_ID_EXPRESSION,
    normalizedIds,
    true,
    false,
  ] as mapboxgl.Expression;
}

export function CampaignParcelPmtilesLayer({
  map,
  campaignId,
  mapLoaded,
  visible,
  parcels = [],
  parcelStatusByExternalId = {},
  selectedParcelIds = [],
  statusFilters = DEFAULT_STATUS_FILTERS,
  campaignBoundary,
  campaignBbox,
  styleKey,
  onParcelClick,
}: CampaignParcelPmtilesLayerProps) {
  const [manifestSource, setManifestSource] = useState<ManifestParcelSource | null>(null);
  const onParcelClickRef = useRef(onParcelClick);
  const parcelScope = useMemo(
    () => parcels.reduce<{
      externalIds: string[];
      rowIdByExternalId: Map<string, string>;
    }>((scope, parcel) => {
      const externalId = getParcelExternalId(parcel);
      if (!externalId) return scope;
      if (!scope.rowIdByExternalId.has(externalId)) {
        scope.externalIds.push(externalId);
        scope.rowIdByExternalId.set(externalId, parcel.id);
      }
      return scope;
    }, { externalIds: [], rowIdByExternalId: new Map<string, string>() }),
    [parcels]
  );

  useEffect(() => {
    onParcelClickRef.current = onParcelClick;
  }, [onParcelClick]);

  useEffect(() => {
    let cancelled = false;

    const loadManifest = async () => {
      if (!campaignId || !visible) {
        setManifestSource(null);
        return;
      }

      const { manifest, accessToken } = await fetchCampaignMapManifest(campaignId);
      if (cancelled) return;

      if (!hasRenderablePmtilesParcels(manifest)) {
        setManifestSource(null);
        return;
      }

      setManifestSource(toManifestParcelSource(manifest!, accessToken));
    };

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [campaignId, visible]);

  useEffect(() => {
    if (!map || !mapLoaded || !visible || !manifestSource) {
      cleanupParcelLayers(map);
      return;
    }

    const hasExpectedParcelLayers = () =>
      Boolean(map.getSource(SOURCE_ID) && map.getLayer(FILL_LAYER_ID) && map.getLayer(LINE_LAYER_ID));

    const scopeFilter = buildParcelScopeFilter(parcelScope.externalIds, campaignBoundary, campaignBbox);
    const parcelColorExpression = buildParcelColorExpression(parcelStatusByExternalId, statusFilters);
    const selectedParcelExpression = buildSelectedParcelExpression(selectedParcelIds);
    if (!scopeFilter) {
      cleanupParcelLayers(map);
      return;
    }

    const addLayers = () => {
      if (!canAddCustomMapLayers(map)) return;
      cleanupParcelLayers(map);

      const vectorSource: mapboxgl.VectorSourceSpecification & {
        buffer?: number;
        promoteId?: Record<string, string>;
      } = {
        type: 'vector',
        minzoom: manifestSource.minzoom,
        maxzoom: manifestSource.maxzoom,
        buffer: 128,
        promoteId: {
          [manifestSource.sourceLayer]: manifestSource.promoteId,
        },
      };
      vectorSource.tiles = [manifestSource.url];
      if (manifestSource.bounds) vectorSource.bounds = manifestSource.bounds;

      map.addSource(SOURCE_ID, vectorSource);
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        'source-layer': manifestSource.sourceLayer,
        minzoom: manifestSource.minzoom,
        filter: scopeFilter,
        paint: {
          'fill-color': parcelColorExpression,
          'fill-opacity': [
            'case',
            selectedParcelExpression,
            ['interpolate', ['linear'], ['zoom'], 10, 0.22, 14, 0.3, 18, 0.42],
            ['interpolate', ['linear'], ['zoom'], 10, 0.14, 14, 0.2, 18, 0.3],
          ],
        },
      });

      map.addLayer({
        id: LINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        'source-layer': manifestSource.sourceLayer,
        minzoom: manifestSource.minzoom,
        filter: scopeFilter,
        paint: {
          'line-color': [
            'case',
            selectedParcelExpression,
            SELECTED_PARCEL_COLOR,
            '#e5e7eb',
          ],
          'line-width': [
            'case',
            selectedParcelExpression,
            ['interpolate', ['linear'], ['zoom'], 10, 0.9, 14, 1.5, 18, 2.6],
            ['interpolate', ['linear'], ['zoom'], 10, 0.15, 14, 0.3, 18, 0.75],
          ],
          'line-opacity': [
            'case',
            selectedParcelExpression,
            1,
            ['interpolate', ['linear'], ['zoom'], 10, 0.55, 14, 0.75, 18, 0.95],
          ],
        },
      });

      const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const props = feature?.properties ?? {};
        const externalParcelId = getFeatureParcelExternalId(props);
        const parcelId = externalParcelId ? parcelScope.rowIdByExternalId.get(externalParcelId) ?? externalParcelId : '';
        if (!parcelId) return;
        const originalEvent = event.originalEvent as MouseEvent | undefined;
        onParcelClickRef.current?.({
          parcelId,
          externalParcelId,
          featureId: getFeatureId(feature),
          properties: props,
          lngLat: event.lngLat,
        }, {
          additive: Boolean(originalEvent?.metaKey || originalEvent?.ctrlKey),
        });
      };
      const enterHandler = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const leaveHandler = () => {
        map.getCanvas().style.cursor = '';
      };

      map.on('click', FILL_LAYER_ID, clickHandler);
      map.on('mouseenter', FILL_LAYER_ID, enterHandler);
      map.on('mouseleave', FILL_LAYER_ID, leaveHandler);

      return () => {
        map.off('click', FILL_LAYER_ID, clickHandler);
        map.off('mouseenter', FILL_LAYER_ID, enterHandler);
        map.off('mouseleave', FILL_LAYER_ID, leaveHandler);
      };
    };

    let cleanupHandlers: (() => void) | undefined;
    let cancelled = false;
    let retryIntervalId: number | undefined;
    const clearRetry = () => {
      map.off('style.load', tryAddParcelLayers);
      map.off('styledata', tryAddParcelLayers);
      map.off('load', tryAddParcelLayers);
      map.off('idle', tryAddParcelLayers);
      if (retryIntervalId !== undefined) {
        window.clearInterval(retryIntervalId);
        retryIntervalId = undefined;
      }
    };
    const tryAddParcelLayers = () => {
      if (cancelled) return;
      if (hasExpectedParcelLayers()) {
        clearRetry();
        return;
      }
      if (cleanupHandlers || !canAddCustomMapLayers(map)) return;
      try {
        cleanupHandlers = addLayers();
        if (cleanupHandlers && hasExpectedParcelLayers()) clearRetry();
      } catch (error) {
        cleanupHandlers?.();
        cleanupHandlers = undefined;
        cleanupParcelLayers(map);
        console.warn('[CampaignParcelPmtilesLayer] Custom parcel layer attach deferred:', error);
      }
    };

    tryAddParcelLayers();
    if (!cleanupHandlers) {
      map.on('style.load', tryAddParcelLayers);
      map.on('styledata', tryAddParcelLayers);
      map.on('load', tryAddParcelLayers);
      map.on('idle', tryAddParcelLayers);
      retryIntervalId = window.setInterval(tryAddParcelLayers, 150);
    }

    return () => {
      cancelled = true;
      clearRetry();
      cleanupHandlers?.();
      cleanupParcelLayers(map);
    };
  }, [
    map,
    mapLoaded,
    visible,
    manifestSource,
    styleKey,
    campaignBoundary,
    campaignBbox,
    parcelScope.externalIds,
    parcelScope.rowIdByExternalId,
    parcelStatusByExternalId,
    selectedParcelIds,
    statusFilters,
  ]);

  return null;
}
