import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CampaignAddressEnrichmentService, type EnrichmentTarget } from '../CampaignAddressEnrichmentService';

const target: EnrichmentTarget = {
  address_resolution_permanent_allowed: true,
  id: 'existing-visited-stop', campaign_id: 'campaign', region: 'WA', address_resolution_lease: 'owned-lease',
  geometry_target_geom: { type: 'Polygon', coordinates: [[[-124.4,47.95],[-124.39,47.95],[-124.39,47.96],[-124.4,47.96],[-124.4,47.95]]] },
};
function setup(t: TestContext) {
  const settings = { MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE: 'true', MAPBOX_GEOCODING_STORAGE_MODE: 'permanent', MAPBOX_TOKEN: 'fixture-token', MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN: '24' };
  const prior = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key,value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({name,args});
    return { data: name === 'claim_campaign_address_enrichment' ? [target] : Boolean(args.p_result), error: null };
  } } as unknown as SupabaseClient;
  return { service: new CampaignAddressEnrichmentService(db), calls };
}
test('worker confirms the existing leased stop and uses permanent provider results', async t => {
  const {service,calls} = setup(t);
  t.mock.method(globalThis,'fetch',async (url: URL) => {
    assert.equal(url.searchParams.get('permanent'),'true');
    return Response.json({features:[{geometry:{type:'Point',coordinates:[-124.395,47.955]},properties:{
      address_number:'111',street_name:'Wood St',coordinates:{accuracy:'rooftop',longitude:-124.395,latitude:47.955},
      context:{region:{region_code:'WA'},country:{country_code:'US'},place:{name:'Forks'}},
    }}]});
  });
  const result=await service.processBatch();
  assert.equal(result.confirmed,1);
  assert.equal(calls[1].name,'finish_campaign_address_enrichment');
  assert.equal(calls[1].args.p_address_id,target.id);
  assert.equal(calls[1].args.p_lease,target.address_resolution_lease);
  assert.equal((calls[1].args.p_result as Record<string,unknown>).house_number,'111');
});
test('provider rate limiting releases the stop for a bounded retry', async t => {
  const {service,calls}=setup(t);
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429}));
  await service.processBatch();
  assert.equal(calls[1].args.p_retry,true);
  assert.equal(calls[1].args.p_result,null);
});
test('temporary geocoding configuration never claims or persists enrichment work', async t => {
  const {service,calls}=setup(t);
  process.env.MAPBOX_GEOCODING_STORAGE_MODE='temporary';
  const result=await service.processBatch();
  assert.equal(result.claimed,0); assert.equal(calls.length,0);
});


test('a noneligible target cannot make a paid provider request', async t => {
 const {service}=setup(t);const prior=target.address_resolution_permanent_allowed;target.address_resolution_permanent_allowed=false;
 t.after(()=>{target.address_resolution_permanent_allowed=prior;});let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({});});
 await service.processBatch();assert.equal(calls,0);
});
