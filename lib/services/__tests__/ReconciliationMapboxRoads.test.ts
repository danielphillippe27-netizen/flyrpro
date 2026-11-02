import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReconciliationMapboxRoads } from '../ReconciliationMapboxRoads';
const point = (x: number, y: number): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: {} });
test('road lookup skips missing token and caps geographically broad campaigns', async () => {
  assert.deepEqual(await loadReconciliationMapboxRoads([point(-79.7, 43.6)], ''), []);
  await assert.rejects(loadReconciliationMapboxRoads([point(-79, 43), point(-75, 46)], 'test'), /tile limit/);
});
test('road tile errors are surfaced without leaking the token', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(loadReconciliationMapboxRoads([point(-79.7, 43.6)], 'private-token'), error => {
    assert.match(String(error), /403/); assert.doesNotMatch(String(error), /private-token/); return true;
  });
});
