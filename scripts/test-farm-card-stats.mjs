import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const temp=await mkdtemp(`${process.cwd()}/node_modules/.cache/farm-card-stats-`),require=createRequire(`${process.cwd()}/package.json`);
const farmId='abcdefab-0000-4000-8000-000000000001',workspace='abcdefab-0000-4000-8000-000000000010';
let allowed=true,feature=true,missing=false,fail=false;
const shares=Array.from({length:1205},(_,i)=>({id:`s${i}`,workspace_id:workspace,campaign_id:i%2?'linked':null,contacts:{farm_id:farmId},parent_share_id:null}));
shares.push({id:'legacy',workspace_id:workspace,campaign_id:'linked',contacts:null,parent_share_id:null});
shares.push({id:'other-farm',workspace_id:workspace,campaign_id:'different',contacts:{farm_id:'other'},parent_share_id:null});
shares.push({id:'foreign',workspace_id:'foreign',campaign_id:'linked',contacts:{farm_id:farmId},parent_share_id:null});
shares.push({id:'referral',workspace_id:workspace,campaign_id:'linked',contacts:{farm_id:farmId},parent_share_id:'s0'});
const events=shares.flatMap(share=>['composer_opened','composer_cancelled','composer_failed','composer_sent','qualified_open','website_clicked'].map((event_type,i)=>({id:`${share.id}-${i}`,share_id:share.id,event_type})));
events.push({id:'repeat',share_id:'s0',event_type:'qualified_open'});
const read=(row,key)=>key.split('.').reduce((value,k)=>value?.[k],row);
globalThis.farmCardClient={from(table){const filters=[];const query={select(columns,options){if(table==='card_events')assert.deepEqual(options,{count:'exact',head:true});return query;},eq(key,value){filters.push(row=>read(row,key)===value);return query;},is(key,value){filters.push(row=>read(row,key)===value);return query;},in(key,values){filters.push(row=>values.includes(read(row,key)));return query;},order(){return query;},async range(from,to){return {data:shares.filter(row=>filters.every(filter=>filter(row))).slice(from,to+1),error:fail?{}:null};},then(resolve,reject){return Promise.resolve({count:events.filter(row=>filters.every(filter=>filter(row))).length,error:fail?{}:null}).then(resolve,reject);}};return query;}};
const sources={
'@/app/api/_utils/request-user':`export async function resolveUserFromRequest(req){return req.headers.get('authorization')?{id:'me'}:null;}`,
'@/lib/supabase/server':`export const createAdminClient=()=>globalThis.farmCardClient;`,
'@/app/api/farms/_utils/backingCampaign':`export const selectFarmCampaignRow=async()=>({farm:globalThis.farmCardState.missing?null:{id:'${farmId}',workspace_id:'${workspace}',linked_campaign_id:'linked'}});export const userCanAccessFarm=async()=>globalThis.farmCardState.allowed;export const resolveBackingCampaignId=async()=>null;`,
'@/lib/cards/server':`export class CardError extends Error{constructor(message,status=400){super(message);this.status=status;}}export async function cardScope(req,workspace){if(!globalThis.farmCardState.feature)throw new CardError('Disabled',403);if(workspace!=='${workspace}')throw Error('Foreign workspace');return{client:globalThis.farmCardClient,user:{id:'me'}};}`,
};
try{
const aliases={};for(const [index,[key,source]]of Object.entries(sources).entries()){const file=`${temp}/mock-${index}.ts`;await writeFile(file,source);aliases[key]=file;}
await build({entryPoints:['app/api/farms/[farmId]/card-stats/route.ts'],outfile:`${temp}/route.cjs`,bundle:true,platform:'node',format:'cjs',packages:'external',alias:aliases,logLevel:'silent'});
const {GET}=require(`${temp}/route.cjs`),{NextRequest}=require('next/server');
async function call(auth=true,id=farmId){globalThis.farmCardState={allowed,feature,missing};return GET(new NextRequest('http://test',{headers:auth?{authorization:'test'}:{}}),{params:Promise.resolve({farmId:id})});}
assert.equal((await call(false)).status,401);assert.equal((await call(true,'bad')).status,400);
allowed=false;assert.equal((await call()).status,403);allowed=true;missing=true;assert.equal((await call()).status,404);missing=false;feature=false;assert.equal((await call()).status,403);feature=true;
assert.deepEqual(await(await call()).json(),{sent:1206,opened:1207},'Full pagination, no double count from campaign/contact union, repeat opens included, foreign/unrelated/referral shares and unconfirmed sends excluded');
fail=true;assert.equal((await call()).status,500);fail=false;
events.length=0;assert.deepEqual(await(await call()).json(),{sent:0,opened:0});
console.log('PASS farm digital card totals: confirmed sends, repeat qualified opens, >1000 shares, dual attribution, deduplication, farm/workspace isolation, access and feature gates, errors and zero activity.');
}finally{delete globalThis.farmCardClient;delete globalThis.farmCardState;await rm(temp,{recursive:true,force:true});}
