import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignMapReconciliationService } from '../CampaignMapReconciliationService';

test('reconciliation requests temporary geocodes and keeps response only in run memory', async t => {
  const beforeToken = process.env.MAPBOX_TOKEN;
  const beforeMode = process.env.MAPBOX_GEOCODING_STORAGE_MODE;
  process.env.MAPBOX_TOKEN = 'fixture-token';
  process.env.MAPBOX_GEOCODING_STORAGE_MODE = 'permanent';
  t.after(() => {
    if (beforeToken === undefined) delete process.env.MAPBOX_TOKEN; else process.env.MAPBOX_TOKEN = beforeToken;
    if (beforeMode === undefined) delete process.env.MAPBOX_GEOCODING_STORAGE_MODE; else process.env.MAPBOX_GEOCODING_STORAGE_MODE = beforeMode;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.get('permanent'), 'false');
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  });
  const db = { from() { throw new Error('temporary geocodes must not access persistent cache'); } };
  const service = new CampaignMapReconciliationService(db as never) as any;
  await service.reverseGeocode([-79.7, 43.6]);
  await service.reverseGeocode([-79.7, 43.6]);
  assert.equal(calls, 1);
  const nextRun = new CampaignMapReconciliationService(db as never) as any;
  await nextRun.reverseGeocode([-79.7, 43.6]);
  assert.equal(calls, 2);
});
