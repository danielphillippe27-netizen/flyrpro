const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const{build}=require('esbuild');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-annual-api-'));const homes=Array.from({length:1003},(_,i)=>({id:String(i),street_name:'Farm Street',house_number:String(i)}));
 const state={user:{id:'owner'},allowed:true,missing:false,writes:0,saved:null};global.__annualApiState=state;
 state.client={from(table){if(table==='farm_addresses'){const chain={select(){return chain},eq(){return chain},order(){return chain},async range(from,to){return{data:homes.slice(from,to+1),error:null}}};return chain;}const chain={select(){return chain},eq(){return chain},async single(){return{data:{annual_coverage_plan:state.saved},error:null}},update(data){return{async eq(){state.writes++;state.saved=data.annual_coverage_plan;return{error:null}}}}};return chain;}};
 const sources={
  'next/server':`exports.NextResponse={json:(data,init)=>new Response(JSON.stringify(data),{status:init?.status||200,headers:{'Content-Type':'application/json'}})};`,
  '@/app/api/_utils/request-user':`exports.resolveUserFromRequest=async()=>global.__annualApiState.user;`,
  '@/lib/supabase/server':`exports.createAdminClient=()=>global.__annualApiState.client;`,
  '@/app/api/farms/_utils/backingCampaign':`exports.selectFarmCampaignRow=async()=>({farm:global.__annualApiState.missing?null:{id:'f'}});exports.userCanAccessFarm=async()=>global.__annualApiState.allowed;exports.formatApiError=error=>error.message||String(error);`
 };
 await build({entryPoints:['app/api/farms/[farmId]/annual-coverage/route.ts'],outfile:path.join(temp,'route.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'route-boundaries',setup(build){build.onResolve({filter:/^(next\/server|@\/app\/api\/_utils\/request-user|@\/lib\/supabase\/server|@\/app\/api\/farms\/_utils\/backingCampaign)$/},args=>({path:args.path,namespace:'test-boundary'}));build.onLoad({filter:/.*/,namespace:'test-boundary'},args=>({contents:sources[args.path],loader:'js'}));}}]});
 const route=require(path.join(temp,'route.cjs'));const context={params:Promise.resolve({farmId:'f'})};const settings={startDate:'2026-11-02',homesPerWeek:25,weeksInPlan:52,weeksOff:[]};
 const put=body=>route.PUT(new Request('http://test/f',{method:'PUT',body:JSON.stringify(body)}),context);const get=()=>route.GET(new Request('http://test/f'),context);
 state.user=null;assert.equal((await get()).status,401);assert.equal((await put(settings)).status,401);state.user={id:'owner'};state.allowed=false;assert.equal((await put(settings)).status,403);state.allowed=true;state.missing=true;assert.equal((await get()).status,404);state.missing=false;
 assert.equal((await put({...settings,weeksInPlan:53})).status,400);assert.equal((await put({...settings,weeksOff:['2027-12-01']})).status,400);
 const short=await put({...settings,homesPerWeek:1});assert.equal(short.status,422);assert.equal((await short.json()).minimumHomesPerWeek,20);assert.equal(state.writes,0,'Invalid or inaccessible requests never write');
 const response=await put({...settings,addressIds:['forged-home'],totalHomes:1});assert.equal(response.status,200);const plan=(await response.json()).plan;assert.equal(plan.totalHomes,1003,'Server reads all canonical homes across pages and ignores client-supplied allocations');assert.equal(new Set(plan.weeks.flatMap(week=>week.addressIds)).size,1003);assert.equal(state.writes,1);
 assert.deepEqual((await(await get()).json()).plan,plan);delete global.__annualApiState;
 console.log('Annual coverage API: authentication, authorization, missing farms, invalid settings, insufficient-capacity rejection, no writes on failure, server-owned allocations, pagination and persistence responses passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
