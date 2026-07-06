/**
 * Run with: npx tsx lib/__tests__/geometryStage.test.ts
 */

import {
  pendingGeometryTileMetrics,
  withGeometryStagePrefix,
} from '../diamond/geometryStage';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
    testsPassed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    testsFailed += 1;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test('prefixes campaign artifact keys when a staging prefix is configured', () => {
  assertEqual(
    withGeometryStagePrefix('campaigns/campaign-1/buildings.pmtiles', {
      stage: 'staging',
      prefix: 'staging',
    }),
    'staging/campaigns/campaign-1/buildings.pmtiles'
  );
});

test('does not double-prefix campaign artifact keys', () => {
  assertEqual(
    withGeometryStagePrefix('staging/campaigns/campaign-1/buildings.pmtiles', {
      stage: 'staging',
      prefix: 'staging',
    }),
    'staging/campaigns/campaign-1/buildings.pmtiles'
  );
});

test('pending metrics preserve existing tile metrics and mark ready geometry stale', () => {
  const metrics = pendingGeometryTileMetrics(
    {
      buildings_key: 'campaigns/campaign-1/buildings.pmtiles',
      tile_metrics: {
        pmtiles_key: 'campaigns/campaign-1/buildings.pmtiles',
        join_key: 'address_id',
      },
    },
    {
      reason: 'campaign_territory_updated',
      source: 'campaign_patch',
    },
    {
      stage: 'staging',
      prefix: 'staging',
    }
  );

  assertEqual(metrics.join_key, 'address_id');
  assertEqual(metrics.geometry_build_status, 'pending');
  assertEqual(metrics.geometry_stage, 'staging');
  assertEqual(metrics.geometry_stage_prefix, 'staging');
  assertEqual(metrics.stale_geometry, true);
  assertEqual(metrics.geometry_build_reason, 'campaign_territory_updated');
});

if (testsFailed > 0) {
  console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
  process.exit(1);
}

console.log(`\n${testsPassed} test(s) passed.`);
