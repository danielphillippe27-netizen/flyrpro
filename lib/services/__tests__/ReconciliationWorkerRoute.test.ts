import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/internal/map-reconciliation/route';
import { CampaignMapReconciliationService } from '../CampaignMapReconciliationService';

test('private worker rejects unauthenticated/invalid requests, then responds before processing', async t => {
  const settings = { CRON_SECRET: 'fixture-secret', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-key' };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => Object.entries(before).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));
  const callbacks: Array<() => Promise<void>> = [];
  const nextServer = createRequire(import.meta.url)('next/server');
  t.mock.method(nextServer, 'after', (callback: () => Promise<void>) => { callbacks.push(callback); });
  const calls: string[] = [];
  t.mock.method(CampaignMapReconciliationService.prototype, 'claimQueuedRunAndProcess', async (runId: string) => {
    calls.push(runId);
    return null;
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
  const request = (body: string, authorized = true) => new NextRequest('https://fixture.vercel.app/api/internal/map-reconciliation', {
    method: 'POST', body, headers: authorized ? { authorization: 'Bearer fixture-secret' } : {},
  });
  assert.equal((await POST(request('{}', false))).status, 401);
  assert.equal((await POST(request('invalid-json'))).status, 400);
  assert.equal((await POST(request('{"runId":"invalid"}'))).status, 400);
  assert.equal(callbacks.length, 0);
  const runId = '00000000-0000-4000-8000-000000000001';
  assert.equal((await POST(request(JSON.stringify({ runId })))).status, 202);
  assert.equal(calls.length, 0);
  assert.equal(callbacks.length, 1);
  await callbacks[0]();
  assert.deepEqual(calls, [runId]);
});
