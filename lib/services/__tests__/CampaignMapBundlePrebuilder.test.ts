/**
 * CampaignMapBundlePrebuilder ownership regression fixtures
 *
 * Run with: npx tsx lib/services/__tests__/CampaignMapBundlePrebuilder.test.ts
 */

import {
  applyAddressParcelOwnership,
  dedupeCanonicalBuildingLinksForBundle,
  enrichFeatureCollectionsWithLinks,
  selectCanonicalAddressParcelOwnershipForBundle,
} from '../CampaignMapBundlePrebuilder';

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

function rectangle(minLon: number, minLat: number, maxLon: number, maxLat: number): number[][] {
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

function addressFeature(id: string, lon: number, lat: number): GeoJSON.Feature {
  const house = id.startsWith('a-') ? id.slice(2) : id;
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      house_number: house,
      street_name: 'Test Street',
      formatted: `${house} Test Street`,
    },
  };
}

function buildingFeature(id: string): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Polygon',
      coordinates: [rectangle(-79.001, 43.0000, -79.0000, 43.0010)],
    },
    properties: {
      id,
      building_id: id,
      gers_id: id,
    },
  };
}

function parcelFeature(id: string, ring: number[][], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id,
      parcel_id: id,
      land_use: 'residential',
      ...properties,
    },
  };
}

function run() {
  console.log('Running CampaignMapBundlePrebuilder ownership fixtures...\n');

  test('building bundle links keep one winning building per address', () => {
    const links = dedupeCanonicalBuildingLinksForBundle([
      {
        id: 'nearest-loser',
        building_id: 'building-near',
        address_id: 'address-1',
        match_type: 'nearest',
        confidence: 0.99,
        distance_meters: 1,
      },
      {
        id: 'parcel-loser',
        building_id: 'building-parcel',
        address_id: 'address-1',
        match_type: 'parcel_bridge',
        confidence: 0.95,
        distance_meters: 4,
      },
      {
        id: 'manual-winner',
        building_id: 'building-manual',
        address_id: 'address-1',
        match_type: 'manual',
        confidence: 0.8,
        distance_meters: 50,
      },
    ]);

    assertEqual(links.length, 1);
    assertEqual(links[0].building_id, 'building-manual');
  });

  test('overlapping parcels assign one smallest valid parcel per address', () => {
    const addresses: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [addressFeature('11111111-1111-4111-8111-111111111111', -79.0001, 43.0001)],
    };
    const parcels: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        parcelFeature('large-parcel', rectangle(-79.001, 43.0000, -79.0000, 43.0010)),
        parcelFeature('small-parcel', rectangle(-79.0002, 43.0000, -79.0000, 43.0002)),
      ],
    };

    const ownership = selectCanonicalAddressParcelOwnershipForBundle(addresses, parcels);

    assertEqual(ownership.length, 1);
    assertEqual(ownership[0].parcelId, 'small-parcel');
  });

	  test('parcel ownership never emits duplicate parcel owners for one address', () => {
    const addresses: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [addressFeature('22222222-2222-4222-8222-222222222222', -79.00005, 43.00005)],
    };
    const parcels: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        parcelFeature('parcel-a', rectangle(-79.0002, 43.0000, -79.0000, 43.0002), { area_sqm: 200 }),
        parcelFeature('parcel-b', rectangle(-79.0002, 43.0000, -79.0000, 43.0002), { area_sqm: 200 }),
      ],
    };

    const ownership = selectCanonicalAddressParcelOwnershipForBundle(addresses, parcels);

    assertEqual(ownership.map((row) => row.addressId), ['22222222-2222-4222-8222-222222222222']);
    assertEqual(ownership.map((row) => row.parcelId), ['parcel-a']);
	  });

  test('townhouse enrichment emits sorted bundle-only linked address metadata', () => {
    const addresses: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        addressFeature('a-13', -79.0004, 43.0004),
        addressFeature('a-11', -79.0003, 43.0003),
      ],
    };
    const buildings: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [buildingFeature('building-row-1')],
    };
    const result = enrichFeatureCollectionsWithLinks({
      addresses,
      buildings,
      links: [
        {
          id: 'link-13',
          building_id: 'building-row-1',
          address_id: 'a-13',
          match_type: 'contained',
          confidence: 0.9,
          is_multi_unit: true,
          unit_count: 2,
        },
        {
          id: 'link-11',
          building_id: 'building-row-1',
          address_id: 'a-11',
          match_type: 'contained',
          confidence: 0.9,
          is_multi_unit: true,
          unit_count: 2,
        },
      ],
    });

    const props = result.buildings.features[0].properties as Record<string, unknown>;
    assertEqual(props.linked_address_ids, ['a-11', 'a-13']);
    assertEqual(props.address_ids, ['a-11', 'a-13']);
    assertEqual(props.address_count, 2);
    assertEqual(props.linked_address_count, 2);
    assertEqual(props.units_count, 2);
    assertEqual(props.is_townhome, true);
    assertEqual(props.is_multi_unit, true);
    assertEqual(props.primary_address_id, 'a-11');
    assertEqual(props.primary_display_address, '11 Test Street');
  });

  test('parcel-only ownership emits address-mode-only label metadata', () => {
    const campaignParcelId = '55555555-5555-4555-8555-555555555555';
    const addresses: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [addressFeature('33333333-3333-4333-8333-333333333333', -79.00005, 43.00005)],
    };
    const parcels: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        parcelFeature('parcel-label', rectangle(-79.0002, 43.0000, -79.0000, 43.0002), {
          id: campaignParcelId,
        }),
      ],
    };

    const ownership = selectCanonicalAddressParcelOwnershipForBundle(addresses, parcels);
    const applied = applyAddressParcelOwnership({ addresses, parcels, ownership });
    const addressProps = applied.addresses.features[0].properties as Record<string, unknown>;
    const parcelProps = applied.parcels.features[0].properties as Record<string, unknown>;

    assertEqual(addressProps.has_parcel_link, true);
    assertEqual(addressProps.has_building_link, undefined);
    assertEqual(addressProps.label_visibility_mode, 'address_mode_only');
    assertEqual(addressProps.parcel_id, 'parcel-label');
    assertEqual(addressProps.campaign_parcel_id, campaignParcelId);
    assertEqual(typeof addressProps.label_anchor_lon, 'number');
    assertEqual(typeof addressProps.label_anchor_lat, 'number');
    assertEqual(parcelProps.linked_address_ids, ['33333333-3333-4333-8333-333333333333']);
    assertEqual(parcelProps.address_count, 1);
  });

  test('building-linked address labels stay visible in all modes even with parcel ownership', () => {
    const addresses: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          ...addressFeature('44444444-4444-4444-8444-444444444444', -79.00005, 43.00005),
          properties: {
            ...addressFeature('44444444-4444-4444-8444-444444444444', -79.00005, 43.00005).properties,
            has_building_link: true,
          },
        },
      ],
    };
    const parcels: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [parcelFeature('parcel-house', rectangle(-79.0002, 43.0000, -79.0000, 43.0002))],
    };

    const ownership = selectCanonicalAddressParcelOwnershipForBundle(addresses, parcels);
    const applied = applyAddressParcelOwnership({ addresses, parcels, ownership });
    const addressProps = applied.addresses.features[0].properties as Record<string, unknown>;

    assertEqual(addressProps.has_parcel_link, true);
    assertEqual(addressProps.label_visibility_mode, 'all_modes');
  });

  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
    process.exit(1);
  }

  console.log(`\n${testsPassed} test(s) passed.`);
}

run();
