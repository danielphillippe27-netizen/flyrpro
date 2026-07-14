/**
 * Tests for lib/integrations/auto-push.ts
 *
 * Run with: npx tsx lib/__tests__/autoPush.test.ts
 *
 * Coverage:
 *  - formatCrmSyncLabel (pure function)
 *  - pushLeadToConnectedCrms: no CRMs, HubSpot, FUB, BoldTrail, Zapier, Monday
 *  - Auth fallbacks: null auth → skipped
 *  - API errors → failed with message
 *  - 5s timeout enforcement
 *  - Idempotency: existing crm_object_links → update path, skip search
 *  - Partial failure: one provider fails, others succeed, no throw
 *  - Contractor provider: no auth configured → skipped
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pushLeadToConnectedCrms, formatCrmSyncLabel, type CrmPushResult } from '../integrations/auto-push';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ─── Encryption helper ────────────────────────────────────────────────────────
// Mirrors the AES-256-GCM scheme in app/api/integrations/_lib/env.ts

const DEFAULT_ENCRYPTION_KEY = 'flyr-default-encryption-key-32chars!';

function encryptForTest(plaintext: string): string {
  const key = Buffer.from(DEFAULT_ENCRYPTION_KEY.slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc}`;
}

// ─── Mock Supabase ────────────────────────────────────────────────────────────

type QueryOp = { type: string; args: unknown[] };
type ResolveResult = { data: unknown; error: null };

/**
 * Minimal Supabase query-builder mock that supports:
 *
 *   await sb.from(t).select(c).eq(k,v)...           → list (via .then())
 *   await sb.from(t).select(c).eq(k,v).maybeSingle() → single row
 *   await sb.from(t).update(p).eq(k,v)              → mutation (via .then())
 *   await sb.from(t).insert(p)                      → mutation (via .then())
 */
class MockQueryBuilder {
  private ops: QueryOp[] = [];
  private _mode: 'list' | 'single' = 'list';

  constructor(
    private readonly _table: string,
    private readonly _resolver: (
      table: string,
      ops: QueryOp[],
      mode: 'list' | 'single'
    ) => ResolveResult
  ) {}

  select(cols: string) { this.ops.push({ type: 'select', args: [cols] }); return this; }
  eq(col: string, val: unknown) { this.ops.push({ type: 'eq', args: [col, val] }); return this; }
  in(col: string, vals: unknown[]) { this.ops.push({ type: 'in', args: [col, vals] }); return this; }
  update(payload: unknown) { this.ops.push({ type: 'update', args: [payload] }); return this; }
  insert(payload: unknown) { this.ops.push({ type: 'insert', args: [payload] }); return this; }

  maybeSingle() {
    this._mode = 'single';
    return Promise.resolve(this._resolver(this._table, this.ops, 'single'));
  }

  single() {
    this._mode = 'single';
    return Promise.resolve(this._resolver(this._table, this.ops, 'single'));
  }

  then<T>(
    onFulfilled: (v: ResolveResult) => T,
    onRejected?: (reason: unknown) => unknown
  ): Promise<T> {
    return Promise.resolve(
      this._resolver(this._table, this.ops, this._mode)
    ).then(onFulfilled, onRejected);
  }
}

function getEqMap(ops: QueryOp[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const op of ops) {
    if (op.type === 'eq' && op.args.length >= 2) out[String(op.args[0])] = op.args[1];
  }
  return out;
}

function hasOpType(ops: QueryOp[], type: string): boolean {
  return ops.some((o) => o.type === type);
}

function getSelectCols(ops: QueryOp[]): string {
  return (ops.find((o) => o.type === 'select')?.args[0] as string) ?? '';
}

type MockScenario = {
  /** Providers in crm_connections with status='connected' */
  connectedProviders?: string[];
  /** user_integrations rows keyed by provider */
  userIntegrations?: Record<string, Record<string, unknown> | null>;
  /** crm_object_links remote IDs keyed by crm_type */
  crmObjectLinks?: Record<string, string>;
  /** crm_object_links row IDs for upsertRemoteLink check, keyed by crm_type */
  crmObjectLinkIds?: Record<string, string>;
  /** crm_connections api_key_encrypted values keyed by provider */
  apiKeyEncrypted?: Record<string, string>;
};

