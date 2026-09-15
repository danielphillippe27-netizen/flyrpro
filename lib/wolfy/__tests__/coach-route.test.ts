import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/wolfy/coach/route';
import { fingerprint } from '../coach';
const user='00000000-0000-4000-8000-000000000001',workspace='00000000-0000-4000-8000-000000000002';
const facts={metrics:{doors:3,conversations:1,leads:0,appointments:0,weekly_doors:3},goals:{daily:10,weekly:50},days_remaining:4,overdue:1,upcoming:0,as_of:new Date().toISOString(),local_day:'2026-09-15'};
process.env.SUPABASE_URL='https://coach-test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
function request(body:unknown={workspaceId:workspace,timezone:'UTC',mode:'brief'}, token='test-user') {
 return new NextRequest('https://wolfgrid.app/api/wolfy/coach',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
}
test('authenticated route, provider contract, caches, budgets and fallback',async () => {
 const original=globalThis.fetch;
 let paid=0,reserves=0,member=true,allowed=true,badOutput=false,contextError=false,cached=false,providerFailure=false,authFailure=false;
 process.env.OPENAI_API_KEY='test-key';
 globalThis.fetch=async (input,init) => {
  const url=String(input instanceof Request?input.url:input);
  const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(url.includes('/auth/v1/user')) return authFailure ? response({message:'invalid session'},401) : response({id:user,email:'private@example.test'});
  if(url.includes('/workspace_members')) return response(member?[{workspace_id:workspace}]:[]);
  if(url.includes('/rpc/wolfy_coach_context')) return contextError?response({message:'unavailable'},503):response(facts);
  if(url.includes('/rpc/wolfy_coach_reserve')){reserves++;return response(allowed);}
  if(url.includes('/wolfy_coach_cache')) {
   if(init?.method==='POST') return response(null,201);
   return response(cached?{fingerprint:fingerprint(facts),message:'Review your follow-ups before starting another session.',generated_at:new Date().toISOString()}:null);
  }
  if(url.includes('/responses')) {
   paid++;if(providerFailure) throw new Error('Provider unavailable');const body=JSON.parse(String(init?.body));
   assert.equal(body.model,'gpt-5-nano');assert.equal(body.store,false);assert.equal(body.max_output_tokens,1000);
   assert.equal(body.text.format.strict,true);assert.equal(body.tools,undefined);
   return response({id:'resp_test',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({message:badOutput?'You have 999 leads.':'Review your follow-ups before starting another session.'}),annotations:[]}]}]});
  }
  throw new Error('Unexpected network target: '+new URL(url).pathname);
 };
 try {
  assert.equal((await POST(request(undefined,''))).status,401);
  authFailure=true;assert.equal((await POST(request())).status,401);assert.equal(paid,0);authFailure=false;
  member=false;assert.equal((await POST(request())).status,403);assert.equal(paid,0);member=true;
  contextError=true;assert.equal((await POST(request())).status,503);assert.equal(paid,0);contextError=false;
  const good=await (await POST(request())).json();assert.equal(good.source,'ai');assert.equal(good.destination,'followUps');assert.equal(paid,1);
  cached=true;assert.equal((await (await POST(request())).json()).reason,'cached');assert.equal(paid,1);assert.equal(reserves,1);cached=false;
  allowed=false;assert.equal((await (await POST(request())).json()).source,'rules');assert.equal(paid,1);allowed=true;
  badOutput=true;assert.equal((await (await POST(request())).json()).source,'rules');assert.equal(paid,2);
  providerFailure=true;assert.equal((await (await POST(request())).json()).source,'rules');assert.equal(paid,3);
  delete process.env.OPENAI_API_KEY;assert.equal((await (await POST(request())).json()).source,'rules');assert.equal(paid,3);
  assert.equal((await POST(request({workspaceId:workspace,timezone:'UTC',mode:'brief',metrics:{doors:999}}))).status,400);
 } finally {globalThis.fetch=original;delete process.env.OPENAI_API_KEY;}
});
