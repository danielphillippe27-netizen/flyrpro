/**
 * Run with: npx tsx lib/__tests__/diamondGeometry.test.ts
 */

import { resolveArtifactUrl } from '../diamond/geometry';

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
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  }
}

const originalCdnEnv = {
  DIAMOND_GEOMETRY_CDN_BASE_URL: process.env.DIAMOND_GEOMETRY_CDN_BASE_URL,
  CLOUDFRONT_GEOMETRY_BASE_URL: process.env.CLOUDFRONT_GEOMETRY_BASE_URL,
  NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL: process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL,
};

function clearCdnEnv() {
  delete process.env.DIAMOND_GEOMETRY_CDN_BASE_URL;
  delete process.env.CLOUDFRONT_GEOMETRY_BASE_URL;
  delete process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL;
}

function restoreCdnEnv() {
  for (const [key, value] of Object.entries(originalCdnEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function snapshot() {
  return {
    bucket: 'flyr-pro-addresses-2025',
    prefix: 'bedrock/usa/current',
    buildings_key: 'bedrock/usa/current/buildings/pmtiles_by_state/state=FL/buildings.pmtiles',
    addresses_key: null,
    buildings_url:
      'https://d34c49t0gfk0ai.cloudfront.net/bedrock/usa/current/buildings/pmtiles_by_state/state=FL/buildings.pmtiles',
    metadata_key: null,
    buildings_count: 70,
    created_at: '2026-05-19T15:11:55.248714+00:00',
    tile_metrics: null,
  };
}

test('uses stored CloudFront buildings_url for PMTiles building artifacts', async () => {
  clearCdnEnv();

  const result = await resolveArtifactUrl(snapshot(), snapshot().buildings_key);

  assertEqual(result, snapshot().buildings_url);
});

test('lets explicit geometry CDN env override stored building artifact URL', async () => {
  clearCdnEnv();
  process.env.NEXT_PUBLIC_GEOMETRY_CDN_BASE_URL = 'https://cdn.example.test';

  const result = await resolveArtifactUrl(snapshot(), snapshot().buildings_key);

  assertEqual(
    result,
    'https://cdn.example.test/bedrock/usa/current/buildings/pmtiles_by_state/state=FL/buildings.pmtiles'
  );
});

setTimeout(() => {
  restoreCdnEnv();
  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${testsPassed} diamond geometry tests passed.`);
}, 0);
