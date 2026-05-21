/**
 * Run with: npx tsx lib/__tests__/campaignMapGeometry.test.ts
 */

import { buildCampaignMapGeometry, type CampaignMapSnapshotRow } from '../map/campaignMapGeometry';

process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL = 'https://cdn.example.test';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
      testsPassed += 1;
    })
    .catch((error: unknown) => {
      console.error(`FAIL ${name}`);
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
      testsFailed += 1;
    });
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: unknown, message?: string) {
  if (!value) throw new Error(message ?? 'Expected truthy value');
}

function snapshot(tileMetrics: Record<string, unknown>): CampaignMapSnapshotRow {
  return {
    bucket: 'flyr-pro-addresses-2025',
    prefix: 'bedrock/canada/current',
    buildings_key: null,
    addresses_key: null,
    buildings_url: null,
    addresses_url: null,
    metadata_key: null,
    buildings_count: 0,
    created_at: '2026-05-13T12:00:00.000Z',
    tile_metrics: tileMetrics,
  };
}

const campaign = {
  bbox: [-80, 43, -79, 44],
  region: 'ON',
  provision_status: 'ready',
};

test('returns pending when no snapshot exists', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: null,
    campaign: { ...campaign, provision_status: 'pending' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'pending');
  assertEqual(result.layers, {});
});

test('normalizes Diamond buildings, addresses, and parcels', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: snapshot({
      diamond_mode: true,
      artifact_type: 'diamond',
      pmtiles_key: 'diamond/buildings/canada/on/toronto/buildings.pmtiles',
      addresses_pmtiles_key: 'diamond/addresses/canada/on/toronto/addresses.pmtiles',
      parcels_pmtiles_key: 'diamond/parcels/canada/on/toronto/parcels.pmtiles',
      source_layers: { buildings: 'buildings', addresses: 'addresses', parcels: 'parcels' },
      promote_ids: { buildings: 'building_id', addresses: 'address_id', parcels: 'parcel_id' },
    }),
    campaign,
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.provider, 'diamond');
  assertEqual(result.buildings_render_mode, 'geojson');
  assertEqual(result.layers.buildings?.kind, 'geojson');
  assertEqual(result.layers.buildings?.url, 'https://www.flyrpro.app/api/campaigns/campaign-1/buildings');
  assertEqual(result.layers.buildings?.vectorTileUrlTemplate, null);
  assertEqual(result.pmtiles_url, null);
  assertTrue(result.layers.addresses?.vectorTileUrlTemplate);
  assertTrue(result.layers.parcels?.vectorTileUrlTemplate);
});

test('does not depend on Bedrock building counts', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: {
      ...snapshot({
        bedrock_mode: true,
        bedrock_country: 'canada',
        bedrock_country_code: 'CA',
        pmtiles_key: 'bedrock/canada/current/buildings/buildings.pmtiles',
        addresses_pmtiles_key: 'bedrock/canada/current/addresses/addresses.pmtiles',
        source_layers: { buildings: 'buildings', addresses: 'addresses' },
      }),
      buildings_count: 0,
    },
    campaign,
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.provider, 'bedrock');
  assertEqual(result.countryCode, 'CA');
  assertEqual(result.buildings_render_mode, 'geojson');
  assertTrue(result.layers.buildings, 'Expected buildings layer even with buildings_count=0');
});

test('omits missing US Bedrock buildings while keeping addresses partial', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: snapshot({
      bedrock_mode: true,
      bedrock_country: 'usa',
      bedrock_country_code: 'US',
      pmtiles_key: 'bedrock/usa/current/buildings/pmtiles_by_state/state=FL/buildings.pmtiles',
      buildings_geojson_key: 'bedrock/usa/current/buildings/buildings.ndjson.gz',
      addresses_pmtiles_key: 'bedrock/usa/current/addresses/pmtiles_by_state/state=FL/addresses.pmtiles',
      parcels_pmtiles_key: 'bedrock/usa/current/parcels/pmtiles_by_state/state=FL/parcels.pmtiles',
      source_layers: { buildings: 'buildings', addresses: 'addresses', parcels: 'parcels' },
    }),
    campaign: { ...campaign, region: 'FL' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.layers.buildings?.kind, 'geojson');
  assertEqual(
    result.layers.buildings?.url,
    'https://www.flyrpro.app/api/campaigns/campaign-1/buildings'
  );
  assertEqual(result.buildings_render_mode, 'geojson');
  assertTrue(result.layers.addresses);
  assertTrue(result.layers.parcels);
});

