/**
 * Tests for campaign_contacts consolidation (PR39)
 *
 * Run with: NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test npx tsx lib/__tests__/campaignContactsConsolidation.test.ts
 *
 * Coverage:
 *  1. deriveCampaignStats — accepts Contact[] (not just CampaignContact[]), counts correctly
 *  2. CampaignsService — removed write methods no longer exist
 *  3. CampaignsService — no campaign_contacts table writes remain
 *  4. ContactsService.fetchContacts — applies campaignId filter to contacts table
 *  5. ContactsService.fetchContacts — does NOT touch campaign_contacts
 *  6. ContactsService.deleteContact — goes to contacts table, not campaign_contacts
 *  7. Graceful: empty contacts array → stats.contacts === 0
 *  8. Graceful: deriveCampaignStats with mixed contact shapes (superset fields)
 */

// Stub Supabase env vars before any service static initializers run
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

import assert from 'node:assert/strict';
import { deriveCampaignStats } from '../campaignStats';
import { CampaignsService } from '../services/CampaignsService';
import { ContactsService } from '../services/ContactsService';
import type { CampaignAddress } from '@/types/database';

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAddress(overrides: Partial<CampaignAddress> = {}): CampaignAddress {
  return {
    id: 'addr-1',
    campaign_id: 'camp-1',
    address: '123 Main St',
    address_status: null,
    visited: false,
    scans: 0,
    last_scanned_at: null,
    ...overrides,
  } as CampaignAddress;
}

// Minimal Contact shape (from types/database.ts Contact interface)
function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    user_id: 'u-1',
    full_name: 'Jane Doe',
    phone: '555-1234',
    email: 'jane@example.com',
    address: '123 Main St',
    workspace_id: 'ws-1',
    campaign_id: 'camp-1',
    status: 'new',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Mock Supabase client ─────────────────────────────────────────────────────

type QueryCall = { table: string; ops: Array<{ type: string; args: unknown[] }> };

