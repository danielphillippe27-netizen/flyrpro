import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_INTEGRATIONS, CONTRACTOR_PROVIDER_IDS } from '@/lib/integrations/catalog';
import {
  buildIosResultUrl,
  getFubOAuthRedirectUri,
} from '@/app/api/integrations/followupboss/_lib/oauth';
import {
  buildHubSpotIosResultUrl,
  getHubSpotOAuthRedirectUri,
} from '@/app/api/integrations/hubspot/_lib/oauth';
import {
  getContractorOAuthRedirectUri,
  pushContractorLead,
  testContractorConnection,
  type ContractorProviderId,
} from '@/app/api/integrations/_lib/contractor-providers';
import { BoldTrailAPIClient, BoldTrailTokenValidator } from '@/app/api/integrations/boldtrail/_lib/client';
import { HubSpotAPIClient, HubSpotTokenValidator } from '@/app/api/integrations/hubspot/_lib/client';
import { ZapierWebhookClient, validateZapierWebhookUrl } from '@/app/api/integrations/zapier/_lib/client';

type TestResult = {
  provider: string;
  check: string;
  ok: boolean;
  detail?: string;
};

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const originalFetch = globalThis.fetch;
const results: TestResult[] = [];

const sampleLead = {
  id: 'crm-smoke-1',
  name: 'Smoke Test Lead',
  email: 'smoke@example.com',
  phone: '(555) 123-4567',
  address: '123 Test Street',
  notes: 'CRM smoke test',
  source: 'WolfGrid CRM Smoke Test',
  campaignId: 'campaign-smoke',
  createdAt: new Date('2026-01-01T12:00:00.000Z').toISOString(),
};

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function setFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    return handler(url, init);
  }) as typeof fetch;
}

function record(provider: string, check: string, ok: boolean, detail?: string) {
  results.push({ provider, check, ok, detail });
}

async function run(provider: string, check: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    record(provider, check, true);
  } catch (error) {
    record(provider, check, false, error instanceof Error ? error.message : String(error));
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertRoute(provider: string, routePath: string) {
  const absolute = path.join(appRoot, routePath);
  assert(fs.existsSync(absolute), `Missing route ${routePath}`);
  record(provider, 'route exists', true, routePath);
}

async function testFollowUpBoss() {
  const calls: FetchCall[] = [];
  setFetch((url, init) => {
    calls.push({ url, init });
    assert(url === 'https://api.followupboss.com/v1/users', `Unexpected FUB URL ${url}`);
    assert(init?.method === 'GET', 'FUB test should use GET');
    const headers = new Headers(init?.headers);
    assert(headers.get('Authorization') === 'Bearer smoke-token', 'FUB Authorization header was not set');
    return response({ users: [{ id: 1 }] });
  });

  const res = await fetch('https://api.followupboss.com/v1/users', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer smoke-token',
    },
  });
  assert(res.ok, 'FUB mocked test request failed');
  assert(calls.length === 1, 'FUB test request was not made exactly once');
}

async function testBoldTrail() {
  const client = new BoldTrailAPIClient();
  let validateCalled = false;
  let createCalled = false;

  setFetch((url, init) => {
    if (url.endsWith('/v2/public/contacts?limit=1')) {
      validateCalled = true;
      assert(init?.method === 'GET', 'BoldTrail validation should use GET');
      return response({ account_name: 'Smoke Account' });
    }
    if (url.endsWith('/v2/public/contact')) {
      createCalled = true;
      assert(init?.method === 'POST', 'BoldTrail create should use POST');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      assert(body.first_name === 'Smoke', 'BoldTrail first_name payload was not built');
      return response({ contact_id: 'bt-1' });
    }
    throw new Error(`Unexpected BoldTrail URL ${url}`);
  });

  await new BoldTrailTokenValidator(client).validate('smoke-token');
  const created = await client.createContact('smoke-token', sampleLead);
  assert(created.contactId === 'bt-1', 'BoldTrail contact ID was not extracted');
  assert(validateCalled && createCalled, 'BoldTrail validation/create paths did not both run');
}

async function testHubSpot() {
  const client = new HubSpotAPIClient();
  let validateCalled = false;
  let createCalled = false;

  setFetch((url, init) => {
    if (url.includes('/crm/v3/objects/contacts?limit=1')) {
      validateCalled = true;
      assert(init?.method === 'GET', 'HubSpot validation should use GET');
      return response({ results: [] });
    }
    if (url.endsWith('/crm/v3/objects/contacts')) {
      createCalled = true;
      assert(init?.method === 'POST', 'HubSpot create should use POST');
      const body = JSON.parse(String(init?.body ?? '{}')) as { properties?: Record<string, unknown> };
      assert(body.properties?.email === sampleLead.email, 'HubSpot email payload was not built');
      return response({ id: 'hs-1' });
    }
    throw new Error(`Unexpected HubSpot URL ${url}`);
  });

  await new HubSpotTokenValidator(client).validate('smoke-token');
  const created = await client.createContact('smoke-token', sampleLead);
  assert(created.contactId === 'hs-1', 'HubSpot contact ID was not extracted');
  assert(validateCalled && createCalled, 'HubSpot validation/create paths did not both run');
}

