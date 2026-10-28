import assert from 'node:assert/strict';
import { prepareCanonicalTiles } from '../CanonicalTilePreparation';
import { canonicalFeatureId } from '../../map/canonicalTileBundle';

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const building: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
  [-78.85, 43.90], [-78.8498, 43.90], [-78.8498, 43.9002], [-78.85, 43.9002], [-78.85, 43.90],
]] }, properties: { building_id: 'building-A', address_id: 'home-1', status: 'lead', height_m: 8 } };
const address: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-78.8499, 43.9001] },
  properties: { address_id: 'home-1', building_id: 'building-A', house_number: '12', address_status: 'lead', scans_total: 2 } };
const bundle = { buildings: fc([building]), addresses: fc([address]), parcels: fc([]) };
const result = prepareCanonicalTiles(bundle);
assert.equal(result.records.buildings[0].feature_id, 'building:building-A');
assert.equal(result.records.addresses[0].feature_id, 'address:home-1');
assert.equal(result.collections.address_circles.features[0].properties?.feature_id, 'address:home-1');
assert.equal(result.collections.buildings.features[0].properties?.status, undefined);
assert.equal(result.collections.addresses.features[0].properties?.scans_total, undefined);
assert.equal(result.records.addresses[0].properties.building_id, 'building-A');
const changedState = structuredClone(bundle);
changedState.buildings.features[0].properties!.status = 'do_not_knock';
changedState.addresses.features[0].properties!.scans_total = 40;
assert.equal(prepareCanonicalTiles(changedState).geometryRevision, result.geometryRevision, 'State changes never rebuild geometry');
const moved = structuredClone(bundle);
(moved.addresses.features[0].geometry as GeoJSON.Point).coordinates[0] += 0.0001;
assert.notEqual(prepareCanonicalTiles(moved).geometryRevision, result.geometryRevision, 'Corrected pin position changes revision');
assert.throws(() => prepareCanonicalTiles({ ...bundle, addresses: fc([address, address]) }), /Duplicate canonical identity/);
assert.equal(canonicalFeatureId('address', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'), 'address:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
assert.equal(canonicalFeatureId('building', 'ExternalCaseSensitiveID'), 'building:ExternalCaseSensitiveID');
console.log('Canonical tiles: identity, independent pin state, live-state exclusion, corrected positions, and duplicate rejection passed.');
