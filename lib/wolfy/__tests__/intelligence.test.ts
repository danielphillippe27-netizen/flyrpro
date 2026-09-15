import {test}from'node:test';import assert from'node:assert/strict';
import{analyze,fieldContextSchema,selectEvidence,groundedReply}from'../intelligence';import{fixture,user,rep,campaign}from'./field-fixture';
const find=(id:string)=>analyze(fixture()).facts.find(f=>f.id===id)!;
test('today, complete-day comparisons and rates have distinct periods',()=>{
 assert.equal(find('scope.today.doors').value,'42');assert.equal(find('scope.last7.doors').value,'100');assert.equal(find('scope.previous7.doors').value,'50');
 assert.equal(find('scope.last7_change.doors_change').value,'100.00');assert.equal(find('scope.last7.conversation_rate').value,'20.00');
 assert.equal(find('scope.last7.task_completion_rate').value,'66.67');
 assert.equal(find('scope.last7.lead_sale_conversion').value,'25.00');
 assert.equal(find('scope.last7.average_sale_days').value,'5.00');
});
test('money stays exact and missing sources are not zero',()=>{
 assert.equal(find('scope.today.revenue_minor').display,'CAD 9,007,199,254,740,993.00');
 assert.equal(find('scope.today.qr_scans').value,null);assert.equal(find('scope.today.active_seconds').value,'0.00');
 assert.equal(find('scope.today.doors_per_hour').value,null);
});
test('zero baseline has no fabricated growth percentage',()=>{
 const c=fixture();c.rows=c.rows.filter(r=>r.day!=='2026-09-07');
 assert.equal(analyze(c).facts.find(f=>f.id==='scope.last7_change.doors_change')?.value,null);
});
test('team includes inactive reps, equal ranks, alerts and territory attribution',()=>{
 const c=fixture();c.scope='team';c.people.push({id:rep,name:'Jake'});
 c.rows.push({rep,campaign,day:'2026-09-14',values:{doors:'100',conversations:'22',leads:'0'}});
 const a=analyze(c);
 assert(a.alerts.some(x=>x.group==='rep_'+rep&&x.reason.includes('qualification')));
 assert.equal(a.facts.find(f=>f.id===`rep_${rep}.ranking.door_rank`)?.value,'1');
 assert.equal(a.facts.find(f=>f.id===`rep_${user}.ranking.door_rank`)?.value,'1');
 assert(a.groups.some(g=>g.id==='campaign_'+campaign));
 assert(selectEvidence(a,'Who needs help on my team?','chat').some(f=>f.id===`rep_${rep}.last7.conversations`));
});
test('grounded replies replace evidence tokens and preserve meaning labels',()=>{
 const a=analyze(fixture()),e=selectEvidence(a,'How many doors today?','chat');const f=e.find(f=>f.id==='scope.today.doors')!;
 const reply=groundedReply(JSON.stringify({message:`[[${f.id}]] Keep going in your current territory.`}),e,'chat');
 assert.match(reply.message,/Doors visited: 42 \(Today/);assert.equal(reply.evidence[0].id,f.id);
 for(const message of ['You have 999 leads.','You have three leads.','[[scope.today.fake]] Keep going.','I credited your XP. [[scope.today.doors]]','Use https://bad.test [[scope.today.doors]]'])assert.throws(()=>groundedReply(JSON.stringify({message}),e,'chat'));
});
test('null denominators, source failure, unknown metric values fail safely',()=>{
 const c=fixture();c.available=c.available.filter(x=>x!=='sales');c.unavailable.push('sales');const a=analyze(c);
 assert.equal(a.facts.find(f=>f.id==='scope.today.verified_sales')?.value,null);
 assert.equal(a.facts.find(f=>f.id==='scope.today.sales_per_100_doors')?.value,null);
 assert.equal(fieldContextSchema.safeParse({...c,rows:[{rep:user,campaign:null,day:null,values:{doors:'NaN'}}]}).success,false);
});

test('missing goals stay unavailable and custom pipeline values stay exact',()=>{
 const c=fixture();c.goals=[];c.stage_defs=[{key:'quote',label:'Quote sent',probability:50,kind:'open'}];c.available.push('stages');
 c.rows.push({rep:user,campaign,day:null,values:{stage_count_quote:'2',stage_value_quote:'18000000000000000'}});
 const a=analyze(c);
 assert.equal(a.facts.find(f=>f.id==='scope.current.daily_goal')?.value,null);
 assert.equal(a.facts.find(f=>f.id==='scope.current.monthly_sales_goal')?.value,null);
 assert.equal(a.facts.find(f=>f.id==='scope.current.stage_value_quote')?.display,'CAD 180,000,000,000,000.00');
});
test('territory ranking requires a denominator and retrieves the leaders evidence',()=>{
 const a=analyze(fixture());
 assert.equal(a.facts.find(f=>f.id===`campaign_${campaign}.ranking.conversation_rank`)?.value,'1');
 const evidence=selectEvidence(a,'Which territory performs best?','chat');
 assert(evidence.some(f=>f.id===`campaign_${campaign}.last7.conversation_rate`));
});
