import assert from 'node:assert/strict';
import { isVisitedCampaignAddress, isContactedCampaignAddress } from '../../campaignStats';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordFieldOutcome, outcomeCountsAsVisit } from '../FieldOutcomeService';

async function main() {
  let calls: Array<{name: string; params: Record<string, unknown>}> = [];
  let response: {data: unknown; error: null | {message: string}} = {data: {applied: true}, error: null};
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => { calls.push({name,params}); return response; },
  } as unknown as SupabaseClient;
  const edit = {campaignId:'campaign',addressIds:['B','a','a'],status:'talked',farmId:'farm',farmTouchId:'round-one',
    mutationId:'stable-id',occurredAt:'2026-11-07T12:00:00Z',baseRevisions:{a:2,b:0}};
  await recordFieldOutcome(client,edit);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'v3_record_field_outcome');
  assert.deepEqual(calls[0].params.p_campaign_address_ids,['a','b']);
  assert.equal(calls[0].params.p_farm_touch_id,'round-one');
  assert.deepEqual(calls[0].params.p_base_revisions,{a:2,b:0});
  await recordFieldOutcome(client,edit);
  assert.deepEqual(calls[0],calls[1],'Explicit retries retain the exact mutation identity and timestamp');
  response={data:{applied:false,error_code:'REVISION_CONFLICT'},error:null};
  await assert.rejects(()=>recordFieldOutcome(client,edit),/REVISION_CONFLICT/);
  assert.equal(calls.length,3,'Conflict never falls back to separate writes');
  response={data:null,error:{message:'FARM_ADDRESS_LINK_REQUIRED'}};
  await assert.rejects(()=>recordFieldOutcome(client,edit),/FARM_ADDRESS_LINK_REQUIRED/);
  const before=calls.length;
  await assert.rejects(()=>recordFieldOutcome(client,{...edit,farmTouchId:null}),/farm session/);
  assert.equal(calls.length,before,'Incomplete farm context fails before any writes');
  for(const status of ['none','do_not_knock','untouched','unknown']) assert.equal(outcomeCountsAsVisit(status),false);
  for(const status of ['no_answer','delivered','talked','appointment','future_seller','hot_lead']) assert.equal(outcomeCountsAsVisit(status),true);
  assert.equal(isVisitedCampaignAddress({address_status:'do_not_knock',visited:true}),false,'Campaign reports exclude DNC even with a stale visited flag');
  assert.equal(isVisitedCampaignAddress({address_status:'no_answer',visited:false}),true);
  assert.equal(isContactedCampaignAddress({address_status:'no_answer',visited:true}),false);
  assert.equal(isContactedCampaignAddress({address_status:'talked',visited:true}),true);
  console.log('24 field outcome service assertions passed');
}
void main();
