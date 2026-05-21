/**
 * Run with: npx tsx lib/__tests__/provisioningEdgeCases.test.ts
 */

import assert from 'node:assert/strict';
import type { StandardCampaignAddress } from '../services/AddressAdapter';
import {
  bboxFromPolygon,
  buildAddressIdentity,
  buildAddressSignature,
  deduplicateAddressesByProvisionKey,
  filterAddressesAgainstExisting,
  isConnectionError,
  shouldFailZeroAddressProvision,
  snapshotHasStaticPmtilesGeometry,
} from '../services/provisionHelpers';

const oldIsConnectionError = (error: Error): boolean =>
  error.message.includes('fetch failed') ||
  error.message.includes('ECONNRESET') ||
  error.message.includes('closed') ||
  error.message.includes('Connection Error') ||
  error.message.includes('established') ||
  error.message.includes('timeout');

function address(overrides: Partial<StandardCampaignAddress> = {}): StandardCampaignAddress {
  return {
    campaign_id: 'campaign-1',
    formatted: '123 Main St, Toronto, ON',
    house_number: '123',
    street_name: 'Main St',
    locality: 'Toronto',
    region: 'ON',
    postal_code: 'M5V',
    geom: '{"type":"Point","coordinates":[-79.39,43.65]}',
    source: 'bedrock_ca',
    gers_id: 'bedrock_ca:nar:123',
    ...overrides,
  };
}

assert.equal(
  shouldFailZeroAddressProvision({ hasResolvedAddresses: false, hasStaticGeometry: false }),
  true
);
assert.equal(
  shouldFailZeroAddressProvision({ hasResolvedAddresses: false, hasStaticGeometry: true }),
  false
);
assert.equal(
  shouldFailZeroAddressProvision({ hasResolvedAddresses: true, hasStaticGeometry: false }),
  false
);
assert.equal(
  shouldFailZeroAddressProvision({ hasResolvedAddresses: true, hasStaticGeometry: true }),
  false
);

assert.equal(isConnectionError(new Error('fetch failed')), true);
assert.equal(isConnectionError(new Error('ECONNRESET')), true);
assert.equal(isConnectionError(new Error('timeout')), true);
assert.equal(isConnectionError(new Error('exceeded')), true);
assert.equal(isConnectionError(new Error('not found')), false);
assert.equal(oldIsConnectionError(new Error('exceeded')), false);
assert.equal(isConnectionError('timeout'), false);

assert.equal(
  snapshotHasStaticPmtilesGeometry({
    buildings_key: 'bedrock/canada/current/buildings.pmtiles',
  }),
  true
);
assert.equal(
  snapshotHasStaticPmtilesGeometry({
    s3_keys: {
      buildings: 'bedrock/canada/current/buildings.pmtiles',
      addresses: null,
    },
  }),
  true
);
assert.equal(
  snapshotHasStaticPmtilesGeometry({
    s3_keys: {
      buildings: 'bedrock/canada/current/buildings.geojson',
      addresses: null,
    },
    metadata: { tile_metrics: { pmtiles_key: null } },
  }),
  false
);
assert.equal(
  snapshotHasStaticPmtilesGeometry({
    buildings_key: '',
    addresses_key: null,
    s3_keys: {
      buildings: null,
      addresses: '',
    },
  }),
  false
);
assert.equal(snapshotHasStaticPmtilesGeometry(null), false);

const firstSignature = buildAddressSignature({
  house_number: '123',
  street_name: 'Main St',
  locality: 'Toronto',
});
const matchingSignature = buildAddressSignature({
  house_number: '123',
  street_name: 'Main St',
  locality: 'Toronto',
});
const differentStreetSignature = buildAddressSignature({
  house_number: '123',
  street_name: 'Queen St',
  locality: 'Toronto',
});
const formattedFallbackSignature = buildAddressSignature({
  formatted: '123 Main St, Toronto, ON',
  postal_code: 'M5V',
});

assert.equal(firstSignature, matchingSignature);
assert.notEqual(firstSignature, differentStreetSignature);
assert.equal(formattedFallbackSignature, '123 main st, toronto, on|m5v');

const existingAddress = address();
const existingSet = new Set([buildAddressIdentity(existingAddress)]);
assert.deepEqual(filterAddressesAgainstExisting([existingAddress], existingSet), []);

const newAddress = address({ gers_id: 'bedrock_ca:nar:456', house_number: '456', formatted: '456 Main St' });
assert.deepEqual(filterAddressesAgainstExisting([newAddress], existingSet), [newAddress]);

const duplicateBatchAddress = address({
  gers_id: null,
  house_number: '789',
  formatted: '789 Main St',
});
assert.deepEqual(
  filterAddressesAgainstExisting([duplicateBatchAddress, duplicateBatchAddress], new Set()),
  [duplicateBatchAddress]
);

assert.deepEqual(deduplicateAddressesByProvisionKey([existingAddress, existingAddress]), [existingAddress]);

const secondAddress = address({ gers_id: 'bedrock_ca:nar:456', house_number: '456', formatted: '456 Main St' });
assert.deepEqual(deduplicateAddressesByProvisionKey([existingAddress, secondAddress]), [
  existingAddress,
  secondAddress,
]);

assert.deepEqual(
  bboxFromPolygon({
    type: 'Polygon',
    coordinates: [[
      [-80, 43],
      [-79, 43],
      [-79, 44],
      [-80, 44],
      [-80, 43],
    ]],
  }),
  [-80, 43, -79, 44]
);
assert.equal(
  bboxFromPolygon({ type: 'Polygon', coordinates: [] } as unknown as GeoJSON.Polygon),
  null
);
assert.throws(() => bboxFromPolygon(null as unknown as GeoJSON.Polygon));

console.log('provisioningEdgeCases helper tests passed');