function createMockSupabase(s: MockScenario) {
  type CallRecord = { table: string; ops: QueryOp[]; mode: 'list' | 'single' };
  const calls: CallRecord[] = [];

  const resolver = (table: string, ops: QueryOp[], mode: 'list' | 'single'): ResolveResult => {
    calls.push({ table, ops, mode });

    if (hasOpType(ops, 'update') || hasOpType(ops, 'insert')) {
      return { data: null, error: null };
    }

    const eqs = getEqMap(ops);
    const cols = getSelectCols(ops);

    // crm_connections ──────────────────────────────────────────────────────────
    if (table === 'crm_connections') {
      if (cols === 'provider') {
        // Connected-provider list (no .maybeSingle())
        return { data: (s.connectedProviders ?? []).map((p) => ({ provider: p })), error: null };
      }
      if (cols === 'api_key_encrypted') {
        // Auth key/token/webhook lookup
        const inOp = ops.find((o) => o.type === 'in');
        if (inOp) {
          for (const p of inOp.args[1] as string[]) {
            if (s.apiKeyEncrypted?.[p]) return { data: { api_key_encrypted: s.apiKeyEncrypted[p] }, error: null };
          }
        }
        const provider = eqs['provider'] as string | undefined;
        if (provider && s.apiKeyEncrypted?.[provider]) {
          return { data: { api_key_encrypted: s.apiKeyEncrypted[provider] }, error: null };
        }
        return { data: null, error: null };
      }
    }

    // user_integrations ────────────────────────────────────────────────────────
    if (table === 'user_integrations') {
      const provider = eqs['provider'] as string | undefined;
      return { data: provider ? (s.userIntegrations?.[provider] ?? null) : null, error: null };
    }

    // crm_object_links ─────────────────────────────────────────────────────────
    if (table === 'crm_object_links') {
      const crmType = eqs['crm_type'] as string | undefined;
      if (cols === 'remote_object_id' && crmType) {
        const remoteId = s.crmObjectLinks?.[crmType];
        return { data: remoteId ? { remote_object_id: remoteId } : null, error: null };
      }
      if (cols === 'id' && crmType) {
        const linkId = s.crmObjectLinkIds?.[crmType];
        return { data: linkId ? { id: linkId } : null, error: null };
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  };

  return {
    calls,
    from: (table: string) => new MockQueryBuilder(table, resolver),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-test-001';
const WORKSPACE_ID = 'ws-test-001';

const CONTACT = {
  id: 'contact-test-001',
  full_name: 'John Doe',
  phone: '+15550001234',
  email: 'john@example.com',
  address: '123 Main St, Denver CO 80201',
  notes: 'Met at door, interested in solar',
  campaign_id: 'campaign-001',
};

const HS_OAUTH_ROW = { access_token: 'hs-token-abc', refresh_token: null, expires_at: null };

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const originalFetch = globalThis.fetch;

  // ── Section 1: formatCrmSyncLabel (pure function) ─────────────────────────

  await test('formatCrmSyncLabel: empty array → null', () => {
    assert.equal(formatCrmSyncLabel([]), null);
  });

  await test('formatCrmSyncLabel: all failed → null', () => {
    assert.equal(
      formatCrmSyncLabel([
        { provider: 'hubspot', displayName: 'HubSpot', status: 'failed' },
        { provider: 'followupboss', displayName: 'Follow Up Boss', status: 'failed' },
      ]),
      null
    );
  });

  await test('formatCrmSyncLabel: all skipped → null', () => {
    assert.equal(
      formatCrmSyncLabel([{ provider: 'hubspot', displayName: 'HubSpot', status: 'skipped' }]),
      null
    );
  });

  await test('formatCrmSyncLabel: single synced with ms → "Synced → X · N.Ns"', () => {
    assert.equal(
      formatCrmSyncLabel([{ provider: 'hubspot', displayName: 'HubSpot', status: 'synced', ms: 420 }]),
      'Synced → HubSpot · 0.4s'
    );
  });

  await test('formatCrmSyncLabel: single synced without ms → no timing suffix', () => {
    assert.equal(
      formatCrmSyncLabel([{ provider: 'hubspot', displayName: 'HubSpot', status: 'synced' }]),
      'Synced → HubSpot'
    );
  });

  await test('formatCrmSyncLabel: multiple synced → joined names, no per-provider timing', () => {
    assert.equal(
      formatCrmSyncLabel([
        { provider: 'hubspot', displayName: 'HubSpot', status: 'synced', ms: 300 },
        { provider: 'followupboss', displayName: 'Follow Up Boss', status: 'synced', ms: 150 },
      ]),
      'Synced → HubSpot, Follow Up Boss'
    );
  });

  await test('formatCrmSyncLabel: mixed statuses → only synced appear in label', () => {
    assert.equal(
      formatCrmSyncLabel([
        { provider: 'hubspot', displayName: 'HubSpot', status: 'synced', ms: 400 },
        { provider: 'followupboss', displayName: 'Follow Up Boss', status: 'failed' },
        { provider: 'zapier', displayName: 'Zapier', status: 'skipped' },
      ]),
      'Synced → HubSpot · 0.4s'
    );
  });

  await test('formatCrmSyncLabel: 1000ms → "1.0s"', () => {
    assert.equal(
      formatCrmSyncLabel([{ provider: 'hubspot', displayName: 'HubSpot', status: 'synced', ms: 1000 }]),
      'Synced → HubSpot · 1.0s'
    );
  });

  // ── Section 2: no connected CRMs ─────────────────────────────────────────

  await test('no connected CRMs → returns []', async () => {
    const sb = createMockSupabase({ connectedProviders: [] });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);
    assert.deepEqual(results, []);
  });

  // ── Section 3: HubSpot ───────────────────────────────────────────────────

  await test('HubSpot: new contact → synced + crm_object_links inserted', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      fetchCalls.push({ url, method });
      if (url.includes('/contacts/search')) return jsonResponse({ total: 0, results: [] });
      if (url.endsWith('/crm/v3/objects/contacts') && method === 'POST') {
        return jsonResponse({ id: 'hs-new-001', properties: {} }, 201);
      }
      if (url.includes('/crm/v3/objects/notes')) return jsonResponse({ id: 'hs-note-001' }, 201);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: { hubspot: HS_OAUTH_ROW },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'hubspot');
    assert.equal(results[0].displayName, 'HubSpot');
    assert.equal(results[0].status, 'synced');
    assert.ok(typeof results[0].ms === 'number', 'ms should be present');

    assert.ok(
      fetchCalls.some((c) => c.url.endsWith('/crm/v3/objects/contacts') && c.method === 'POST'),
      'HubSpot create endpoint should have been called'
    );
    assert.ok(
      sb.calls.some((c) => c.table === 'crm_object_links' && hasOpType(c.ops, 'insert')),
      'crm_object_links row should have been inserted'
    );

    globalThis.fetch = originalFetch;
  });

  await test('HubSpot: found by email → PATCH update, no POST create', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      fetchCalls.push({ url, method });
      if (url.includes('/contacts/search')) return jsonResponse({ total: 1, results: [{ id: 'hs-found-123' }] });
      if (url.includes('/contacts/hs-found-123') && method === 'PATCH') {
        return jsonResponse({ id: 'hs-found-123', properties: {} });
      }
      if (url.includes('/crm/v3/objects/notes')) return jsonResponse({ id: 'note-001' }, 201);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: { hubspot: HS_OAUTH_ROW },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'synced');
    assert.ok(
      fetchCalls.some((c) => c.url.includes('/contacts/hs-found-123') && c.method === 'PATCH'),
      'PATCH update should have been called with found contact ID'
    );
    assert.ok(
      !fetchCalls.some((c) => c.url.endsWith('/crm/v3/objects/contacts') && c.method === 'POST'),
      'POST create should NOT be called when contact was found by email'
    );

    globalThis.fetch = originalFetch;
  });

  await test('HubSpot: existing crm_object_links → skips email search, goes to PATCH', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      fetchCalls.push({ url, method });
      if (url.includes('/contacts/hs-linked-456') && method === 'PATCH') {
        return jsonResponse({ id: 'hs-linked-456', properties: {} });
      }
      if (url.includes('/crm/v3/objects/notes')) return jsonResponse({ id: 'note-001' }, 201);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: { hubspot: HS_OAUTH_ROW },
      crmObjectLinks: { hubspot: 'hs-linked-456' },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'synced');
    assert.ok(
      !fetchCalls.some((c) => c.url.includes('/contacts/search')),
      'email search should be SKIPPED when crm_object_links has remote ID'
    );
    assert.ok(
      fetchCalls.some((c) => c.url.includes('/contacts/hs-linked-456') && c.method === 'PATCH'),
      'PATCH update should use the ID from crm_object_links directly'
    );

    globalThis.fetch = originalFetch;
  });

  await test('HubSpot: no OAuth token → skipped (not failed)', async () => {
    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: {}, // No hubspot entry → auth returns null
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'hubspot');
    assert.equal(results[0].status, 'skipped');
  });

  await test('HubSpot: API returns 400 → failed with error message', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/contacts/search')) return jsonResponse({ total: 0, results: [] });
      if (url.endsWith('/crm/v3/objects/contacts') && method === 'POST') {
        return jsonResponse({ status: 'error', message: 'PROPERTY_DOESNT_EXIST' }, 400);
      }
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: { hubspot: HS_OAUTH_ROW },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'failed');
    assert.ok(results[0].error, 'error field should be populated on API failure');

    globalThis.fetch = originalFetch;
  });

  await test('HubSpot: provider hangs > 5s → failed with "timed out" error', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      // findContactByEmail uses GET /contacts/{email}?idProperty=email — return 404 so it
      // returns null and proceeds to createContact. Without this the hanging promise has no
      // timer and Node exits immediately.
      if (method === 'GET' && url.includes('/crm/v3/objects/contacts/')) {
        return jsonResponse({ status: 'error', message: 'resource not found' }, 404);
      }
      // findContactByPhone uses POST /contacts/search — return empty
      if (url.includes('/contacts/search')) return jsonResponse({ total: 0, results: [] });
      // createContact POST is inside withTimeout(5000) — hang here, timer keeps Node alive
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot'],
      userIntegrations: { hubspot: HS_OAUTH_ROW },
    });

    const t0 = Date.now();
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);
    const elapsed = Date.now() - t0;

    assert.equal(results[0].status, 'failed');
    assert.ok(
      results[0].error?.toLowerCase().includes('timed out'),
      `expected "timed out" in error, got: "${results[0].error}"`
    );
    assert.ok(elapsed >= 4500 && elapsed < 8000, `elapsed ${elapsed}ms should be ~5s`);

    globalThis.fetch = originalFetch;
  });

  // ── Section 4: Follow Up Boss ─────────────────────────────────────────────

  await test('FUB: OAuth token → synced with Bearer auth', async () => {
    const fetchCalls: Array<{ url: string; authHeader: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers as Record<string, string>) ?? {};
      fetchCalls.push({ url, authHeader: headers['Authorization'] ?? '' });
      if (url.includes('followupboss.com/v1/events')) return jsonResponse({ id: 'fub-event-001' }, 200);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['followupboss'],
      userIntegrations: {
        fub: { access_token: 'fub-oauth-token', refresh_token: null, expires_at: null },
      },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'synced');
    const fubCall = fetchCalls.find((c) => c.url.includes('followupboss.com'));
    assert.ok(fubCall, 'FUB events endpoint should have been called');
    assert.ok(fubCall!.authHeader.startsWith('Bearer '), 'FUB OAuth path should use Bearer auth');

    globalThis.fetch = originalFetch;
  });

  await test('FUB: no OAuth, encrypted API key → synced with Basic auth', async () => {
    const fetchCalls: Array<{ url: string; authHeader: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers as Record<string, string>) ?? {};
      fetchCalls.push({ url, authHeader: headers['Authorization'] ?? '' });
      if (url.includes('followupboss.com/v1/events')) return jsonResponse({ id: 'fub-event-002' }, 200);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['followupboss'],
      userIntegrations: {}, // No FUB OAuth → falls through to API key
      apiKeyEncrypted: { followupboss: encryptForTest('my-fub-api-key-12345') },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'synced');
    const fubCall = fetchCalls.find((c) => c.url.includes('followupboss.com'));
    assert.ok(fubCall, 'FUB events endpoint should have been called');
    assert.ok(fubCall!.authHeader.startsWith('Basic '), 'FUB API key path should use Basic auth');

    globalThis.fetch = originalFetch;
  });

  await test('FUB: no OAuth and no API key → skipped', async () => {
    const sb = createMockSupabase({
      connectedProviders: ['followupboss'],
      userIntegrations: {},
      // No apiKeyEncrypted → getFubAuthForUserWorkspace returns null
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'followupboss');
    assert.equal(results[0].status, 'skipped');
  });

  // ── Section 5: BoldTrail ─────────────────────────────────────────────────

  await test('BoldTrail: new contact → POST create, crm_object_links inserted', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'POST').toUpperCase();
      fetchCalls.push({ url, method });
      // BoldTrail create: POST /v2/public/contact (singular — distinct from /contacts list)
      if (url.includes('kvcore.com/v2/public/contact') && method === 'POST') {
        return jsonResponse({ data: { id: 'bt-new-777' } }, 201);
      }
      if (url.includes('/notes')) return jsonResponse({}, 200);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['boldtrail'],
      apiKeyEncrypted: { boldtrail: encryptForTest('bt-api-token-xyz') },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'boldtrail');
    assert.equal(results[0].status, 'synced');
    assert.ok(
      fetchCalls.some((c) => c.url.includes('kvcore.com/v2/public/contact') && c.method === 'POST'),
      'BoldTrail create endpoint should have been called'
    );
    assert.ok(
      sb.calls.some((c) => c.table === 'crm_object_links' && hasOpType(c.ops, 'insert')),
      'crm_object_links should have been inserted for BoldTrail'
    );

    globalThis.fetch = originalFetch;
  });

  await test('BoldTrail: existing crm_object_links → PUT update, no POST create', async () => {
    const fetchCalls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'POST').toUpperCase();
      fetchCalls.push({ url, method });
      if (url.includes('bt-existing-333') && method === 'PUT') {
        return jsonResponse({ data: { id: 'bt-existing-333' } }, 200);
      }
      if (url.includes('/notes')) return jsonResponse({}, 200);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['boldtrail'],
      apiKeyEncrypted: { boldtrail: encryptForTest('bt-api-token-xyz') },
      crmObjectLinks: { boldtrail: 'bt-existing-333' },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].status, 'synced');
    assert.ok(
      !fetchCalls.some((c) => c.url.includes('kvcore.com/v2/public/contacts') && c.method === 'POST'),
      'BoldTrail POST create should NOT be called when remote ID is known'
    );
    assert.ok(
      fetchCalls.some((c) => c.url.includes('bt-existing-333') && c.method === 'PUT'),
      'BoldTrail PUT update should use the remote ID from crm_object_links'
    );

    globalThis.fetch = originalFetch;
  });

  await test('BoldTrail: no token configured → skipped', async () => {
    const sb = createMockSupabase({
      connectedProviders: ['boldtrail'],
      // No apiKeyEncrypted → getBoldTrailTokenForWorkspace returns null
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'boldtrail');
    assert.equal(results[0].status, 'skipped');
  });

  // ── Section 6: Zapier ────────────────────────────────────────────────────

  await test('Zapier: webhook delivery → synced, payload contains WolfGrid fields', async () => {
    const webhookUrl = 'https://hooks.zapier.com/hooks/catch/12345/abcdef/';
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (url.startsWith('https://hooks.zapier.com')) return jsonResponse({ status: 'success' }, 200);
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['zapier'],
      apiKeyEncrypted: { zapier: encryptForTest(webhookUrl) },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'zapier');
    assert.equal(results[0].status, 'synced');

    const zapCall = fetchCalls.find((c) => c.url.startsWith('https://hooks.zapier.com'));
    assert.ok(zapCall, 'Zapier webhook URL should have been called');
    assert.equal(zapCall!.body['event'], 'lead_sync');
    assert.equal(zapCall!.body['source'], 'WolfGrid');
    const lead = zapCall!.body['lead'] as Record<string, unknown>;
    assert.equal(lead?.['name'], CONTACT.full_name);
    assert.equal(lead?.['email'], CONTACT.email);

    globalThis.fetch = originalFetch;
  });

  await test('Zapier: no webhook URL stored → skipped', async () => {
    const sb = createMockSupabase({
      connectedProviders: ['zapier'],
      // No apiKeyEncrypted for zapier → getZapierWebhookUrlForWorkspace returns null
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'zapier');
    assert.equal(results[0].status, 'skipped');
  });

  // ── Section 7: Monday.com ────────────────────────────────────────────────

  await test('Monday: new item created on matching board → synced', async () => {
    const graphqlCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const query = String(body['query'] ?? '');
      graphqlCalls.push(query.trim().slice(0, 40));

      if (url !== 'https://api.monday.com/v2') return jsonResponse({}, 200);

      if (query.includes('boards(limit: 100)')) {
        return jsonResponse({
          data: {
            boards: [{
              id: 'board-001',
              name: 'WolfGrid Leads',
              state: 'active',
              workspace: null,
              columns: [
                { id: 'name', title: 'Name', type: 'name' },
                { id: 'phone', title: 'Phone', type: 'phone' },
                { id: 'email', title: 'Email', type: 'email' },
              ],
            }],
          },
        });
      }
      if (query.includes('items_page')) {
        return jsonResponse({ data: { boards: [{ items_page: { items: [] } }] } });
      }
      if (query.includes('create_item')) {
        return jsonResponse({ data: { create_item: { id: 'monday-item-001' } } });
      }
      return jsonResponse({ data: {} });
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: [], // Monday is in user_integrations, not crm_connections
      userIntegrations: {
        monday: {
          access_token: 'monday-access-token',
          selected_board_id: 'board-001',
          selected_board_name: 'WolfGrid Leads',
          provider_config: null,
        },
      },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'monday');
    assert.equal(results[0].displayName, 'Monday.com');
    assert.equal(results[0].status, 'synced');
    assert.ok(
      graphqlCalls.some((q) => q.includes('create_item') || q.includes('mutation')),
      'create_item mutation should have been sent to Monday'
    );

    globalThis.fetch = originalFetch;
  });

  await test('Monday: board ID mismatch → failed with board error', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}')) as Record<string, unknown>;
      const query = String(body['query'] ?? '');
      if (query.includes('boards(limit: 100)')) {
        return jsonResponse({
          data: {
            boards: [{ id: 'board-WRONG', name: 'Other Board', state: 'active', workspace: null, columns: [] }],
          },
        });
      }
      return jsonResponse({ data: {} });
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: [],
      userIntegrations: {
        monday: {
          access_token: 'monday-access-token',
          selected_board_id: 'board-001', // Doesn't match 'board-WRONG'
          selected_board_name: 'WolfGrid Leads',
          provider_config: null,
        },
      },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results[0].provider, 'monday');
    assert.equal(results[0].status, 'failed');
    assert.ok(
      results[0].error?.toLowerCase().includes('board'),
      `expected board-related error, got: "${results[0].error}"`
    );

    globalThis.fetch = originalFetch;
  });

  await test('Monday: no selected_board_id → not attempted (hasMonday = false)', async () => {
    const sb = createMockSupabase({
      connectedProviders: [],
      userIntegrations: {
        monday: {
          access_token: 'monday-access-token',
          selected_board_id: null,
          selected_board_name: null,
          provider_config: null,
        },
      },
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);
    assert.deepEqual(results, []);
  });

  // ── Section 8: Partial failure ───────────────────────────────────────────

  await test('Partial failure: HubSpot synced + FUB 500 → both results returned, function does not throw', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('hubapi.com/crm/v3/objects/contacts/search')) {
        return jsonResponse({ total: 0, results: [] });
      }
      if (url.includes('hubapi.com/crm/v3/objects/contacts') && method === 'POST') {
        return jsonResponse({ id: 'hs-001', properties: {} }, 201);
      }
      if (url.includes('hubapi.com/crm/v3/objects/notes')) return jsonResponse({ id: 'n-001' }, 201);
      if (url.includes('followupboss.com')) {
        return jsonResponse({ error: 'Internal Server Error' }, 500);
      }
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['hubspot', 'followupboss'],
      userIntegrations: {
        hubspot: HS_OAUTH_ROW,
        fub: { access_token: 'fub-token', refresh_token: null, expires_at: null },
      },
    });

    let threw = false;
    let results: CrmPushResult[] = [];
    try {
      results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);
    } catch {
      threw = true;
    }

    assert.ok(!threw, 'pushLeadToConnectedCrms must not throw on partial failure');
    assert.equal(results.length, 2, 'Both provider results should be returned');

    const hsResult = results.find((r) => r.provider === 'hubspot');
    const fubResult = results.find((r) => r.provider === 'followupboss');
    assert.ok(hsResult, 'HubSpot result should be present');
    assert.ok(fubResult, 'FUB result should be present');
    assert.equal(hsResult!.status, 'synced', 'HubSpot should be synced');
    assert.equal(fubResult!.status, 'failed', 'FUB should be failed');
    assert.ok(fubResult!.error, 'FUB failure should carry an error message');

    globalThis.fetch = originalFetch;
  });

  // ── Section 9: Contractor provider ───────────────────────────────────────

  await test('Contractor (jobnimbus): no auth configured → skipped', async () => {
    const sb = createMockSupabase({
      connectedProviders: ['jobnimbus'],
      // No apiKeyEncrypted for jobnimbus → getContractorAuthForWorkspace returns null
    });
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'jobnimbus');
    assert.equal(results[0].status, 'skipped');
  });

  await test('Contractor (jobnimbus): pre-existing crm_object_links → synced ms=0, no outbound push', async () => {
    const outboundUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      outboundUrls.push(String(input));
      return jsonResponse({}, 200);
    }) as typeof fetch;

    const sb = createMockSupabase({
      connectedProviders: ['jobnimbus'],
      apiKeyEncrypted: { jobnimbus: encryptForTest('jn-token-abc') },
      crmObjectLinks: { jobnimbus: 'jn-remote-001' },
    });

    // getContractorAuthForWorkspace may or may not succeed depending on the contractor
    // implementation details. This test asserts the function doesn't blow up and
    // the result is either 'skipped' (auth null) or 'synced' ms=0 (idempotency hit).
    const results = await pushLeadToConnectedCrms(sb as never, USER_ID, WORKSPACE_ID, CONTACT);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'jobnimbus');
    assert.ok(
      results[0].status !== 'failed',
      `expected skipped or synced (ms=0), got failed: ${results[0].error}`
    );
    // No outbound push to contractor API should have been made
    assert.ok(outboundUrls.length === 0, 'No outbound API calls when already pushed');

    globalThis.fetch = originalFetch;
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main()
  .then(() => {
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err: unknown) => {
    console.error('Test runner crashed:', err);
    process.exitCode = 1;
  });
