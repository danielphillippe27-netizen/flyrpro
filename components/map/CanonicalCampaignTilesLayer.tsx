'use client';
import { useEffect, useMemo, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { CampaignAddress } from '@/types/database';
import type { StatusFilters } from '@/lib/constants/mapStatus';
import { canonicalRecordForHit, type CanonicalClientTileBundle } from '@/lib/map/canonicalTileBundle';
import { canonicalTileStates, CanonicalTileStateDiff } from '@/lib/map/canonicalTileState';
import { useCardEngagement } from '@/lib/cards/useCardEngagement';
import { getBuildingExtrusionHeightExpression } from '@/lib/map/buildingHeight';

export const CANONICAL_TILE_SOURCE = 'campaign-canonical-tiles';
const IDS = ['canonical-parcels', 'canonical-buildings', 'canonical-address-circles', 'canonical-addresses', 'canonical-selection', 'canonical-labels', 'canonical-units', 'canonical-address-selection'];
type Props = {
  map: mapboxgl.Map; bundle: CanonicalClientTileBundle; mapLoaded: boolean; styleKey: string;
  mode: 'buildings' | 'addresses'; addresses: CampaignAddress[]; dark: boolean;
  showParcels: boolean; statusFilters: StatusFilters; selectedIds?: string[];
  hiddenBuildingIds?: string[]; deletedAddressIds?: string[]; visibleAddressIds?: string[];
  hiddenPinIds?: string[];
  showAddressLabels?: boolean;
  colorOverrides?: Record<string, string>;
  onClick: (target: { buildingId: string | null; addressId: string | null; parcelId: string | null }, options: { additive: boolean }) => void;
};
const color = (qrEnabled: boolean): mapboxgl.Expression => ['case',
  ['boolean', ['feature-state', 'teammate_owned'], false], '#166534',
  ['all', qrEnabled, ['boolean', ['feature-state', 'card_engaged'], false]], '#8b5cf6',
  ['coalesce', ['feature-state', 'color'], '#475569']];
const opacity = (value: number): mapboxgl.Expression => ['case', ['boolean', ['feature-state', 'hidden'], false], 0, value];

export function CanonicalCampaignTilesLayer(props: Props) {
  const { map, bundle, mapLoaded, styleKey } = props;
  useCardEngagement(map, bundle.campaign_id, CANONICAL_TILE_SOURCE, 'building', 'buildings', 'building:');
  useCardEngagement(map, bundle.campaign_id, CANONICAL_TILE_SOURCE, 'address', 'addresses', 'address:');
  useCardEngagement(map, bundle.campaign_id, CANONICAL_TILE_SOURCE, 'address', 'address_circles', 'address:');
  useCardEngagement(map, bundle.campaign_id, CANONICAL_TILE_SOURCE, 'address', 'building_units', 'address:');
  const latest = useRef(props); latest.current = props;
  const diff = useRef(new CanonicalTileStateDiff());
  const states = useMemo(() => canonicalTileStates(bundle, props.addresses, {
    selectedIds: props.selectedIds, hiddenBuildingIds: props.hiddenBuildingIds, deletedAddressIds: props.deletedAddressIds,
    visibleAddressIds: props.visibleAddressIds, filters: props.statusFilters, dark: props.dark, colorOverrides: props.colorOverrides,
  }), [bundle, props.addresses, props.selectedIds, props.hiddenBuildingIds, props.deletedAddressIds, props.visibleAddressIds, props.statusFilters, props.dark, props.colorOverrides]);
  const stateRef = useRef(states); stateRef.current = states;
  const apply = () => {
    if (!map.getSource(CANONICAL_TILE_SOURCE)) return;
    diff.current.apply(stateRef.current, ({ sourceLayer, id, state }) => map.setFeatureState({ source: CANONICAL_TILE_SOURCE, sourceLayer, id }, state));
  };
  useEffect(() => {
    if (!mapLoaded) return;
    const stateDiff = diff.current;
    const attach = () => {
      if (!map.isStyleLoaded() || map.getSource(CANONICAL_TILE_SOURCE)) return;
      map.addSource(CANONICAL_TILE_SOURCE, { type: 'vector', tiles: [bundle.tiles.tile_url_template], bounds: bundle.tiles.bounds,
        minzoom: 10, maxzoom: 18, promoteId: 'feature_id' });
      const common = { source: CANONICAL_TILE_SOURCE };
      const paintColor = color(latest.current.statusFilters.QR_SCANNED);
      map.addLayer({ ...common, id: IDS[0], type: 'fill', 'source-layer': 'parcels', minzoom: 10,
        paint: { 'fill-color': paintColor, 'fill-outline-color': paintColor, 'fill-opacity': opacity(0.32) } });
      map.addLayer({ ...common, id: IDS[1], type: 'fill-extrusion', 'source-layer': 'buildings', minzoom: 10,
        paint: { 'fill-extrusion-color': paintColor, 'fill-extrusion-height': getBuildingExtrusionHeightExpression(), 'fill-extrusion-opacity': 1, 'fill-extrusion-rounded-roof': false } });
      map.addLayer({ ...common, id: IDS[2], type: 'fill-extrusion', 'source-layer': 'address_circles', minzoom: 13,
        paint: { 'fill-extrusion-color': paintColor, 'fill-extrusion-height': ['case', ['boolean', ['feature-state', 'hidden'], false], 0, 12], 'fill-extrusion-opacity': 1, 'fill-extrusion-rounded-roof': false } });
      map.addLayer({ ...common, id: IDS[3], type: 'circle', 'source-layer': 'addresses', minzoom: 10, maxzoom: 13,
        paint: { 'circle-color': paintColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 13, 5], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.8, 'circle-opacity': opacity(1) } });
      map.addLayer({ ...common, id: IDS[4], type: 'line', 'source-layer': 'buildings', minzoom: 10,
        paint: { 'line-color': '#60a5fa', 'line-width': 2,
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
      map.addLayer({ ...common, id: IDS[5], type: 'symbol', 'source-layer': 'addresses', minzoom: 16,
        layout: { 'text-field': ['get', 'house_number'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1, 'text-opacity': opacity(1) } });
      if (bundle.tiles.layers.building_units) map.addLayer({ ...common, id: IDS[6], type: 'fill-extrusion', 'source-layer': 'building_units', minzoom: 13,
        paint: { 'fill-extrusion-color': paintColor, 'fill-extrusion-height': 8.5, 'fill-extrusion-opacity': 1, 'fill-extrusion-rounded-roof': false } });
      map.addLayer({ ...common, id: IDS[7], type: 'line', 'source-layer': 'address_circles', minzoom: 13,
        paint: { 'line-color': '#60a5fa', 'line-width': 3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
      stateDiff.reset(); apply();
      refreshVisibility();
    };
    const refreshVisibility = () => {
      const p = latest.current;
      for (const [id, enabled] of [[IDS[0], p.showParcels], [IDS[1], p.mode === 'buildings'], [IDS[4], p.mode === 'buildings'],
        [IDS[2], p.mode === 'addresses'], [IDS[3], true], [IDS[5], p.mode === 'addresses' && p.showAddressLabels !== false], [IDS[6], p.mode === 'buildings'], [IDS[7], p.mode === 'addresses']] as const) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', enabled ? 'visible' : 'none');
      }
      const hidden = [...new Set(stateRef.current.filter((entry) => entry.state.hidden).map((entry) => entry.id))];
      for (const id of IDS) if (map.getLayer(id)) map.setFilter(id, ['!', ['in', ['get', 'feature_id'], ['literal',
        [IDS[2], IDS[3], IDS[5], IDS[7]].includes(id) ? [...hidden, ...(p.hiddenPinIds ?? []).map((value) => `address:${value}`)] : hidden]]]);
    };
    const click = (event: mapboxgl.MapMouseEvent) => {
      const layers = IDS.filter((id) => map.getLayer(id));
      const point = event.point;
      const hits = map.queryRenderedFeatures([[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]], { layers });
      for (const hit of hits) {
        const id = String(hit.properties?.feature_id ?? hit.id ?? '');
        const state = stateRef.current.find((write) => write.id === id)?.state;
        if (state?.hidden) continue;
        const resolved = canonicalRecordForHit(latest.current.bundle, id);
        if (!resolved) continue;
        const { kind, record } = resolved;
        const firstLink = latest.current.bundle.links.find((raw) => (raw as Record<string, unknown>).building_id === record.id) as Record<string, unknown> | undefined;
        latest.current.onClick({
          buildingId: kind === 'building' ? record.id : typeof record.properties.building_id === 'string' ? record.properties.building_id : null,
          addressId: kind === 'address' ? record.id : String(record.properties.primary_address_id ?? record.properties.address_id ?? firstLink?.address_id ?? '') || null,
          parcelId: kind === 'parcel' ? String(record.properties.row_id ?? record.id) : null,
        }, { additive: Boolean(event.originalEvent.metaKey || event.originalEvent.ctrlKey) });
        break;
      }
    };
    attach();
    map.on('style.load', attach); map.on('idle', attach); map.on('click', click);
    return () => {
      map.off('style.load', attach); map.off('idle', attach); map.off('click', click);
      for (const id of [...IDS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(CANONICAL_TILE_SOURCE)) map.removeSource(CANONICAL_TILE_SOURCE);
      stateDiff.reset();
    };
  // Changes to address status never replace the immutable source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, styleKey, bundle.tiles.geometry_revision, bundle.tiles.tile_url_template]);
  useEffect(() => { apply(); }, [states, map, mapLoaded, styleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const [id, visible] of [[IDS[0], props.showParcels], [IDS[1], props.mode === 'buildings'], [IDS[4], props.mode === 'buildings'], [IDS[2], props.mode === 'addresses'], [IDS[5], props.mode === 'addresses' && props.showAddressLabels !== false], [IDS[6], props.mode === 'buildings'], [IDS[7], props.mode === 'addresses']] as const) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    // Hidden geometry must be excluded from rendering as well as from interaction.
    const hidden = states.filter((entry) => entry.state.hidden).map((entry) => entry.id);
    for (const id of IDS) if (map.getLayer(id)) map.setFilter(id, ['!', ['in', ['get', 'feature_id'], ['literal',
      [IDS[2], IDS[3], IDS[5], IDS[7]].includes(id) ? [...hidden, ...(props.hiddenPinIds ?? []).map((value) => `address:${value}`)] : hidden]]]);
    for (const [id, property] of [[IDS[0], 'fill-color'], [IDS[1], 'fill-extrusion-color'], [IDS[2], 'fill-extrusion-color'], [IDS[3], 'circle-color'], [IDS[6], 'fill-extrusion-color']] as const) {
      if (map.getLayer(id)) map.setPaintProperty(id, property, color(props.statusFilters.QR_SCANNED));
    }
  }, [map, states, props.mode, props.showParcels, props.statusFilters.QR_SCANNED, props.hiddenPinIds, props.showAddressLabels, mapLoaded, styleKey]);
  return null;
}
