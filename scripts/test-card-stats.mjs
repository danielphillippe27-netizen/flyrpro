import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const dir=await mkdtemp(`${process.cwd()}/node_modules/.cache/card-stats-`);
const require=createRequire(`${process.cwd()}/package.json`);
const workspace='abcdefab-0000-4000-8000-000000000010';
let member=true,enabled=true,role='member',fail=false;
const events=Array.from({length:1205},()=>({event_type:'qualified_open',card_shares:{workspace_id:workspace,rep_id:'me'}}));
events.push({event_type:'qualified_open',card_shares:{workspace_id:workspace,rep_id:'other'}});
events.push({event_type:'qualified_open',card_shares:{workspace_id:'foreign',rep_id:'me'}});
events.push({event_type:'website_clicked',card_shares:{workspace_id:workspace,rep_id:'me'}});
globalThis.cardStatsDB={from(table){const filters=[];const q={select(columns,options){if(table==='card_events')assert.deepEqual(options,{count:'exact',head:true});return q},eq(k,v){filters.push(row=>k.split('.').reduce((r,p)=>r?.[p],row)===v);return q},maybeSingle(){return Promise.resolve({data:table==='workspace_members'?(member?{role}:null):{enabled},error:null})},then(resolve,reject){return Promise.resolve({count:events.filter(e=>filters.every(f=>f(e))).length,error:fail?{}:null}).then(resolve,reject)}};return q}};
try {
 await writeFile(`${dir}/db.ts`,'export function createAdminClient(){return (globalThis as any).cardStatsDB}');
 await writeFile(`${dir}/auth.ts`,"export async function resolveUserFromRequest(req){return req.headers.get('authorization')?{id:'me'}:null}");
 await build({entryPoints:['app/api/cards/stats/route.ts'],outfile:`${dir}/route.cjs`,bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'@/lib/supabase/server':`${dir}/db.ts`,'@/app/api/_utils/request-user':`${dir}/auth.ts`},logLevel:'silent'});
 const {GET}=require(`${dir}/route.cjs`);const {NextRequest}=require('next/server');
 const call=(scope='self',auth=true)=>GET(new NextRequest(`https://example.com/api/cards/stats?workspaceId=${workspace}&scope=${scope}`,{headers:auth?{authorization:'Bearer test'}:{}}));
 assert.equal((await call('self',false)).status,401);
 member=false;assert.equal((await call()).status,403);member=true;
 enabled=false;assert.equal((await call()).status,403);enabled=true;
 assert.deepEqual(await (await call()).json(),{opened:1205});
 assert.equal((await call('team')).status,403);
 role='admin';assert.deepEqual(await (await call('team')).json(),{opened:1206});
 assert.equal((await call('invalid')).status,400);
 fail=true;assert.equal((await call()).status,500);
 console.log('Card stats passed: >1000 opens, repeat visits, self/workspace isolation, team permissions, feature gate, authentication, invalid scope, database errors.');
} finally {await rm(dir,{recursive:true,force:true});}
