import assert from 'node:assert/strict';
import type { CanonicalTileBundle } from '@/lib/map/canonicalTileBundle';
import { isCanonicalTileBundle, canonicalRecordForHit } from '@/lib/map/canonicalTileBundle';
import { makeCanonicalCompactBundle } from '../CanonicalCompactBundle';

const source = {
  schema: 'tiles-v2', campaign_id: 'campaign', asset_signature: 'signature', canonical_signature: 'canonical', source_version: '1',
  tiles: { geometry_revision: 'revision', tile_url_template: '', archive_url: '', sha256: 'hash', byte_length: 1,
    bounds: [0, 0, 1, 1], layers: {}, geometry_pack: { url: '', sha256: 'hash', byte_length: 1, count: 2 } },
  records: { addresses: [], buildings: [], parcels: [] }, links: [], address_orphans: [], building_orphans: [],
  building_units: [{ id: 'unit-1', address_id: 'home', unit_geometry: { type: 'Point', coordinates: [1, 2] } }],
  roads: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'road-original-id', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Main' } }] },
  counts: {}, display_mode_hint: 'buildings', links_status: 'ready', reconciliation: {}, reconciliation_report: {},
} as CanonicalTileBundle;
const compact = makeCanonicalCompactBundle(source);
assert.equal(compact.schema, 'tiles-v3');
assert.equal(isCanonicalTileBundle(compact), true);
assert.equal(isCanonicalTileBundle({ ...compact, tiles: { ...compact.tiles, geometry_pack: undefined } }), false);
assert.equal(canonicalRecordForHit(compact, 'address:missing'), null);
assert.notEqual(compact.asset_signature, source.asset_signature);
assert.deepEqual(compact.building_units, [{ id: 'unit-1', address_id: 'home' }]);
assert.deepEqual(compact.road_records, [{ id: 'road:0', source_id: 'road-original-id', properties: { name: 'Main' } }]);
const changedRoad = { ...source.roads, features: source.roads.features.map((feature) => ({ ...feature, id: 'another-road' })) };
assert.notEqual(makeCanonicalCompactBundle({ ...source, roads: changedRoad }).asset_signature, compact.asset_signature);
assert.equal('roads' in compact, false);
assert.throws(() => makeCanonicalCompactBundle({ ...source, links: [{ geometry: { type: 'Point', coordinates: [1, 2] } }] }), /Unexpected GeoJSON/);
assert.throws(() => makeCanonicalCompactBundle({ ...source, tiles: { ...source.tiles, geometry_pack: undefined } }), /requires exact binary geometry/);
console.log('PASS: compact records omit geometry, preserve field metadata and reject hidden GeoJSON');
