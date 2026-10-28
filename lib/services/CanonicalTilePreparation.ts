import { createHash } from 'node:crypto';
import * as turf from '@turf/turf';
import { canonicalFeatureId, type CanonicalMapRecord, type CanonicalEntityKind, type CanonicalTileLayer } from '@/lib/map/canonicalTileBundle';
import { sanitizeBuildingExtrusionHeightMeters } from '@/lib/map/buildingHeight';

type Json = Record<string, unknown>;
const LIVE_KEYS = new Set(['status', 'address_status', 'visited', 'visit_count', 'last_visited_at',
  'scans', 'scans_total', 'qr_scanned', 'last_scanned_at', 'selected', 'visit_owner',
  'teammate_owned', 'is_teammate_owned', 'card_engaged', 'updated_at']);
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
// Full provenance and provider fields remain in the immutable details artifact.
// The hot path carries only fields needed for field interactions and display.
const RECORD_KEYS = new Set(['formatted', 'house_number', 'street_name', 'locality', 'region', 'postal_code',
  'address_text', 'address_id', 'primary_address_id', 'linked_address_ids', 'address_count', 'units_count',
  'is_multi_unit', 'is_townhome', 'unit_arrangement', 'height_m', 'min_height', 'area_sqm', 'feature_type',
  'feature_status', 'is_linked', 'source', 'building_id', 'campaign_parcel_id', 'parcel_id', 'external_id',
  'label_anchor_lon', 'label_anchor_lat', 'access_lon', 'access_lat', 'label_group_key', 'label_visible',
  'label_primary', 'pin_kind', 'match_source', 'provisional', 'address_resolution_status', 'geometry_target_kind',
  'geometry_target_id', 'resolution_status', 'unit_number', 'parent_building_id', 'editable']);

function collection(value: unknown): GeoJSON.FeatureCollection {
  return value && typeof value === 'object' && Array.isArray((value as GeoJSON.FeatureCollection).features)
    ? value as GeoJSON.FeatureCollection : EMPTY;
}

export function stableTileHash(value: unknown): string {
  const canonical = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(canonical)
    : entry && typeof entry === 'object'
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : entry;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function identity(kind: CanonicalEntityKind, feature: GeoJSON.Feature): string {
  const p = feature.properties ?? {};
  const candidates = kind === 'address' ? [p.address_id, p.id, feature.id]
    : kind === 'building' ? [p.canonical_building_id, p.building_id, p.gers_id, feature.id, p.id]
      : [p.parcel_id, p.external_id, feature.id, p.id];
  const value = candidates.find((id) => (typeof id === 'string' || typeof id === 'number') && String(id).trim());
  if (value === undefined) throw new Error(`Canonical ${kind} is missing identity`);
  const id = String(value).trim();
  return canonicalFeatureId(kind, id).slice(kind.length + 1);
}

function propertiesWithoutState(properties: Json): Json {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !LIVE_KEYS.has(key)));
}

