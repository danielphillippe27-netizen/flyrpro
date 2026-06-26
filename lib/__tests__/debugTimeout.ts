import { pushLeadToConnectedCrms } from '../integrations/auto-push';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const mkSb = (providers: string[] = []) => ({
  from: (table: string) => ({
    select: (cols: string) => ({
      eq: (k: string, v: unknown) => ({
        eq: (_k2: string, _v2: unknown) => ({
          then: (fn: any) => Promise.resolve({ data: providers.map(p => ({ provider: p })), error: null }).then(fn),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          in: () => ({ then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) }),
        }),
        in: () => ({ then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    }),
    update: () => ({ eq: () => ({ eq: () => ({ then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn), in: () => ({ then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) }) }) }) }),
    insert: () => ({ then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) }),
  })
});

const CONTACT = { id: 'c1', full_name: 'Test', phone: null, email: 't@t.com', address: null, notes: null, campaign_id: null };

async function main() {
  const orig = globalThis.fetch;

  // Simulates test 14: immediate 400 response
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/contacts/search')) return jsonResponse({ total: 0, results: [] });
    return jsonResponse({ error: 'bad' }, 400);
  }) as typeof fetch;

  const r1 = await pushLeadToConnectedCrms(mkSb(['hubspot']) as any, 'u', 'w', CONTACT);
  console.log('Test A (400):', r1[0]?.status);
  globalThis.fetch = orig;
  console.log('Test A done, fetch restored.');
  console.log('About to start Test B (timeout)...');

  // Simulates test 15: hanging fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/contacts/search')) return jsonResponse({ total: 0, results: [] });
    console.log('  [B] Hanging on:', url);
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  console.log('Test B: calling pushLeadToConnectedCrms...');
  const t0 = Date.now();
  const r2 = await pushLeadToConnectedCrms(mkSb(['hubspot']) as any, 'u', 'w', CONTACT);
  const elapsed = Date.now() - t0;
  console.log(`Test B result: ${r2[0]?.status}, elapsed: ${elapsed}ms, error: ${r2[0]?.error}`);
  globalThis.fetch = orig;
  console.log('Test B done.');
}

main().then(() => { console.log('ALL DONE'); process.exit(0); }).catch(e => { console.error('CRASH:', e); process.exit(1); });
