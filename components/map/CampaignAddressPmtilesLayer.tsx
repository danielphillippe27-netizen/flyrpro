'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { CampaignAddress, CampaignType } from '@/types/database';
import { getCampaignAddressMapStatus } from '@/lib/campaignStats';
import { DEFAULT_STATUS_FILTERS, FLYER_MODE_STATUS_COLORS, MAP_STATUS_CONFIG, type StatusFilters } from '@/lib/constants/mapStatus';
import {
  appendTileAccessToken,
  fetchCampaignMapManifest,
  hasDirectWebPmtiles,
  hasRenderablePmtilesAddresses,
  toPmtilesProtocolUrl,
  type CampaignMapManifest,
} from '@/lib/map/campaignMapManifest';
import { ensurePmtilesProtocolRegistered } from '@/lib/map/pmtilesProtocol';

type ManifestSource = {
  deliveryMode: 'pmtiles_protocol' | 'static_zxy_cdn' | 'backend_zxy';
  url: string;
  sourceLayer: string;
  sourceGeometry: 'polygon' | 'point';
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
const ADDRESS_CYLINDER_HEIGHT_METERS = 8;
const ADDRESS_LABEL_CAP_CLEARANCE_METERS = 0.08;

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

function toManifestSource(manifest: CampaignMapManifest, accessToken: string | null): ManifestSource | null {
  const sourceLayer = manifest.source_layers?.address_circles ?? manifest.source_layers?.addresses;
  if (!sourceLayer) return null;
  const sourceGeometry = manifest.source_layers?.address_circles ? 'polygon' : 'point';
  const promoteId =
    sourceGeometry === 'polygon'
      ? manifest.promote_ids?.address_circles ?? manifest.promote_ids?.addresses ?? 'address_id'
      : manifest.promote_ids?.addresses ?? 'address_id';

  if (hasDirectWebPmtiles(manifest) && manifest.pmtiles_url) {
    const pmtilesUrl = toPmtilesProtocolUrl(manifest.pmtiles_url);
    if (pmtilesUrl && ensurePmtilesProtocolRegistered()) {
      return {
        deliveryMode: 'pmtiles_protocol',
        url: pmtilesUrl,
        sourceLayer,
        sourceGeometry,
        promoteId,
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
      sourceGeometry,
      promoteId,
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
    sourceGeometry,
    promoteId,
    minzoom: manifest.minzoom ?? 13,
    maxzoom: manifest.maxzoom ?? 18,
    bounds: manifest.bounds ?? undefined,
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

export function CampaignAddressPmtilesLayer({
  map,
  campaignId,
  mapLoaded,
  visible,
  addresses,
  campaignType,
  statusFilters = DEFAULT_STATUS_FILTERS,
  deletedAddressIds = [],
  styleKey,
  onAddressClick,
}: CampaignAddressPmtilesLayerProps) {
  const [manifestSource, setManifestSource] = useState<ManifestSource | null>(null);
  const onAddressClickRef = useRef(onAddressClick);
  const isFlyerMode = campaignType === 'flyer';
  const deletedAddressSet = useMemo(
    () => new Set(deletedAddressIds.map((id) => String(id ?? '').trim()).filter(Boolean)),
    [deletedAddressIds]
  );

  useEffect(() => {
    onAddressClickRef.current = onAddressClick;
  }, [onAddressClick]);

  const getAddressColorExpression = (): mapboxgl.Expression => {
    const getAddressStatus = () => ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none'];
    const getQrScanned = () => ['coalesce', ['feature-state', 'qr_scanned'], ['get', 'qr_scanned'], false];
    const getScansTotal = () => ['coalesce', ['feature-state', 'scans_total'], ['get', 'scans_total'], 0];

    if (isFlyerMode) {
      const isVisited = ['any', ['!=', getAddressStatus(), 'none'], ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
      return ['case', isVisited, FLYER_MODE_STATUS_COLORS.visited, FLYER_MODE_STATUS_COLORS.unvisited] as mapboxgl.Expression;
    }

    const isQrScanned = ['any', ['==', getQrScanned(), true], ['>', getScansTotal(), 0]];
    const isLead = ['in', getAddressStatus(), ['literal', ['lead', 'interested', 'hot_lead']]];
    const isHotLead = ['in', getAddressStatus(), ['literal', ['appointment', 'future_seller']]];
    const isConversation = ['==', getAddressStatus(), 'talked'];
    const isDoNotKnock = ['==', getAddressStatus(), 'do_not_knock'];
    const isNoOneHome = ['in', getAddressStatus(), ['literal', ['no_answer', 'not_home', 'attempted']]];
    const isTouched = ['==', getAddressStatus(), 'delivered'];
    const isUntouched = [
      'all',
      ['!=', getAddressStatus(), 'delivered'],
      ['!=', getAddressStatus(), 'talked'],
      ['!', ['in', getAddressStatus(), ['literal', ['lead', 'interested', 'hot_lead', 'appointment', 'future_seller']]]],
      ['!=', getAddressStatus(), 'do_not_knock'],
      ['!', ['in', getAddressStatus(), ['literal', ['no_answer', 'not_home', 'attempted']]]],
      ['!', isQrScanned],
    ];

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
      MAP_STATUS_CONFIG.UNTOUCHED.color,
      '#6b7280',
    ] as mapboxgl.Expression;
  };

  const getLeadGlowOpacityExpression = (): mapboxgl.Expression => {
    if (isFlyerMode) return ['case', false, 0, 0] as mapboxgl.Expression;
    const getAddressStatus = () => ['coalesce', ['feature-state', 'address_status'], ['get', 'address_status'], 'none'];
    const isLead = ['in', getAddressStatus(), ['literal', ['lead', 'interested', 'hot_lead']]];
    return ['case', ['all', isLead, statusFilters.LEADS], 0.82, 0] as mapboxgl.Expression;
  };

  const getVisibilityFilter = (): mapboxgl.Expression | undefined => {
    if (deletedAddressSet.size === 0) return undefined;
    return ['!', ['in', ['get', 'address_id'], ['literal', Array.from(deletedAddressSet)]]] as mapboxgl.Expression;
  };

  const getLayerFilter = (geometryType: 'Point' | 'Polygon'): mapboxgl.Expression => {
    const visibilityFilter = getVisibilityFilter();
    const geometryFilter = ['==', ['geometry-type'], geometryType] as mapboxgl.Expression;
    return visibilityFilter
      ? ['all', geometryFilter, visibilityFilter] as mapboxgl.Expression
      : geometryFilter;
  };

  useEffect(() => {
    let cancelled = false;

    const loadManifest = async () => {
      if (!campaignId || !visible) {
        setManifestSource(null);
        return;
      }

      const { manifest, accessToken } = await fetchCampaignMapManifest(campaignId);
      if (cancelled) return;

      if (!hasRenderablePmtilesAddresses(manifest)) {
        console.warn('[CampaignAddressPmtilesLayer] PMTiles address layer unavailable.');
        setManifestSource(null);
        return;
      }

      setManifestSource(toManifestSource(manifest!, accessToken));
    };

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [campaignId, visible]);

  useEffect(() => {
    if (!map || !mapLoaded || !visible || !manifestSource) {
      cleanupAddressLayers(map);
      return;
    }

    const addLayers = () => {
      if (!map.isStyleLoaded()) return;
      cleanupAddressLayers(map);

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

      map.addSource(SOURCE_ID, vectorSource);
      const labelFilter = getLayerFilter(manifestSource.sourceGeometry === 'polygon' ? 'Polygon' : 'Point');
      const hasExtrudedAddressCylinders = manifestSource.sourceGeometry === 'polygon';

      if (hasExtrudedAddressCylinders) {
        const polygonFilter = getLayerFilter('Polygon');
        map.addLayer({
          id: GLOW_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          'source-layer': manifestSource.sourceLayer,
          minzoom: manifestSource.minzoom,
          filter: polygonFilter,
          paint: {
            'line-color': MAP_STATUS_CONFIG.LEADS.color,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 18, 9],
            'line-opacity': getLeadGlowOpacityExpression(),
            'line-blur': 5,
          },
        });

        map.addLayer({
          id: CIRCLE_LAYER_ID,
          type: 'fill-extrusion',
          source: SOURCE_ID,
          'source-layer': manifestSource.sourceLayer,
          minzoom: manifestSource.minzoom,
          filter: polygonFilter,
          paint: {
            'fill-extrusion-color': getAddressColorExpression(),
            'fill-extrusion-height': ADDRESS_CYLINDER_HEIGHT_METERS,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.98,
            'fill-extrusion-vertical-gradient': true,
            'fill-extrusion-emissive-strength': 0.85,
          },
        } as mapboxgl.AnyLayer);
      } else {
        const pointFilter = getLayerFilter('Point');
        map.addLayer({
          id: GLOW_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          'source-layer': manifestSource.sourceLayer,
          minzoom: manifestSource.minzoom,
          filter: pointFilter,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 17],
            'circle-color': MAP_STATUS_CONFIG.LEADS.color,
            'circle-opacity': getLeadGlowOpacityExpression(),
            'circle-blur': 0.85,
          },
        });

        map.addLayer({
          id: CIRCLE_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          'source-layer': manifestSource.sourceLayer,
          minzoom: manifestSource.minzoom,
          filter: pointFilter,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 7],
            'circle-color': getAddressColorExpression(),
            'circle-opacity': 0.96,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          },
        });
      }

      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        'source-layer': manifestSource.sourceLayer,
        minzoom: ADDRESS_LABEL_MIN_ZOOM,
        filter: labelFilter,
        layout: {
          'text-field': ['coalesce', ['get', 'house_number_label'], ['get', 'house_number'], ''],
          'text-size': ['interpolate', ['linear'], ['zoom'], ADDRESS_LABEL_MIN_ZOOM, 10, 22, 13],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
          'text-pitch-alignment': hasExtrudedAddressCylinders ? 'map' : 'viewport',
          'text-rotation-alignment': hasExtrudedAddressCylinders ? 'map' : 'viewport',
          'text-allow-overlap': hasExtrudedAddressCylinders,
          'text-ignore-placement': hasExtrudedAddressCylinders,
          ...(hasExtrudedAddressCylinders
            ? {
                'symbol-placement': 'point',
                'symbol-z-order': 'auto',
                'symbol-z-elevate': true,
                'symbol-elevation-reference': 'ground',
              }
            : {}),
        },
        paint: {
          'text-color': '#f9fafb',
          'text-opacity': 0.95,
          'text-halo-color': '#111827',
          'text-halo-width': 1.5,
          ...(hasExtrudedAddressCylinders
            ? {
                'symbol-z-offset': ADDRESS_LABEL_CAP_CLEARANCE_METERS,
                'text-occlusion-opacity': 1,
              }
            : {}),
        },
      } as mapboxgl.AnyLayer);

      const clickHandler = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const props = feature?.properties ?? {};
        const addressId = String(props.address_id ?? props.id ?? '').trim();
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
    const onStyleLoad = () => {
      if (!cancelled) cleanupHandlers = addLayers();
    };

    if (map.isStyleLoaded()) {
      cleanupHandlers = addLayers();
    } else {
      map.once('style.load', onStyleLoad);
    }

    return () => {
      cancelled = true;
      map.off('style.load', onStyleLoad);
      cleanupHandlers?.();
      cleanupAddressLayers(map);
    };
  // Layer creation is keyed to the map/style/source; paint and filter changes are refreshed below to avoid full layer teardown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, visible, manifestSource, styleKey]);

  useEffect(() => {
    if (!map || !manifestSource || !visible) return;

    let frameId: number | null = null;
    const applyState = (attempt = 0) => {
      if (!map.getSource(SOURCE_ID)) {
        if (attempt < 8) frameId = requestAnimationFrame(() => applyState(attempt + 1));
        return;
      }

      for (const address of addresses) {
        try {
          map.setFeatureState({
            source: SOURCE_ID,
            sourceLayer: manifestSource.sourceLayer,
            id: address.id,
          }, getStatusState(address));
        } catch (error) {
          console.warn('[CampaignAddressPmtilesLayer] Failed to apply address feature-state:', error);
        }
      }
    };

    applyState();

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [map, manifestSource, visible, addresses]);

  useEffect(() => {
    if (!map || !manifestSource || !visible) return;
    const layerFilter = getLayerFilter(manifestSource.sourceGeometry === 'polygon' ? 'Polygon' : 'Point');
    try {
      for (const layerId of [GLOW_LAYER_ID, CIRCLE_LAYER_ID, LABEL_LAYER_ID]) {
        if (map.getLayer(layerId)) {
          map.setFilter(layerId, layerFilter);
        }
      }
      if (map.getLayer(GLOW_LAYER_ID) && manifestSource.sourceGeometry === 'polygon') {
        map.setPaintProperty(GLOW_LAYER_ID, 'line-opacity', getLeadGlowOpacityExpression());
      } else if (map.getLayer(GLOW_LAYER_ID)) {
        map.setPaintProperty(GLOW_LAYER_ID, 'circle-opacity', getLeadGlowOpacityExpression());
      }
      if (map.getLayer(CIRCLE_LAYER_ID) && manifestSource.sourceGeometry === 'polygon') {
        map.setPaintProperty(CIRCLE_LAYER_ID, 'fill-extrusion-color', getAddressColorExpression());
      } else if (map.getLayer(CIRCLE_LAYER_ID)) {
        map.setPaintProperty(CIRCLE_LAYER_ID, 'circle-color', getAddressColorExpression());
      }
    } catch (error) {
      console.warn('[CampaignAddressPmtilesLayer] Failed to refresh address layer styling:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, manifestSource, visible, statusFilters, deletedAddressSet, isFlyerMode]);

  return null;
}
