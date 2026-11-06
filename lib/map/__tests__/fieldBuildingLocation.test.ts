import assert from 'node:assert/strict';
import { findFieldBuilding, isAutomaticBuildingLocation } from '../fieldBuildingLocation';
import type { CanonicalMapRecord } from '../canonicalTileBundle';
const house: CanonicalMapRecord = { id: 'durham_buildings:261257', feature_id: 'building:durham_buildings:261257',
  coordinate: [0, 0], bounds: [0, 0, 0, 0], properties: { row_id: 'row-1' } };
for (const provenance of ['field_building_location', 'field_building_reverse_geocode', 'field_building_location_unresolved']) {
  assert.equal(isAutomaticBuildingLocation(provenance), true);
}
assert.equal(isAutomaticBuildingLocation('field_manual_pin'), false);
assert.equal(isAutomaticBuildingLocation('unknown'), false);
assert.equal(findFieldBuilding([house], 'DURHAM_BUILDINGS:261257'), house);
assert.equal(findFieldBuilding([house], 'row-1'), house);
assert.equal(findFieldBuilding([house], 'another-campaign-home'), null);
assert.equal(findFieldBuilding([house, { ...house, id: 'other' }], 'row-1'), null);
assert.equal(findFieldBuilding([house], ''), null);
console.log('PASS: automatic provenance and campaign-scoped tile building identity');
