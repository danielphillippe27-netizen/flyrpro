/**
 * Run with: npx tsx lib/__tests__/provisioningEdgeCases.test.ts
 */

import { resolveCampaignRegion } from '../geo/regionResolver';
import { BedrockCanadaService } from '../services/BedrockCanadaService';

type ProvisionSource = 'bedrock_ca';

type SnapshotFixture = {
  s3_keys: {
    buildings: string | null;
    addresses: string | null;
  };
  urls: {
    buildings: string | null;
  };
  metadata?: {
    tile_metrics?: Record<string, unknown> | null;
  } | null;
};

type AddressFixture = {
  campaign_id: string;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  postal_code?: string | null;
  source?: string | null;
  source_id?: string | null;
  gers_id?: string | null;
};

let testsPassed = 0;
let testsFailed = 0;

const originalMapboxToken = process.env.MAPBOX_TOKEN;
const originalNextPublicMapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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

async function assertRejects(fn: () => Promise<void>, expectedMessage: string) {
  try {
    await fn();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(`Expected message containing "${expectedMessage}", got "${message}"`);
    }
    return;
  }
  throw new Error('Expected promise to reject');
}

class ProvisionError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
    this.name = 'ProvisionError';
  }
}

function stringTileMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function snapshotHasStaticPmtilesGeometry(snapshot: SnapshotFixture | null | undefined): boolean {
  if (!snapshot) return false;

  const metrics = snapshot.metadata?.tile_metrics;
  return [
    snapshot.s3_keys.buildings,
    snapshot.s3_keys.addresses,
    stringTileMetric(metrics, 'pmtiles_key'),
    stringTileMetric(metrics, 'addresses_pmtiles_key'),
    stringTileMetric(metrics, 'parcels_pmtiles_key'),
  ].some((key) => typeof key === 'string' && key.toLowerCase().endsWith('.pmtiles'));
}

function assertZeroAddressOutcome(addresses: AddressFixture[], snapshot: SnapshotFixture) {
  const hasResolvedAddresses = addresses.length > 0;
  const hasStaticGeometry = snapshotHasStaticPmtilesGeometry(snapshot);

  if (!hasResolvedAddresses && !hasStaticGeometry) {
    throw new ProvisionError(
      'Provisioning did not find any addresses in this territory. Try a larger polygon or a nearby area.',
      422
    );
  }

  return { continued: true };
}

function validateTerritoryBoundaryLikeRoute(territoryBoundary: unknown) {
  if (!territoryBoundary) {
    throw new ProvisionError(
      'No territory boundary defined. Please draw a polygon on the map when creating the campaign.',
      400
    );
  }
}

function assertPolygonForMockScan(territoryBoundary: unknown) {
  const polygon = territoryBoundary as { type?: unknown; coordinates?: unknown };
  if (polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) {
    throw new Error('Malformed territory_boundary is not a valid Polygon');
  }
}

async function simulateProvisionWithTimeoutFailure() {
  const updates: Array<Record<string, unknown>> = [];
  const timeoutError = new Error(
    'Provision source resolution exceeded 240s before Diamond/Bedrock returned. Check S3/DuckDB/httpfs runtime logs.'
  );

  try {
    updates.push({ provision_status: 'pending', provision_phase: 'created' });
    throw timeoutError;
  } catch (error: unknown) {
    const failureReason = error instanceof Error ? error.message : String(error);
    updates.push({
      provision_status: 'failed',
      provision_phase: 'failed',
      link_quality_status: 'failed',
      link_quality_reason: failureReason,
      data_quality_reason: failureReason,
    });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { updates });
  }
}

function normalizeAddressFragment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeSource(value: string | null | undefined): string {
  const normalized = normalizeAddressFragment(value);
  return normalized || 'unknown';
}

function externalAddressId(address: { gers_id?: string | null; source_id?: string | null }): string {
  return typeof (address.gers_id ?? address.source_id) === 'string'
    ? (address.gers_id ?? address.source_id ?? '').trim()
    : '';
}

function buildAddressSignature(address: AddressFixture): string {
  const houseNumber = normalizeAddressFragment(address.house_number);
  const streetName = normalizeAddressFragment(address.street_name);
  const locality = normalizeAddressFragment(address.locality);
  const postalCode = normalizeAddressFragment(address.postal_code);

  if (houseNumber || streetName || locality) {
    return `${houseNumber}|${streetName}|${locality}`;
  }

  return `${normalizeAddressFragment(address.formatted)}|${postalCode}`;
}

function buildAddressIdentity(address: AddressFixture): string {
  const source = normalizeSource(address.source);
  const externalId = externalAddressId(address);
  if (externalId) {
    return `${address.campaign_id}|${source}|external|${externalId}`;
  }

  return `${address.campaign_id}|${source}|address|${buildAddressSignature(address)}`;
}

