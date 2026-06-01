/**
 * Run with: npx tsx lib/__tests__/scopedPmtilesAddresses.test.ts
 */

import {
  normalizePmtilesAddressFeature,
  tileRangeForAddressBbox,
} from '../../app/api/campaigns/_utils/scoped-pmtiles-addresses';

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: unknown, message?: string) {
  if (!value) throw new Error(message ?? 'Expected truthy value');
}

function feature(properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [-97.371, 32.75],
    },
    properties,
  };
}

const tests: Array<[string, () => void]> = [
  [
    'selects a bounded address tile range within the configured tile limit',
    () => {
      const range = tileRangeForAddressBbox([-97.374146, 32.748743, -97.369198, 32.752399], 16, 10, 64);
      assertTrue(range, 'Expected a tile range');
      const tileCount = ((range?.maxX ?? 0) - (range?.minX ?? 0) + 1) * ((range?.maxY ?? 0) - (range?.minY ?? 0) + 1);
      assertTrue(tileCount <= 64, `Expected <=64 tiles, got ${tileCount}`);
      assertTrue((range?.z ?? 0) >= 10, 'Expected range to respect min zoom');
    },
  ],
  [
    'normalizes Bedrock US-style address properties',
    () => {
      const address = normalizePmtilesAddressFeature({
        campaignId: 'campaign-1',
        feature: feature({
          address_id: 'addr-1',
          house_number: '123',
          street_name: 'Main',
          street_type: 'St',
          locality: 'Fort Worth',
          state: 'TX',
          postcode: '76102',
          full_address: '123 Main St, Fort Worth, TX',
        }),
        lon: -97.371,
        lat: 32.75,
        source: 'bedrock_us',
        fallbackRegion: 'TX',
        defaultSource: 'Overture Maps Addresses',
        idPrefix: 'bedrock_us',
      });

      assertEqual(address?.formatted, '123 Main St, Fort Worth, TX');
      assertEqual(address?.street_name, 'Main St');
      assertEqual(address?.region, 'TX');
      assertEqual(address?.postal_code, '76102');
      assertEqual(address?.gers_id, 'bedrock_us:addr-1');
    },
  ],
  [
    'normalizes AU/NZ-style address identifiers and locality fields',
    () => {
      const address = normalizePmtilesAddressFeature({
        campaignId: 'campaign-2',
        feature: feature({
          address_detail_pid: 'gnaf-1',
          number_first: '9',
          street_name: 'Queen',
          locality_name: 'Sydney',
          state: 'NSW',
          postcode: '2000',
        }),
        lon: 151.21,
        lat: -33.88,
        source: 'bedrock_au',
        fallbackRegion: 'AU',
        defaultSource: 'G-NAF',
        idPrefix: 'gnaf',
      });

      assertEqual(address?.house_number, '9');
      assertEqual(address?.locality, 'Sydney');
      assertEqual(address?.region, 'NSW');
      assertEqual(address?.gers_id, 'gnaf:gnaf-1');
    },
  ],
];

let passed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed} passed, ${tests.length - passed} failed`);
