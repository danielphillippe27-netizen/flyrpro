import { normalizeGoogleReverseGeocode } from '../reverseGeocode';

const normalized = normalizeGoogleReverseGeocode({
  formatted_address: '10 King St W, Toronto, ON M5H 1A1, Canada',
  address_components: [
    { long_name: '10', types: ['street_number'] },
    { long_name: 'King Street West', types: ['route'] },
    { long_name: 'Toronto', types: ['locality'] },
    { long_name: 'Ontario', short_name: 'ON', types: ['administrative_area_level_1'] },
    { long_name: 'M5H 1A1', types: ['postal_code'] },
    { long_name: 'Canada', short_name: 'CA', types: ['country'] },
  ],
});

const expected = {
  formatted: '10 King St W, Toronto, ON M5H 1A1, Canada',
  houseNumber: '10',
  streetName: 'King Street West',
  locality: 'Toronto',
  region: 'ON',
  postalCode: 'M5H 1A1',
  country: 'CA',
};

if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected normalized response: ${JSON.stringify(normalized)}`);
}
if (normalizeGoogleReverseGeocode({ address_components: [] }) !== null) {
  throw new Error('An empty result must not produce an address');
}

console.log('PASS Google reverse-geocode normalization');