function makeMockClient(resolveWith: unknown[] = []) {
  const calls: QueryCall[] = [];

  const makeBuilder = (table: string) => {
    const ops: Array<{ type: string; args: unknown[] }> = [];
    calls.push({ table, ops });

    const builder: Record<string, unknown> = {
      select: (c: string) => { ops.push({ type: 'select', args: [c] }); return builder; },
      eq: (k: string, v: unknown) => { ops.push({ type: 'eq', args: [k, v] }); return builder; },
      in: (k: string, v: unknown) => { ops.push({ type: 'in', args: [k, v] }); return builder; },
      update: (p: unknown) => { ops.push({ type: 'update', args: [p] }); return builder; },
      insert: (p: unknown) => { ops.push({ type: 'insert', args: [p] }); return builder; },
      delete: () => { ops.push({ type: 'delete', args: [] }); return builder; },
      order: (_col: string) => builder,
      range: (_from: number, _to: number) => builder,
      single: () => Promise.resolve({ data: resolveWith[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: resolveWith[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: resolveWith, error: null })),
    };
    return builder;
  };

  return {
    from: (table: string) => makeBuilder(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    calls,
  };
}

// Inject mock into a service's private static client
function injectClient(Service: { prototype: unknown }, mockClient: unknown) {
  (Service as unknown as Record<string, unknown>)['client'] = mockClient;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

async function main() {

// ─── 1. deriveCampaignStats: pure function ────────────────────────────────────

await test('deriveCampaignStats: empty inputs → all zeros', () => {
  const stats = deriveCampaignStats([], []);
  assert.equal(stats.contacts, 0);
  assert.equal(stats.addresses, 0);
  assert.equal(stats.visited, 0);
  assert.equal(stats.contacted, 0);
  assert.equal(stats.scanned, 0);
  assert.equal(stats.scan_rate, 0);
  assert.equal(stats.progress_pct, 0);
});

await test('deriveCampaignStats: counts Contact[] length correctly', () => {
  const contacts = [makeContact(), makeContact({ id: 'c-2' }), makeContact({ id: 'c-3' })];
  const stats = deriveCampaignStats([], contacts);
  assert.equal(stats.contacts, 3);
});

await test('deriveCampaignStats: accepts superset Contact fields without throwing', () => {
  // Contact has full_name, status, workspace_id — none of which CampaignContact had
  const contacts = [
    makeContact({ full_name: 'Alice', status: 'appointment', workspace_id: 'ws-99' }),
  ];
  assert.doesNotThrow(() => deriveCampaignStats([], contacts));
  assert.equal(deriveCampaignStats([], contacts).contacts, 1);
});

await test('deriveCampaignStats: counts visited addresses correctly', () => {
  const addresses = [
    makeAddress({ address_status: 'talked' }),   // visited + contacted
    makeAddress({ address_status: 'not_home' }), // visited only
    makeAddress({ address_status: null }),        // not visited
  ];
  const stats = deriveCampaignStats(addresses, []);
  assert.equal(stats.addresses, 3);
  assert.equal(stats.visited, 2);
  assert.equal(stats.contacted, 2); // both talked and not_home are "contacted" (VISITED_STATUSES)
});

await test('deriveCampaignStats: scan_rate and progress_pct are percentages 0-100', () => {
  const addresses = [
    makeAddress({ scans: 2 }),  // scanned + visited=false → not visited
    makeAddress({ address_status: 'talked', scans: 0 }),
  ];
  const stats = deriveCampaignStats(addresses, []);
  assert.ok(stats.scan_rate >= 0 && stats.scan_rate <= 100, `scan_rate out of range: ${stats.scan_rate}`);
  assert.ok(stats.progress_pct >= 0 && stats.progress_pct <= 100, `progress_pct out of range: ${stats.progress_pct}`);
  assert.equal(stats.scanned, 1);
  assert.equal(stats.scan_rate, 50);
});

// ─── 2. CampaignsService: removed methods do not exist ───────────────────────

await test('CampaignsService: fetchCampaignContacts does not exist', () => {
  assert.equal(
    typeof (CampaignsService as unknown as Record<string, unknown>)['fetchCampaignContacts'],
    'undefined',
    'fetchCampaignContacts should have been removed'
  );
});

await test('CampaignsService: createCampaignContact does not exist', () => {
  assert.equal(
    typeof (CampaignsService as unknown as Record<string, unknown>)['createCampaignContact'],
    'undefined',
    'createCampaignContact should have been removed'
  );
});

await test('CampaignsService: updateCampaignContact does not exist', () => {
  assert.equal(
    typeof (CampaignsService as unknown as Record<string, unknown>)['updateCampaignContact'],
    'undefined',
    'updateCampaignContact should have been removed'
  );
});

await test('CampaignsService: deleteCampaignContact does not exist', () => {
  assert.equal(
    typeof (CampaignsService as unknown as Record<string, unknown>)['deleteCampaignContact'],
    'undefined',
    'deleteCampaignContact should have been removed'
  );
});

// ─── 3. CampaignsService: no campaign_contacts writes remain ─────────────────

await test('CampaignsService source: no writes to campaign_contacts table', async () => {
  // Read the source file and verify no insert/update/delete against campaign_contacts
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(
    new URL('../services/CampaignsService.ts', import.meta.url),
    'utf8'
  );
  // Reads are fine (e.g. legacy queries); writes are the concern
  const writePattern = /\.from\(['"]campaign_contacts['"]\)[\s\S]{0,200}?\.(insert|update|delete)\(/;
  assert.ok(
    !writePattern.test(src),
    'CampaignsService still contains a write to campaign_contacts'
  );
});

// ─── 4. ContactsService.fetchContacts: queries contacts, not campaign_contacts ─

await test('ContactsService.fetchContacts: queries contacts table with campaignId filter', async () => {
  const mock = makeMockClient([makeContact()]);
  injectClient(ContactsService, mock);

  await ContactsService.fetchContacts('u-1', 'ws-1', { campaignId: 'camp-1' });

  const contactsCalls = mock.calls.filter((c) => c.table === 'contacts');
  assert.ok(contactsCalls.length > 0, 'Expected at least one query to contacts table');

  const hasCampaignIdFilter = contactsCalls.some((call) =>
    call.ops.some((op) => op.type === 'eq' && op.args[0] === 'campaign_id' && op.args[1] === 'camp-1')
  );
  assert.ok(hasCampaignIdFilter, 'Expected campaign_id eq filter on contacts query');
});

await test('ContactsService.fetchContacts: does not touch campaign_contacts table', async () => {
  const mock = makeMockClient([makeContact()]);
  injectClient(ContactsService, mock);

  await ContactsService.fetchContacts('u-1', 'ws-1', { campaignId: 'camp-1' });

  const badCalls = mock.calls.filter((c) => c.table === 'campaign_contacts');
  assert.equal(badCalls.length, 0, `Expected no queries to campaign_contacts, got ${badCalls.length}`);
});

await test('ContactsService.fetchContacts: applies workspaceId filter', async () => {
  const mock = makeMockClient([makeContact()]);
  injectClient(ContactsService, mock);

  await ContactsService.fetchContacts('u-1', 'ws-42', { campaignId: 'camp-1' });

  const contactsCalls = mock.calls.filter((c) => c.table === 'contacts');
  const hasWorkspaceFilter = contactsCalls.some((call) =>
    call.ops.some((op) => op.type === 'eq' && op.args[0] === 'workspace_id' && op.args[1] === 'ws-42')
  );
  assert.ok(hasWorkspaceFilter, 'Expected workspace_id eq filter on contacts query');
});

await test('ContactsService.fetchContacts: applies user and workspace filters to every lead source', async () => {
  const mock = makeMockClient([makeContact()]);
  injectClient(ContactsService, mock);

  await ContactsService.fetchContacts('u-1', 'ws-42');

  for (const table of ['contacts', 'field_leads']) {
    const calls = mock.calls.filter((call) => call.table === table);
    assert.ok(calls.length > 0, `Expected a query to ${table}`);
    assert.ok(
      calls.some((call) =>
        call.ops.some((op) => op.type === 'eq' && op.args[0] === 'user_id' && op.args[1] === 'u-1')
      ),
      `Expected user_id eq filter on ${table}`
    );
    assert.ok(
      calls.some((call) =>
        call.ops.some((op) => op.type === 'eq' && op.args[0] === 'workspace_id' && op.args[1] === 'ws-42')
      ),
      `Expected workspace_id eq filter on ${table}`
    );
  }
});

await test('ContactsService.fetchContacts: returns empty array on empty result', async () => {
  const mock = makeMockClient([]);
  injectClient(ContactsService, mock);

  const result = await ContactsService.fetchContacts('u-1', 'ws-1', { campaignId: 'camp-1' });
  assert.deepEqual(result, []);
});

// ─── 5. ContactsService.deleteContact: targets contacts, not campaign_contacts ─

await test('ContactsService.deleteContact: deletes from contacts table', async () => {
  const mock = makeMockClient([]);
  injectClient(ContactsService, mock);

  await ContactsService.deleteContact('contact-id-123');

  const deleteCalls = mock.calls.filter(
    (c) => c.table === 'contacts' && c.ops.some((op) => op.type === 'delete')
  );
  assert.ok(deleteCalls.length > 0, 'Expected a delete call on contacts table');
});

await test('ContactsService.deleteContact: does not touch campaign_contacts', async () => {
  const mock = makeMockClient([]);
  injectClient(ContactsService, mock);

  await ContactsService.deleteContact('contact-id-123');

  const badCalls = mock.calls.filter(
    (c) => c.table === 'campaign_contacts' && c.ops.some((op) => op.type === 'delete')
  );
  assert.equal(badCalls.length, 0, 'deleteContact should not touch campaign_contacts');
});

} // end main

// ─── Run ──────────────────────────────────────────────────────────────────────

main()
  .then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err: unknown) => {
    console.error('Test runner crashed:', err);
    process.exitCode = 1;
  });