export function prepareCanonicalTiles(bundle: Json) {
  const records: { buildings: CanonicalMapRecord[]; addresses: CanonicalMapRecord[]; parcels: CanonicalMapRecord[] } = {
    buildings: [], addresses: [], parcels: [],
  };
  const collections: Record<string, GeoJSON.FeatureCollection> = {};
  const layers: Record<string, CanonicalTileLayer> = {};
  for (const [name, kind] of [['buildings', 'building'], ['addresses', 'address'], ['parcels', 'parcel']] as const) {
    const seen = new Set<string>();
    const features: GeoJSON.Feature[] = [];
    for (const feature of collection(bundle[name]).features) {
      const polygon = feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon';
      // A legacy manual-pin cylinder may live amongst buildings. It has address identity,
      // so it is emitted once through the canonical address/cylinder layers below.
      if (kind === 'building' && feature.geometry?.type === 'Point') continue;
      if (kind === 'address' ? feature.geometry?.type !== 'Point' : !polygon) {
        throw new Error(`Unsupported canonical ${kind} geometry: ${feature.geometry?.type}`);
      }
      const id = identity(kind, feature);
      const featureId = canonicalFeatureId(kind, id);
      if (seen.has(featureId)) throw new Error(`Duplicate canonical identity: ${featureId}`);
      seen.add(featureId);
      const bounds = turf.bbox(feature) as [number, number, number, number];
      const coordinate = (feature.geometry.type === 'Point' ? feature.geometry.coordinates
        : turf.pointOnFeature(feature).geometry.coordinates) as [number, number];
      if (![...coordinate, ...bounds].every(Number.isFinite)) throw new Error(`Invalid coordinates: ${featureId}`);
      const properties: Json = { ...Object.fromEntries(Object.entries(propertiesWithoutState(feature.properties ?? {}))
        .filter(([key]) => RECORD_KEYS.has(key))), feature_id: featureId,
        canonical_id: id, row_id: feature.properties?.id ?? feature.id ?? id, [`${kind}_id`]: id };
      records[name].push({ id, feature_id: featureId, coordinate, bounds, properties });
      features.push({ type: 'Feature', geometry: feature.geometry, properties: {
        feature_id: featureId, canonical_id: id, [`${kind}_id`]: id,
        ...(kind === 'building' ? { gers_id: id, height_m: sanitizeBuildingExtrusionHeightMeters(feature.properties ?? {}), min_height: properties.min_height ?? 0 } : {}),
        house_number: properties.house_number ?? '',
        // Native hit resolution and flyer proximity must retain canonical joins;
        // geometries returned by a tile query can be clipped at a tile boundary.
        ...(typeof properties.address_id === 'string' ? { address_id: properties.address_id } : {}),
        ...(typeof properties.primary_address_id === 'string' ? { primary_address_id: properties.primary_address_id } : {}),
        ...(kind === 'address' && typeof properties.building_id === 'string' ? { building_id: properties.building_id, building_gers_id: properties.building_id } : {}),
        is_linked: properties.is_linked ?? false, address_count: properties.address_count ?? 0,
        feature_type: properties.feature_type ?? 'matched_house', feature_status: properties.feature_status ?? 'matched',
      } });
    }
    records[name].sort((a, b) => a.feature_id.localeCompare(b.feature_id));
    features.sort((a, b) => String(a.properties?.feature_id).localeCompare(String(b.properties?.feature_id)));
    collections[name] = { type: 'FeatureCollection', features };
    layers[name] = { source_layer: name, promote_id: 'feature_id', minzoom: 10, maxzoom: 18, count: features.length };
  }
  collections.address_circles = { type: 'FeatureCollection', features: collections.addresses.features.map((feature) => {
    const point = feature.geometry as GeoJSON.Point;
    return { ...turf.circle(point.coordinates, 2.6, { steps: 28, units: 'meters' }), properties: feature.properties };
  }) };
  layers.address_circles = { source_layer: 'address_circles', promote_id: 'feature_id', minzoom: 10, maxzoom: 18, count: records.addresses.length };
  const addresses = new Set(records.addresses.map((record) => record.id));
  const units = (Array.isArray(bundle.building_units) ? bundle.building_units : []) as Json[];
  collections.building_units = { type: 'FeatureCollection', features: units.flatMap((unit) => {
    const geometry = unit.unit_geometry as GeoJSON.Geometry | undefined;
    const addressId = canonicalFeatureId('address', String(unit.address_id ?? 'missing')).slice('address:'.length);
    if (unit.lifecycle_state !== 'active' || !addresses.has(addressId)
      || !geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
    return [{ type: 'Feature' as const, geometry, properties: {
      feature_id: canonicalFeatureId('address', addressId), canonical_id: addressId,
      address_id: addressId, building_id: unit.parent_building_id, unit_id: unit.id,
      house_number: unit.unit_number ?? '', height_m: 8.1,
    } }];
  }) };
  layers.building_units = { source_layer: 'building_units', promote_id: 'feature_id', minzoom: 13, maxzoom: 18, count: collections.building_units.features.length };
  const all = Object.values(collections).flatMap((value) => value.features);
  if (!all.length) throw new Error('An empty campaign has no tile archive to publish');
  const bounds = turf.bbox({ type: 'FeatureCollection', features: all }) as [number, number, number, number];
  const geometryRevision = stableTileHash({ format: 'canonical-pmtiles-v1', collections, layers });
  return { records, collections, layers, bounds, geometryRevision };
}