test('normalizes Australia Bedrock PMTiles for GeoJSON rendering', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: snapshot({
      bedrock_mode: true,
      bedrock_country: 'australia',
      bedrock_country_code: 'AU',
      pmtiles_key: 'bedrock/australia/buildings/national/buildings.pmtiles',
      addresses_pmtiles_key: 'bedrock/australia/current/addresses/addresses.pmtiles',
      source_layers: { buildings: 'buildings', addresses: 'addresses' },
      promote_ids: { buildings: 'building_id', addresses: 'address_detail_pid' },
    }),
    campaign: { ...campaign, region: 'AU' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.countryCode, 'AU');
  assertEqual(result.layers.buildings?.kind, 'geojson');
  assertEqual(result.layers.addresses?.kind, 'pmtiles');
  assertEqual(result.buildings_render_mode, 'geojson');
});

test('normalizes New Zealand Bedrock PMTiles with parcels for GeoJSON rendering', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: snapshot({
      bedrock_mode: true,
      bedrock_country: 'new_zealand',
      bedrock_country_code: 'NZ',
      pmtiles_key: 'bedrock/new-zealand/current/buildings/buildings.pmtiles',
      addresses_pmtiles_key: 'bedrock/new-zealand/current/addresses/addresses.pmtiles',
      parcels_pmtiles_key: 'bedrock/new-zealand/current/parcels/parcels.pmtiles',
      source_layers: { buildings: 'buildings', addresses: 'addresses', parcels: 'parcels' },
    }),
    campaign: { ...campaign, region: 'NZ' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.countryCode, 'NZ');
  assertEqual(result.layers.buildings?.kind, 'geojson');
  assertEqual(result.layers.addresses?.kind, 'pmtiles');
  assertEqual(result.layers.parcels?.kind, 'pmtiles');
  assertEqual(result.buildings_render_mode, 'geojson');
});

test('normalizes South Africa Bedrock PMTiles for GeoJSON rendering', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: snapshot({
      bedrock_mode: true,
      bedrock_country: 'south-africa',
      bedrock_country_code: 'ZA',
      pmtiles_key: 'bedrock/south-africa/current/buildings/buildings.pmtiles',
      addresses_pmtiles_key: 'bedrock/south-africa/current/addresses/addresses.pmtiles',
      source_layers: { buildings: 'buildings', addresses: 'addresses' },
    }),
    campaign: { ...campaign, region: 'ZA' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.countryCode, 'ZA');
  assertEqual(result.layers.buildings?.kind, 'geojson');
  assertEqual(result.layers.addresses?.kind, 'pmtiles');
  assertEqual(result.buildings_render_mode, 'geojson');
});

test('normalizes UK Bedrock buildings and addresses without parcels', async () => {
  const result = await buildCampaignMapGeometry({
    campaignId: 'campaign-1',
    snapshot: {
      ...snapshot({
        bedrock_mode: true,
        bedrock_country: 'uk',
        bedrock_country_code: 'GB',
        pmtiles_key: 'bedrock/uk/current/buildings/buildings.pmtiles',
        addresses_pmtiles_key: 'bedrock/uk/current/addresses/addresses.pmtiles',
        parcels_pmtiles_key: null,
        source_layers: { buildings: 'buildings', addresses: 'addresses', parcels: 'parcels' },
      }),
      prefix: 'bedrock/uk/current',
    },
    campaign: { ...campaign, region: 'GB' },
    baseUrl: 'https://www.flyrpro.app',
    stateCursor: 'cursor',
  });

  assertEqual(result.status, 'ready');
  assertEqual(result.provider, 'bedrock');
  assertEqual(result.countryCode, 'GB');
  assertEqual(result.buildings_render_mode, 'geojson');
  assertTrue(result.layers.buildings);
  assertTrue(result.layers.addresses);
  assertEqual(result.layers.parcels, undefined);
});

setTimeout(() => {
  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
}, 0);
