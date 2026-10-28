import assert from 'node:assert/strict';
import { findFarmCommercialMatches } from '../commercialMatches';

const home = { id: 'a', houseNumber: '12', street: 'Main Street', locality: 'Oshawa', latitude: 43.9, longitude: -78.8 };
const place = { id: 'p', houseNumber: '12', street: 'Main Street', locality: 'Oshawa', latitude: 43.9, longitude: -78.8, buildingId: 'b' };
const building = { id: 'b', subtype: 'commercial', addressIds: ['a'] };
assert.equal(findFarmCommercialMatches([home], [place], [building]).length, 1);
assert.equal(findFarmCommercialMatches([home], [place], [{ ...building, subtype: 'residential' }]).length, 0);
assert.equal(findFarmCommercialMatches([home], [place], [{ ...building, addressIds: ['a', 'other'] }]).length, 0);
assert.equal(findFarmCommercialMatches([home], [{ ...place, locality: 'Toronto' }], [building]).length, 0);
assert.equal(findFarmCommercialMatches([home], [{ ...place, latitude: 44 }], [building]).length, 0);
assert.equal(findFarmCommercialMatches([{ ...home, latitude: null }], [place], [building]).length, 0);
assert.equal(findFarmCommercialMatches([home], [place], []).length, 0);
