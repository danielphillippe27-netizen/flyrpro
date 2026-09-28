import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchReconciliationRun } from '../ReconciliationDispatch';
import { CampaignMapReconciliationService } from '../CampaignMapReconciliationService';

function env(t: TestContext) {
  const keys = ['VERCEL_URL', 'CRON_SECRET', 'VERCEL_AUTOMATION_BYPASS_SECRET'];
  const before = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => {
    if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];
  }));
  process.env.VERCEL_URL = 'wolfgrid-fixture.vercel.app';
  process.env.CRON_SECRET = 'fixture-secret';
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

test('dispatch targets the deployment worker, authenticates and waits only for acceptance', async t => {
  env(t);
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'fixture-bypass';
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://wolfgrid-fixture.vercel.app/api/internal/map-reconciliation');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>).authorization, 'Bearer fixture-secret');
    assert.equal((init.headers as Record<string, string>)['x-vercel-protection-bypass'], 'fixture-bypass');
    assert.deepEqual(JSON.parse(init.body as string), { runId: 'run' });
    assert.ok(init.signal);
    return new Response(null, { status: 202 });
  });
  assert.equal(await dispatchReconciliationRun('run'), true);
});

test('missing configuration or invalid destination never sends the credential', async t => {
  env(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(); });
  for (const host of ['', 'evil.example', 'wolfgrid.vercel.app/other', 'wolfgrid.vercel.app@evil.example']) {
    process.env.VERCEL_URL = host;
    assert.equal(await dispatchReconciliationRun('run'), false);
  }
  process.env.VERCEL_URL = 'wolfgrid-fixture.vercel.app';
  delete process.env.CRON_SECRET;
  assert.equal(await dispatchReconciliationRun('run'), false);
  assert.equal(calls, 0);
});

test('dispatch timeout and rejected response leave recovery to the persisted queue', async t => {
  env(t);
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout'); });
  assert.equal(await dispatchReconciliationRun('run'), false);
  mock.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  assert.equal(await dispatchReconciliationRun('run'), false);
});

test('duplicate immediate claims only process the first untouched queued run', async t => {
  const row: Record<string, unknown> = {
    id: 'run', campaign_id: 'campaign', status: 'queued', attempt_count: 0,
    lease_owner: null, lease_expires_at: null,
  };
  const db = { from: () => {
    let patch: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const query = {
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      is: (key: string, value: unknown) => { filters[key] = value; return query; },
      select: () => query,
      maybeSingle: async () => {
        assert.deepEqual(filters, { id: 'run', status: 'queued', attempt_count: 0, lease_owner: null, lease_expires_at: null });
        const matches = Object.entries(filters).every(([key, value]) => row[key] === value);
        if (matches) Object.assign(row, patch);
        return { data: matches ? { ...row } : null, error: null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  const service = new CampaignMapReconciliationService(db);
  const process = t.mock.method(service, 'processRun', async () => {});
  const results = await Promise.all([
    service.claimQueuedRunAndProcess('run', 'worker-1'),
    service.claimQueuedRunAndProcess('run', 'worker-2'),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(process.mock.callCount(), 1);
  assert.equal(row.attempt_count, 1);
});

test('enqueue durably saves before dispatch and leaves retries/completed runs to existing recovery', async t => {
  env(t);
  const settings = {
    MAP_RECONCILIATION_MODE: 'shadow', MAP_RECONCILIATION_KILL_SWITCH: 'false',
    MAP_RECONCILIATION_CAMPAIGN_IDS: '', MAP_RECONCILIATION_COHORT_PERCENT: '100',
  };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => Object.entries(before).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));
  let saved = false, dispatched = 0;
  let status = 'queued', attempt = 0;
  const query = {
    upsert: () => query,
    select: () => query,
    maybeSingle: async () => {
      saved = true;
      return { data: { id: 'run', status, attempt_count: attempt }, error: null };
    },
  };
  const service = new CampaignMapReconciliationService({ from: () => query } as unknown as SupabaseClient);
  t.mock.method(globalThis, 'fetch', async () => {
    assert.equal(saved, true);
    dispatched++;
    return new Response(null, { status: 202 });
  });
  await service.enqueue('campaign', 'signature');
  assert.equal(dispatched, 1);
  attempt = 1;
  await service.enqueue('campaign', 'signature');
  status = 'completed'; attempt = 0;
  await service.enqueue('campaign', 'signature');
  assert.equal(dispatched, 1);
});