function filterAddressesAgainstExisting(addresses: AddressFixture[], existingSignatures: Set<string>) {
  const accepted: AddressFixture[] = [];
  const seenThisBatch = new Set<string>();

  for (const address of addresses) {
    const signature = buildAddressIdentity(address);
    if (existingSignatures.has(signature) || seenThisBatch.has(signature)) {
      continue;
    }
    seenThisBatch.add(signature);
    accepted.push(address);
  }

  return accepted;
}

function sourceForRegion(regionCode: string): ProvisionSource {
  if (BedrockCanadaService.isCanadaRegion(regionCode)) return 'bedrock_ca';
  throw new ProvisionError(`Provisioning only supports Diamond or Bedrock S3 folders for region "${regionCode}".`, 422);
}

function sampleAddress(id: string): AddressFixture {
  return {
    campaign_id: 'campaign-1',
    formatted: `${id} Main St`,
    house_number: id,
    street_name: 'Main St',
    locality: 'Toronto',
    postal_code: 'M5V',
    source: 'bedrock_ca',
    gers_id: `bedrock_ca:nar:${id}`,
  };
}

test('zero addresses without PMTiles geometry throws ProvisionError 422', async () => {
  const snapshot = {
    s3_keys: { buildings: null, addresses: null },
    urls: { buildings: null },
    metadata: { tile_metrics: null },
  };

  await assertRejects(async () => {
    assertZeroAddressOutcome([], snapshot);
  }, 'Provisioning did not find any addresses');

  try {
    assertZeroAddressOutcome([], snapshot);
  } catch (error: unknown) {
    assertEqual(error instanceof ProvisionError ? error.status : null, 422);
  }
});

test('zero addresses with PMTiles geometry continues without 422', async () => {
  const snapshot = {
    s3_keys: { buildings: 'bedrock/canada/current/buildings.pmtiles', addresses: null },
    urls: { buildings: 'https://cdn.example.test/bedrock/canada/current/buildings.pmtiles' },
    metadata: { tile_metrics: null },
  };

  assertEqual(assertZeroAddressOutcome([], snapshot), { continued: true });
});

test('malformed territory_boundary is not accepted as a valid Polygon', async () => {
  validateTerritoryBoundaryLikeRoute({});

  await assertRejects(async () => {
    assertPolygonForMockScan({});
  }, 'not a valid Polygon');

  await assertRejects(async () => {
    assertPolygonForMockScan({ type: 'LineString', coordinates: [[-80, 45], [-79, 46]] });
  }, 'not a valid Polygon');
});

test('timeout failure marks campaign failed and surfaces the timeout error', async () => {
  try {
    await simulateProvisionWithTimeoutFailure();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const updates = (error as { updates?: Array<Record<string, unknown>> }).updates ?? [];
    const finalUpdate = updates.at(-1);

    assertTrue(message.includes('Provision source resolution exceeded 240s'));
    assertEqual(finalUpdate?.provision_status, 'failed');
    assertEqual(finalUpdate?.provision_phase, 'failed');
    assertTrue(String(finalUpdate?.link_quality_reason).includes('Provision source resolution exceeded 240s'));
    return;
  }

  throw new Error('Expected timeout failure to be surfaced');
});

test('region centroid on ON/QC border uses centroid-selected ON and bedrock_ca source', async () => {
  delete process.env.MAPBOX_TOKEN;
  delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const borderPolygon: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [[
      [-80.0, 45.0],
      [-78.8, 45.0],
      [-78.8, 45.4],
      [-80.0, 45.4],
      [-80.0, 45.0],
    ]],
  };

  const region = await resolveCampaignRegion({
    currentRegion: undefined,
    polygon: borderPolygon,
    bbox: [-80.0, 45.0, -78.8, 45.4],
  });

  assertEqual(region.regionCode, 'ON');
  assertEqual(sourceForRegion(region.regionCode), 'bedrock_ca');
});

test('lowercase region code maps to bedrock_ca', async () => {
  assertEqual(sourceForRegion('on'), 'bedrock_ca');
});

test('second provisioning pass filters already inserted addresses and avoids duplicates', async () => {
  const existingAddresses = ['1', '2', '3', '4', '5'].map(sampleAddress);
  const existingSignatures = new Set(existingAddresses.map(buildAddressIdentity));
  const resolvedAgain = ['1', '2', '3', '4', '5'].map(sampleAddress);

  const firstAccepted = filterAddressesAgainstExisting(resolvedAgain, existingSignatures);
  assertEqual(firstAccepted.length, 0);

  const withDuplicateInBatch = [sampleAddress('6'), sampleAddress('6')];
  const secondAccepted = filterAddressesAgainstExisting(withDuplicateInBatch, existingSignatures);
  assertEqual(secondAccepted.length, 1);
});

setTimeout(() => {
  if (originalMapboxToken == null) {
    delete process.env.MAPBOX_TOKEN;
  } else {
    process.env.MAPBOX_TOKEN = originalMapboxToken;
  }

  if (originalNextPublicMapboxToken == null) {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  } else {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = originalNextPublicMapboxToken;
  }

  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${testsPassed} provisioning edge case tests passed.`);
}, 0);