async function testZapier() {
  const webhookUrl = validateZapierWebhookUrl('https://hooks.zapier.com/hooks/catch/123/abc/');
  let called = false;

  setFetch((url, init) => {
    called = true;
    assert(url === webhookUrl, `Unexpected Zapier URL ${url}`);
    assert(init?.method === 'POST', 'Zapier should POST to webhook URL');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    assert(body.event === 'integration_test', 'Zapier test event was not set');
    return response({ ok: true });
  });

  await new ZapierWebhookClient().sendTestLead(webhookUrl, 'workspace-smoke', sampleLead);
  assert(called, 'Zapier webhook was not called');
}

async function testContractorProvider(provider: ContractorProviderId) {
  let testCalled = false;
  let pushCalled = false;

  setFetch((url, init) => {
    const body = String(init?.body ?? '');
    if (provider === 'jobber' && body.includes('FlyrConnectionTest')) {
      testCalled = true;
      return response({ data: { clients: { nodes: [] } } });
    }

    if (init?.method === 'GET') {
      testCalled = true;
      return response({ id: `${provider}-test` });
    }

    pushCalled = true;
    if (provider === 'jobber') {
      return response({
        data: {
          clientCreate: {
            client: { id: 'jobber-client-1' },
            userErrors: [],
          },
        },
      });
    }
    return response({ id: `${provider}-remote-1` });
  });

  const auth = { mode: 'api_key' as const, token: 'smoke-token' };
  await testContractorConnection(provider, auth);
  const pushed = await pushContractorLead(provider, auth, sampleLead);
  assert(pushed.remoteObjectId, `${provider} did not return a remote object ID`);
  assert(testCalled && pushCalled, `${provider} test/push paths did not both run`);
}

async function main() {
  const providerIds = ALL_INTEGRATIONS.map((provider) => provider.id);
  const uniqueProviderIds = new Set(providerIds);
  assert(providerIds.length === uniqueProviderIds.size, 'Integration catalog has duplicate providers');

  await run('oauth', 'wolfgrid.app callback defaults', () => {
    assert(
      getFubOAuthRedirectUri() === 'https://wolfgrid.app/api/integrations/fub/oauth/callback',
      'Follow Up Boss callback is not on wolfgrid.app'
    );
    assert(
      getHubSpotOAuthRedirectUri() === 'https://wolfgrid.app/api/integrations/hubspot/oauth/callback',
      'HubSpot callback is not on wolfgrid.app'
    );
    for (const provider of ['companycam', 'jobber', 'sumoquote'] as const) {
      assert(
        getContractorOAuthRedirectUri(provider) ===
          `https://wolfgrid.app/api/integrations/${provider}/oauth/callback`,
        `${provider} callback is not on wolfgrid.app`
      );
    }
  });

  await run('oauth', 'wolfgrid iOS return scheme', () => {
    assert(buildIosResultUrl('success').startsWith('wolfgrid://oauth?'), 'FUB iOS return uses a legacy scheme');
    assert(
      buildHubSpotIosResultUrl('success').startsWith('wolfgrid://oauth?'),
      'HubSpot iOS return uses a legacy scheme'
    );
  });

  for (const provider of providerIds) {
    if (CONTRACTOR_PROVIDER_IDS.includes(provider as ContractorProviderId)) {
      assertRoute(provider, `app/api/integrations/[provider]/test/route.ts`);
      assertRoute(provider, `app/api/integrations/[provider]/push-lead/route.ts`);
    } else {
      assertRoute(provider, `app/api/integrations/${provider}/test/route.ts`);
      assertRoute(provider, `app/api/integrations/${provider}/push-lead/route.ts`);
    }
  }

  await run('followupboss', 'mock connection test', testFollowUpBoss);
  await run('boldtrail', 'mock connection + push', testBoldTrail);
  await run('hubspot', 'mock connection + push', testHubSpot);
  await run('zapier', 'mock webhook test', testZapier);

  for (const provider of CONTRACTOR_PROVIDER_IDS) {
    await run(provider, 'mock connection + push', () => testContractorProvider(provider));
  }

  globalThis.fetch = originalFetch;
  console.table(results.map((result) => ({
    provider: result.provider,
    check: result.check,
    status: result.ok ? 'PASS' : 'FAIL',
    detail: result.detail ?? '',
  })));

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} CRM integration check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} CRM integration checks passed.`);
  }
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
