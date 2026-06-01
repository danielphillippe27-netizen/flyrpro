/**
 * Run with: npx tsx lib/__tests__/buildingFootprintFilter.test.ts
 */

import assert from 'node:assert/strict';
import {
  filterLinkableBuildingFootprints,
  isLinkableBuildingFootprint,
} from '../geo/buildingFootprintFilter';

const largeShed = { id: 'shed-1', building_type: 'shed', area_sqm: 240 };
const largeGarage = { id: 'garage-1', subtype: 'garage', area_sqm: 180 };
const smallAnonymousBuilding = { id: 'small-1', area_sqm: 30 };
const house = { id: 'house-1', building_type: 'house', area_sqm: 92 };
const featureTaggedOutbuilding: GeoJSON.Feature<GeoJSON.Polygon> = {
  type: 'Feature',
  id: 'outbuilding-1',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-78.7801, 43.9141],
      [-78.7799, 43.9141],
      [-78.7799, 43.9143],
      [-78.7801, 43.9143],
      [-78.7801, 43.9141],
    ]],
  },
  properties: {
    class: 'outbuilding',
  },
};

assert.equal(isLinkableBuildingFootprint(largeShed), true);
assert.equal(isLinkableBuildingFootprint(largeGarage), true);
assert.equal(isLinkableBuildingFootprint(featureTaggedOutbuilding), true);
assert.equal(isLinkableBuildingFootprint(smallAnonymousBuilding), false);
assert.equal(isLinkableBuildingFootprint(house), true);
assert.equal(isLinkableBuildingFootprint(largeShed, { allowManual: true }), true);

assert.deepEqual(
  filterLinkableBuildingFootprints([
    largeShed,
    largeGarage,
    smallAnonymousBuilding,
    house,
  ]).map((building) => building.id),
  ['shed-1', 'garage-1', 'house-1']
);

console.log('buildingFootprintFilter tests passed');
