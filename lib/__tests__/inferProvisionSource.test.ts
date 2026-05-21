import assert from 'node:assert/strict';
import {
  inferProvisionSourceFromSnapshot,
  shouldSkipLegacyMapBundleBuildings,
  usesStaticGeometrySnapshot,
} from '@/lib/campaigns/inferProvisionSource';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`fail ${name}`);
    throw error;
  }
}

test('infers bedrock_ca from canada snapshot metrics', () => {
  const source = inferProvisionSourceFromSnapshot({
    buildings_key: 'bedrock/canada/current/buildings/buildings.pmtiles',
    tile_metrics: {
      bedrock_mode: true,
      bedrock_country_code: 'CA',
      pmtiles_key: 'bedrock/canada/current/buildings/buildings.pmtiles',
    },
  });
  assert.equal(source, 'bedrock_ca');
});

test('infers bedrock_us from texas state pmtiles path', () => {
  const source = inferProvisionSourceFromSnapshot({
    buildings_key: 'bedrock/usa/current/buildings/pmtiles_by_state/state=TX/buildings.pmtiles',
    tile_metrics: {
      bedrock_mode: true,
      bedrock_country_code: 'US',
      pmtiles_key: 'bedrock/usa/current/buildings/pmtiles_by_state/state=TX/buildings.pmtiles',
    },
  });
  assert.equal(source, 'bedrock_us');
});

test('skips legacy map bundle buildings when snapshot exists but provision_source is null', () => {
  assert.equal(
    shouldSkipLegacyMapBundleBuildings({
      provisionSource: null,
      snapshot: {
        buildings_key: 'bedrock/canada/current/buildings/buildings.pmtiles',
        tile_metrics: { bedrock_mode: true },
      },
    }),
    true
  );
});

test('does not treat empty snapshot as static geometry', () => {
  assert.equal(usesStaticGeometrySnapshot(null), false);
  assert.equal(usesStaticGeometrySnapshot({ buildings_key: null, tile_metrics: null }), false);
});
