import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root = process.cwd();
const dir = await mkdtemp(`${root}/node_modules/.cache/campaign-engagement-`);
const require = createRequire(`${root}/package.json`);
const id = n => `abcdefab-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  await build({entryPoints:['lib/cards/campaign-engagement.ts'],outfile:`${dir}/summary.cjs`,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const { campaignEngagement, cardActivityCounter } = require(`${dir}/summary.cjs`);
  const counter=cardActivityCounter();
  const event=(share,visit,type)=>({share_id:share,visit_id:visit,event_type:type});
  counter.add(event('a','one','qualified_open'));
  counter.add(event('a','one','website_clicked'));
  counter.add(event('a','one','website_clicked'));
  counter.add(event('a','one','contact_downloaded'));
  counter.add(event('a','two','qualified_open'));
  counter.add(event('b','two','qualified_open'));
  counter.add(event('a','three','contact_downloaded'));
  counter.add(event('a','three','qualified_open'));
  counter.add(event('a','four','composer_sent'));
  assert.deepEqual(counter.totals(),{opens:2,clicks:2,downloads:2});
  assert.deepEqual(cardActivityCounter().totals(),{opens:0,clicks:0,downloads:0});
  const addresses=[{id:'a',key:'house',scans:3},{id:'duplicate',key:'house'},{id:'b',key:'unit 2'},{id:'c',key:'unit 3'}];
  const cards=[{address_id:'duplicate',shares:2,opens:3,clicks:2,downloads:1},{address_id:'b',shares:1,opens:0,clicks:0,downloads:1},{address_id:'outside',shares:1,opens:10,clicks:1,downloads:0}];
  const result=campaignEngagement(addresses,cards,a=>a.key);
  assert.equal(result.engaged,2);assert.equal(result.rate,67);assert.equal(result.byAddress.get('house').downloads,1);
  assert.equal(campaignEngagement([],cards,a=>a.id).rate,0);
  assert.equal(campaignEngagement([{id:'a'}],[{address_id:'a',shares:1,opens:0,clicks:0,downloads:0}],a=>a.id).rate,0);
  await writeFile(`${dir}/navigation.ts`, 'export function useRouter(){return {refresh(){}}}');
  await writeFile(`${dir}/client.ts`, 'export function createClient(){return {}}');
  await build({entryPoints:['components/RecipientsTable.tsx','components/StatsHeader.tsx'],outdir:dir,bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},packages:'external',jsx:'automatic',alias:{'next/navigation':`${dir}/navigation.ts`,'@/lib/supabase/client':`${dir}/client.ts`},logLevel:'silent'});
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const {RecipientsTable}=require(`${dir}/RecipientsTable.cjs`);const {StatsHeader}=require(`${dir}/StatsHeader.cjs`);
  const recipient={id:'a',address_line:'12 Main Street',status:'none',cardEngagement:cards[0],qr_code_base64:null,contacts:[]};
  const markup=renderToStaticMarkup(React.createElement(RecipientsTable,{recipients:[recipient],campaignId:'campaign'}));
  assert(markup.indexOf('QR Code')<markup.indexOf('Business Card'));
  for(const text of ['Opened','Clicked','Downloaded'])assert(markup.includes(text));
  const failedMarkup=renderToStaticMarkup(React.createElement(RecipientsTable,{recipients:[recipient],campaignId:'campaign',cardActivityState:'error'}));
  assert(failedMarkup.includes('Unavailable'));assert(!failedMarkup.includes('Downloaded'));
  const statsMarkup=renderToStaticMarkup(React.createElement(StatsHeader,{stats:{addresses:3,contacts:1,visited:1,scan_rate:33,scanned:1},engagement:{scans:8,opens:2,clicks:3,downloads:1}}));
  assert(statsMarkup.includes('Clicks &amp; Scans'));assert(statsMarkup.includes('>14</div>'));
  for(const text of ['8 QR scans','2 Card opens','3 Button clicks','1 Downloads'])assert(statsMarkup.includes(text));
  assert(!statsMarkup.includes('Click Rate'));
  const loadingStats=renderToStaticMarkup(React.createElement(StatsHeader,{stats:{addresses:0,contacts:0,visited:0},engagement:{scans:0,opens:0,clicks:0,downloads:0},engagementState:'loading'}));
  assert(loadingStats.includes('Loading engagement'));assert(!loadingStats.includes('0 QR scans'));
  let enabled=true,canView=true,fail=false;
  const shares=Array.from({length:1001},(_,i)=>({id:id(100+i),address_id:id(30),workspace_id:id(10),campaign_id:id(40),parent_share_id:null}));
  shares.push({id:id(2000),address_id:id(31),workspace_id:id(11),campaign_id:id(40),parent_share_id:null});
  shares.push({id:id(2001),address_id:id(32),workspace_id:id(10),campaign_id:id(40),parent_share_id:id(100)});
  const events=shares.map((s,i)=>({id:id(3000+i),share_id:s.id,visit_id:id(9000+i),event_type:i===1000?'contact_downloaded':i===999?'website_clicked':'qualified_open',card_shares:s}));
  // Automatic opens are on the last page, after their actions on earlier pages.
  events.push({id:id(5000),share_id:shares[999].id,visit_id:id(9999),event_type:'qualified_open',card_shares:shares[999]});
  events.push({id:id(5001),share_id:shares[1000].id,visit_id:id(10000),event_type:'qualified_open',card_shares:shares[1000]});
  const calls=[];
  globalThis.__engagementDB={
    rpc:async()=>({data:canView,error:null}),
    from(table){let filters=[],start=0,end=Infinity;const value=(r,k)=>k.split('.').reduce((v,p)=>v?.[p],r);const q={
      select(){return q},eq(k,v){filters.push(r=>value(r,k)===v);return q},is(k,v){filters.push(r=>value(r,k)===v);return q},not(k,op,v){assert.equal(op,'is');filters.push(r=>value(r,k)!==v);return q},order(){return q},range(a,b){start=a;end=b;calls.push([table,a]);return q},
      maybeSingle(){return Promise.resolve({data:table==='workspace_members'?([{workspace_id:id(10),user_id:id(1)}].find(r=>filters.every(f=>f(r)))??null):{enabled},error:null})},
      then(resolve,reject){return Promise.resolve({data:(table==='card_shares'?shares:events).filter(r=>filters.every(f=>f(r))).slice(start,end+1),error:fail?{message:'db failed'}:null}).then(resolve,reject)}
    };return q;}
  };
  await writeFile(`${dir}/db.ts`,'export function createAdminClient(){return (globalThis as any).__engagementDB}');
  await writeFile(`${dir}/auth.ts`,`export async function resolveUserFromRequest(req){return req.headers.get('authorization')==='Bearer test'?{id:'${id(1)}'}:null}`);
  await build({entryPoints:['app/api/cards/campaign-engagement/route.ts'],outfile:`${dir}/route.cjs`,bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'@/lib/supabase/server':`${dir}/db.ts`,'@/app/api/_utils/request-user':`${dir}/auth.ts`},logLevel:'silent'});
  const {GET}=require(`${dir}/route.cjs`);const {NextRequest}=require('next/server');
  const call=(auth=true,workspace=id(10))=>GET(new NextRequest(`https://example.com/api/cards/campaign-engagement?workspaceId=${workspace}&campaignId=${id(40)}`,{headers:auth?{authorization:'Bearer test'}:{}}));
  assert.equal((await call(false)).status,401);
  assert.equal((await call(true,id(11))).status,403);
  canView=false;assert.equal((await call()).status,403);canView=true;
  enabled=false;assert.equal((await call()).status,403);enabled=true;
  assert.equal((await call(true,'invalid')).status,400);
  const response=await call();assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(data.engagement,[{address_id:id(30),shares:1001,opens:1001,clicks:1,downloads:1}]);
  assert.deepEqual(data.totals,{opens:999,clicks:1,downloads:1});
  assert(calls.some(([table,start])=>table==='card_events'&&start===1000));
  fail=true;assert.equal((await call()).status,500);
  console.log('Passed: QR/card union, duplicate addresses, separate units, downloads, shared-only and empty campaigns; actual route auth, feature/campaign access, workspace/referral isolation, >1000 shares/events, database failures.');
} finally { await rm(dir,{recursive:true,force:true}); }
