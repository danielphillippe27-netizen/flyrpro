// Actual Next route; deterministic DB adapter. SQL/RLS have separate PGlite coverage.
import { build } from 'esbuild';
import { mkdtemp,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root=process.cwd();await mkdir(join(root,'node_modules/.cache'),{recursive:true});const dir=await mkdtemp(join(root,'node_modules/.cache/card-api-'));
const id=n=>`abcdefab-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tables={workspace_members:[{workspace_id:id(10),user_id:id(1)}],card_workspace_features:[{workspace_id:id(10),enabled:true}],contacts:[{id:id(20),user_id:id(1),workspace_id:id(10),full_name:'Sarah Smith',phone:'+15555550123',address_id:id(30),campaign_id:id(40)},{id:id(21),user_id:id(2),workspace_id:id(10),full_name:'Other rep lead',phone:'+15555550123'}],campaign_addresses:[{id:id(30),campaign_id:id(40),gers_id:'building-a'},{id:id(31),campaign_id:id(40),gers_id:'building-a'}],campaigns:[{id:id(40),workspace_id:id(10)}],card_profiles:[{id:id(50),rep_id:id(1),workspace_id:id(10),published:true,content:{name:'Daniel',phone:'+15555550124'}}],card_shares:[],card_events:[]};
globalThis.__cardFixture={from(table){let filters=[],operation=null,payload=null;const run=()=>{let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));if(operation==='insert'||operation==='upsert'){const values=Array.isArray(payload)?payload:[payload];rows=values.map(v=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),revoked_at:null,...v}));tables[table]??=[];tables[table].push(...rows);}if(operation==='update')rows.forEach(r=>Object.assign(r,payload));return {data:rows,error:null};};const q={select(){return q},eq(k,v){filters.push(r=>typeof r[k]==='string'&&typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v)?r[k].toLowerCase()===v.toLowerCase():r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},insert(v){operation='insert';payload=v;return q},upsert(v){operation='upsert';payload=v;return q},update(v){operation='update';payload=v;return q},single(){const r=run();return Promise.resolve({...r,data:r.data[0]??null})},maybeSingle(){return q.single()},then(resolve,reject){return Promise.resolve(run()).then(resolve,reject)}};return q;},rpc(){return Promise.resolve({data:true,error:null})}};
await writeFile(join(dir,'db.ts'),'export function createAdminClient(){return (globalThis as any).__cardFixture}');
await writeFile(join(dir,'auth.ts'),`export async function resolveUserFromRequest(req){return req.headers.get('authorization')==='Bearer fixture'?{id:'${id(1)}',email:'fixture@example.com'}:null}`);
await build({entryPoints:[join(root,'app/api/cards/[...path]/route.ts')],outfile:join(dir,'route.cjs'),platform:'node',format:'cjs',bundle:true,packages:'external',alias:{'@/lib/supabase/server':join(dir,'db.ts'),'@/app/api/_utils/request-user':join(dir,'auth.ts')},logLevel:'silent'});
const require=createRequire(join(root,'package.json'));const {NextRequest}=require('next/server');const route=require(join(dir,'route.cjs'));
async function call(path,body={},auth=true,workspace=10,method='POST'){const request=new NextRequest(`https://wolfgrid.app/api/cards/${path}?workspaceId=${id(workspace)}`,{method,headers:{...(auth?{Authorization:'Bearer fixture'}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});const response=await route[method](request,{params:Promise.resolve({path:path.split('/')})});return {status:response.status,body:await response.json()};}
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(60)},false)).status,401);
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(60)},true,11)).status,403);
assert.equal((await call('shares',{contactId:id(21),idempotencyKey:id(60)})).status,409);
assert.equal((await call('shares',{contactId:id(20),addressId:id(31),idempotencyKey:id(60)})).status,409);
const first=await call('shares',{contactId:id(20),idempotencyKey:id(60)});assert.equal(first.status,200);assert.match(first.body.url,/\/c\/[a-f0-9]{48}$/);assert(!first.body.url.includes('Sarah'));
const retry=await call('shares',{contactId:id(20),idempotencyKey:id(60)});assert.equal(retry.body.url,first.body.url);assert.equal(tables.card_shares.length,1);
const nativeRetry=await call('shares',{contactId:id(20).toUpperCase(),addressId:id(30).toUpperCase(),idempotencyKey:id(60).toUpperCase()});
assert.equal(nativeRetry.status,200,JSON.stringify(nativeRetry.body)+' iOS uppercase UUIDs must identify the same lead and property');
assert.equal(nativeRetry.body.url,first.body.url,'iOS retry must reuse its original share');
assert.equal((await call('shares',{contactId:id(20).toUpperCase(),addressId:id(31).toUpperCase(),idempotencyKey:id(64)})).status,409,'Different properties remain rejected');
const second=await call('shares',{contactId:id(20),idempotencyKey:id(61)});assert.notEqual(second.body.url,first.body.url);
assert.equal((await call(`shares/${first.body.id}/revoke`)).status,200);
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(60)})).status,409);
tables.card_profiles[0].published=false;
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(62)})).status,200);
assert.equal(tables.card_profiles[0].published,true,'Sending an existing populated card publishes it');
const savedProfile=tables.card_profiles[0];
tables.card_profiles=[];
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(63)})).status,409);
tables.card_profiles=[{...savedProfile,content:{name:'  '},published:false}];
assert.equal((await call('shares',{contactId:id(20),idempotencyKey:id(63)})).status,409);
for(const content of [{name:'Daniel'},{phone:'+15555550124'},{company:'Example'},{socials:[{platform:'Website',url:'https://example.com'}]}]) {
 tables.card_profiles=[];
 const saved=await call('profile',{content,published:false});
 assert.equal(saved.status,200);assert.equal(saved.body.profile.published,true);
 assert.equal((await call('shares',{contactId:id(20),idempotencyKey:crypto.randomUUID()})).status,200);
}
tables.card_profiles=[];
const blank=await call('profile',{content:{name:'  ',theme:{header:'#111111',accent:'#222222',background:'#ffffff'}},published:true});
assert.equal(blank.status,200);assert.equal(blank.body.profile.published,false);
tables.card_profiles=[savedProfile];
// Binary image uploads use the same authenticated workspace scope.
const uploads=[];
globalThis.__cardFixture.storage={from(bucket){assert.equal(bucket,'business-card-images');return {async upload(path,bytes,options){uploads.push({path,bytes,options});return {error:null}},getPublicUrl(path){return {data:{publicUrl:'https://storage.example/'+path}}}}}};
const sharp=require('sharp');const png=await sharp({create:{width:10,height:10,channels:4,background:'transparent'}}).png().toBuffer();
async function imageCall({auth=true,workspace=10,kind='companyLogo',type='image/png',bytes=png}={}) {
 const request=new NextRequest(`https://wolfgrid.app/api/cards/images?workspaceId=${id(workspace)}&kind=${kind}`,{method:'POST',headers:{...(auth?{Authorization:'Bearer fixture'}:{}),'Content-Type':type},body:bytes});
 return route.POST(request,{params:Promise.resolve({path:['images']})});
}
assert.equal((await imageCall({auth:false})).status,401);
assert.equal((await imageCall({workspace:11})).status,403);
assert.equal((await imageCall({kind:'other'})).status,400);
assert.equal((await imageCall({type:'image/svg+xml'})).status,415);
assert.equal((await imageCall({bytes:Buffer.from('broken')})).status,400);
assert.equal((await imageCall({bytes:Buffer.alloc(3*1024*1024+1)})).status,413);
assert.equal((await imageCall()).status,200);assert.equal(uploads.length,1);
assert(uploads[0].path.startsWith(`${id(10)}/${id(1)}/companyLogo-`));assert.equal(uploads[0].options.contentType,'image/webp');
assert.equal((await sharp(uploads[0].bytes).metadata()).format,'webp');
tables.card_workspace_features[0].enabled=false;
assert.equal((await imageCall()).status,403);
console.log('Image upload API passed: authentication, workspace isolation, validation, ownership path, WebP conversion, feature gate');
assert.equal((await call('profile',{},true,10,'GET')).status,403);
console.log('Actual card API route passed: authentication, workspace gate, private lead ownership, exact property association, unique sends, retry idempotency, revocation, automatic publishing, existing card recovery, blank card protection');
