const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('app/api/campaigns/[campaignId]/addresses/manual/route.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const house = { id: 'durham_buildings:261174', properties: {} };
let allowed = true, known = true, rpcCalls = [], bundleReads = 0;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  from(table) {
    assert.equal(table, 'buildings', 'No legacy insert, null-row link, or geometry invalidation');
    const q = { select: () => q, limit: () => q, eq: () => q, or: () => q,
      maybeSingle: async () => ({ data: null, error: null }) };
    return q;
  },
  async rpc(name, params) {
    rpcCalls.push({ name, params });
    return { data: { applied: true, canonical_state: { id: params.p_campaign_address_id }, revision: 1 } };
  },
};
const moduleObject = { exports: {} };
const mocks = {
  '@/lib/services/CanonicalTileArtifacts': { readCanonicalTileBundle: async () => { bundleReads++; return { records: { buildings: known ? [house] : [] } }; } },
  '@/lib/map/fieldBuildingLocation': {
    isAutomaticBuildingLocation: p => p.startsWith('field_building_'),
    findFieldBuilding: (records, id) => records.find(r => r.id === id) ?? null,
  },
  '@supabase/supabase-js': { createClient: () => client },
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/app/api/campaigns/_utils/access': { ensureCampaignAccess: async () => allowed },
  '../_utils/addressIdentity': { normalizedAddressIdentity: () => { throw Error('Offline UUID must use canonical mutation'); } },
};
vm.runInNewContext(code, { exports: moduleObject.exports, require: name => mocks[name] ?? require(name),
  process, console, URL, Response, Request });
const id = '989cf35d-bfb7-491b-a0dc-39e9900bc988';
async function send(provenance, pinId = id) {
  return moduleObject.exports.POST(new Request('https://example.test/api/manual', {
    method: 'POST', headers: { authorization: 'Bearer test-only' },
    body: JSON.stringify({ id: pinId, building_id: house.id, address_provenance: provenance,
      longitude: -78.65, latitude: 43.9, formatted: '139 Yacht Drive', client_mutation_id: 'original-mutation' }),
  }), { params: Promise.resolve({ campaignId: 'campaign' }) });
}
(async () => {
  for (const p of ['manual', 'mapbox_reverse_geocode', '', 'field_manual_pin', 'field_building_location']) {
    const response = await send(p); assert.equal(response.status, 200);
    assert.equal((await response.json()).address.id, id);
    const call = rpcCalls.at(-1); assert.equal(call.name, 'v2_create_campaign_manual_pin');
    assert.equal(call.params.p_building_gers_id, house.id);
    assert.equal(call.params.p_campaign_address_id, id);
    assert.equal(call.params.p_client_mutation_id, 'original-mutation');
  }
  assert.equal((await send('manual', 'invalid-id')).status, 400);
  known = false; assert.equal((await send('manual')).status, 404);
  allowed = false; const before = bundleReads;
  assert.equal((await send('manual')).status, 403); assert.equal(bundleReads, before);
  assert.equal(rpcCalls.length, 5);
  console.log('PASS: older iOS provenance accepts campaign tile buildings, retains offline UUID/mutation, preserves geometry, rejects unknown building/invalid UUID/unauthorized campaign');
})().catch(e => { console.error(e); process.exitCode = 1; });
