import assert from 'node:assert/strict';
import { prepareCanonicalTiles } from '../CanonicalTilePreparation';
import { canonicalFeatureId } from '../../map/canonicalTileBundle';
import { applyParcelPinPlacements, planParcelPinPlacements } from '../ParcelPinPlacement';

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const building: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
  [-78.85, 43.90], [-78.8498, 43.90], [-78.8498, 43.9002], [-78.85, 43.9002], [-78.85, 43.90],
]] }, properties: { building_id: 'building-A', address_id: 'home-1', address_ids: ['home-1'],
  canonical_building_id: 'building-A', source_id: 'source-1', status: 'lead', height_m: 8 } };
const address: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-78.8499, 43.9001] },
  properties: { address_id: 'home-1', building_id: 'building-A', house_number: '12', address_status: 'lead', scans_total: 2,
    id: 'original-row', address_provenance: 'field_manual_pin', campaign_address_id: 'home-1',
    provider_extra: 'retained', source_geometry: { type: 'Point', coordinates: [-78.8, 43.9] } } };
const parcel: GeoJSON.Feature = { ...building, properties: { parcel_id: 'parcel-1', topology_type: 'primary', parcel_intent: 'residential', zoning: 'residential' } };
const bundle = { buildings: fc([building]), addresses: fc([address]), parcels: fc([parcel]) };
const result = prepareCanonicalTiles(bundle);
assert.equal(result.records.buildings[0].feature_id, 'building:building-A');
assert.equal(result.records.addresses[0].feature_id, 'address:home-1');
assert.equal(result.collections.address_circles.features[0].properties?.feature_id, 'address:home-1');
assert.equal(result.collections.buildings.features[0].properties?.status, undefined);
assert.equal(result.collections.addresses.features[0].properties?.scans_total, undefined);
assert.equal(result.records.addresses[0].properties.building_id, 'building-A');
assert.equal(result.records.addresses[0].properties.address_provenance, 'field_manual_pin');
assert.equal(result.records.addresses[0].properties.id, 'original-row');
assert.equal(result.records.addresses[0].properties.provider_extra, 'retained');
assert.equal(result.records.addresses[0].properties.source_geometry, undefined);
assert.equal(result.records.parcels[0].properties.parcel_intent, 'residential');
assert.equal(result.records.parcels[0].properties.topology_type, 'primary');
assert.deepEqual(result.records.buildings[0].properties.address_ids, ['home-1']);
assert.equal(result.records.buildings[0].properties.canonical_building_id, 'building-A');
assert.equal(result.records.buildings[0].properties.source_id, 'source-1');
const changedState = structuredClone(bundle);
changedState.buildings.features[0].properties!.status = 'do_not_knock';
changedState.addresses.features[0].properties!.scans_total = 40;
assert.equal(prepareCanonicalTiles(changedState).geometryRevision, result.geometryRevision, 'State changes never rebuild geometry');
const moved = structuredClone(bundle);
(moved.addresses.features[0].geometry as GeoJSON.Point).coordinates[0] += 0.0001;
assert.notEqual(prepareCanonicalTiles(moved).geometryRevision, result.geometryRevision, 'Corrected pin position changes revision');
// Exercise the same parcel placement used by the canonical bundle before tiles
// are built: the tile must use the optimized point and retain its association.
const unplaced = structuredClone(address);
unplaced.properties = { address_id: 'home-1', parcel_id: 'parcel-1', building_id: 'building-A' };
unplaced.geometry = { type: 'Point', coordinates: [-78.8501, 43.9001] };
const placements = planParcelPinPlacements({ addresses: [unplaced], buildings: [building], parcels: [parcel] });
assert.equal(placements.length, 1);
const optimized = applyParcelPinPlacements(fc([unplaced]), placements);
const optimizedTiles = prepareCanonicalTiles({ buildings: fc([building]), addresses: optimized, parcels: fc([parcel]) });
assert.deepEqual(optimizedTiles.collections.addresses.features[0].geometry, optimized.features[0].geometry);
assert.deepEqual(optimizedTiles.records.addresses[0].coordinate, placements[0].coordinate);
assert.equal(optimizedTiles.records.addresses[0].properties.building_id, 'building-A');
assert.equal(optimizedTiles.records.addresses[0].properties.parcel_id, 'parcel-1');
assert.equal(optimizedTiles.records.addresses[0].properties.pin_placement, placements[0].method);
assert.throws(() => prepareCanonicalTiles({ ...bundle, addresses: fc([address, address]) }), /Duplicate canonical identity/);
assert.equal(canonicalFeatureId('address', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'), 'address:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
assert.equal(canonicalFeatureId('building', 'ExternalCaseSensitiveID'), 'building:ExternalCaseSensitiveID');
console.log('Canonical tiles: identity, independent pin state, live-state exclusion, corrected positions, and duplicate rejection passed.');
