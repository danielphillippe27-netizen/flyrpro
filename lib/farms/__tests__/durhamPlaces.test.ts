import assert from 'node:assert/strict';
import { findDurhamPlaceMatches } from '../durhamPlaces';

const address = { id: 'a', formatted: '1 King ST W', house_number: '1', street_name: 'King ST W', latitude: 43.9, longitude: -78.7 };
const place = { id: 'p', names: { primary: 'Business' }, addresses: [{ freeform: '1 King Street West' }], lat: 43.9, lon: -78.7, taxonomy: { hierarchy: ['shopping'] } };
assert.equal(findDurhamPlaceMatches([address], [place]).length, 1);
assert.equal(findDurhamPlaceMatches([address], [{ ...place, operating_status: 'permanently_closed' }]).length, 0);
assert.equal(findDurhamPlaceMatches([address], [{ ...place, lat: 44 }]).length, 0);
assert.equal(findDurhamPlaceMatches([{ ...address, house_number: '2' }], [place]).length, 0);
assert.equal(findDurhamPlaceMatches([{ ...address, latitude: null }], [place]).length, 0);
assert.equal(findDurhamPlaceMatches([address], [{ ...place, taxonomy: { hierarchy: ['geographic_entities'] } }]).length, 0);
assert.equal(findDurhamPlaceMatches([address], [place, { ...place, id: 'residence', taxonomy: { hierarchy: ['services_and_business', 'housing_or_property_service', 'senior_living_facility', 'retirement_home'] } }]).length, 0);
