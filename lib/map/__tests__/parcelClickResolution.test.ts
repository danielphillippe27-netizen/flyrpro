/**
 * Parcel click resolver regression fixtures
 *
 * Run with: npx tsx lib/map/__tests__/parcelClickResolution.test.ts
 */

import {
  resolveParcelMapTarget,
  type ParcelResolutionAddress,
  type ParcelResolutionParcel,
} from '../parcelClickResolution';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const addresses: ParcelResolutionAddress[] = [
  { id: 'address-left', buildingId: 'building-left', lon: -79.01, lat: 43.0 },
  { id: 'address-right', buildingId: 'building-right', lon: -79.0, lat: 43.0 },
];

const parcels: ParcelResolutionParcel[] = [
  {
    id: 'parcel-row-1',
    externalId: 'external-1',
    properties: {
      parcel_id: 'external-1',
      linked_address_ids: ['address-left'],
    },
  },
  {
    id: 'parcel-row-2',
    externalId: 'external-2',
    properties: {
      parcel_id: 'external-2',
      linked_address_ids: ['address-left', 'address-right'],
    },
  },
  {
    id: 'parcel-row-empty',
    externalId: 'external-empty',
    properties: {
      parcel_id: 'external-empty',
    },
  },
];

function run() {
  console.log('Running parcel click resolver fixtures...\n');

  test('parcel with one linked address opens that address and building', () => {
    const result = resolveParcelMapTarget({
      payload: {
        externalParcelId: 'external-1',
        properties: {
          parcel_id: 'external-1',
        },
      },
      parcels,
      addresses,
    });

    assertEqual(result.parcelId, 'parcel-row-1');
    assertEqual(result.addressId, 'address-left');
    assertEqual(result.buildingId, 'building-left');
    assertEqual(result.isParcelOnly, false);
  });

  test('parcel with multiple linked addresses picks nearest visible address', () => {
    const result = resolveParcelMapTarget({
      payload: {
        externalParcelId: 'external-2',
        properties: {
          parcel_id: 'external-2',
        },
        lngLat: { lng: -79.0001, lat: 43.0 },
      },
      parcels,
      addresses,
    });

    assertEqual(result.parcelId, 'parcel-row-2');
    assertEqual(result.addressId, 'address-right');
    assertEqual(result.buildingId, 'building-right');
    assertEqual(result.linkedAddressIds, ['address-left', 'address-right']);
  });

  test('parcel with no linked address remains parcel-only', () => {
    const result = resolveParcelMapTarget({
      payload: {
        parcelId: 'parcel-row-empty',
        externalParcelId: 'external-empty',
        properties: {
          parcel_id: 'external-empty',
        },
      },
      parcels,
      addresses,
    });

    assertEqual(result.parcelId, 'parcel-row-empty');
    assertEqual(result.addressId, null);
    assertEqual(result.buildingId, null);
    assertEqual(result.isParcelOnly, true);
  });

  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
    process.exit(1);
  }

  console.log(`\n${testsPassed} test(s) passed.`);
}

run();
