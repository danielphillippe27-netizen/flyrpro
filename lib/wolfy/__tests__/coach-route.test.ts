import {test}from'node:test';import assert from'node:assert/strict';import{NextRequest}from'next/server';
import{POST}from'../../../app/api/wolfy/coach/route';import{fixture,user,workspace}from'./field-fixture';
process.env.SUPABASE_URL='https://coach-test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
const request=(body:unknown={workspaceId:workspace,timezone:'UTC',mode:'brief'},token='test-user')=>new NextRequest('https://wolfgrid.app/api/wolfy/coach',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
test('field coaching route verifies scopes, reports without paid calls, caches, budget and evidence',async()=>{
 const original=globalThis.fetch;let paid=0,reserves=0,member=true,role='owner',allowed=true,badOutput=false,contextError=false,providerFailure=false,authFailure=false,cacheFailure=false,repairable=false;
 let cached:Record<string,unknown>|null=null;process.env.OPENAI_API_KEY='test-key';
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  if(url.includes('/auth/v1/user'))return authFailure?response({message:'invalid session'},401):response({id:user});
  if(url.includes('/workspace_members'))return response(member?[{workspace_id:workspace,role}]:[]);
  if(url.includes('/rpc/wolfy_field_context')){
   const b=JSON.parse(String(init?.body));const c=fixture();c.role=role;c.scope=b.p_scope;
   assert.equal(b.p_days,90);return contextError?response({message:'unavailable'},503):response(c);
  }
  if(url.includes('/rpc/wolfy_coach_reserve')){reserves++;return response(allowed);}
  if(url.includes('/wolfy_coach_cache')){if(cacheFailure)return response({message:'cache unavailable'},503);if(init?.method==='POST'){cached=JSON.parse(String(init.body));return response(null,201);}return response(cached);}
  if(url.includes('/responses')){
   paid++;if(providerFailure)throw Error('Provider unavailable');const b=JSON.parse(String(init?.body));
   assert.equal(b.model,'gpt-4.1-mini');assert.equal(b.store,false);assert.equal(b.max_output_tokens,1600);assert.equal(b.text.format.strict,true);assert.equal(b.tools,undefined);
   const e=JSON.parse(b.input).verifiedEvidence[0];const message=badOutput||repairable?'You have 999 leads.':`[[${e.id}]] Review your next step before another session.`;
   if(repairable)repairable=false;
   return response({id:'resp_test',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({message,evidence_ids:[e.id]}),annotations:[]}]}]});
  }
  throw Error('Unexpected network target: '+new URL(url).pathname);
 };
 try{
  assert.equal((await POST(request(undefined,''))).status,401);
  authFailure=true;assert.equal((await POST(request())).status,401);authFailure=false;
  member=false;assert.equal((await POST(request())).status,403);member=true;
  role='member';assert.equal((await POST(request({workspaceId:workspace,timezone:'UTC',mode:'chat',scope:'team',message:'Who needs help?'}))).status,403);role='owner';
  contextError=true;assert.equal((await POST(request())).status,503);contextError=false;assert.equal(paid,0);
  const report=await(await POST(request({workspaceId:workspace,timezone:'UTC',mode:'report'}))).json();assert.equal(report.source,'data');assert(report.analysis.facts.length>100);assert.equal(paid,0);assert.equal(reserves,0);
  const good=await(await POST(request())).json();assert.equal(good.source,'ai');assert.equal(good.destination,'followUps');assert.equal(paid,1);assert(good.evidence.length);
  assert.equal((await(await POST(request())).json()).reason,'cached');assert.equal(paid,1);assert.equal(reserves,1);
  cached=null;allowed=false;assert.equal((await(await POST(request())).json()).source,'rules');assert.equal(paid,1);allowed=true;
  badOutput=true;assert.equal((await(await POST(request())).json()).source,'rules');assert.equal(paid,3);
  providerFailure=true;assert.equal((await(await POST(request())).json()).source,'rules');assert.equal(paid,4);
  providerFailure=false;badOutput=false;cacheFailure=true;
  const uncached=await(await POST(request())).json();assert.equal(uncached.source,'ai');assert.equal(paid,5);
  cacheFailure=false;cached=null;repairable=true;const beforeRepairReserves=reserves;
  const repaired=await(await POST(request())).json();assert.equal(repaired.source,'ai');assert.equal(paid,7);assert.equal(reserves,beforeRepairReserves+1);
  delete process.env.OPENAI_API_KEY;assert.equal((await(await POST(request())).json()).source,'rules');assert.equal(paid,7);
  assert.equal((await POST(request({workspaceId:workspace,timezone:'UTC',mode:'brief',metrics:{doors:999}}))).status,400);
 }finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY;}
});
