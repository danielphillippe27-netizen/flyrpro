const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {build}=require('esbuild');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-mac-api-'));
 const outfile=path.join(dir,'route.cjs');
 await build({entryPoints:['app/api/mac-companion/route.ts'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'auth-fixture',setup(b){b.onResolve({filter:/^@\/lib\/supabase\/server$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const getSupabaseServerClient=async()=>globalThis.macTestApi;',loader:'js'}));}}]});
 // Resolve external Next/zod from the repository, even though the bundle is temporary.
 const Module=require('node:module'),module=new Module(outfile);module.filename=outfile;module.paths=Module._nodeModulePaths(process.cwd());module._compile(await fs.readFile(outfile,'utf8'),outfile);
 const route=module.exports,{NextRequest}=require('next/server');let signedIn=false,calls=[];
 global.macTestApi={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'33333333-3333-4333-8333-333333333333'},error:null})}),auth:{getUser:async()=>({data:{user:signedIn?{id:'owner'}:null}})},rpc:async(name,params)=>{if(name==='mac_workspace_access')return{data:true,error:null};calls.push({name,params});return{data:{cursor:1,inserted:1},error:null}}};
 process.env.CRM_MAC_ENABLED='true';
 const valid={action:'sync',workspaceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',deviceId:'55555555-5555-4555-8555-555555555555',contactId:'33333333-3333-4333-8333-333333333333',cursor:0,messages:[{rowID:1,guid:'fixture',participants:['+19055550101'],direction:'incoming',body:'test',bodyStatus:'decoded',service:'SMS',sentAt:null,hasAttachments:false}]};
 const post=(body,origin='https://wolfgrid.app')=>route.POST(new NextRequest('https://wolfgrid.app/api/mac-companion',{method:'POST',headers:{origin,'x-wolfgrid-user-id':'owner'},body:typeof body==='string'?body:JSON.stringify(body)}));
 assert.equal((await post(valid)).status,401);signedIn=true;
 assert.equal((await post(valid,'https://other.example')).status,403);
 assert.equal((await post('{')).status,400);
 assert.equal((await post({...valid,messages:[{...valid.messages[0],participants:['a','b']}]})).status,400);
 assert.equal((await post({...valid,messages:[{...valid.messages[0],localPath:'/private/file'}]})).status,400);
 assert.equal((await post(' '.repeat(2000001))).status,413);
 assert.equal(calls.length,0);
 assert.equal((await post(valid)).status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'import_mac_contact_messages');
 console.log('PASS: real API handler rejects unauthenticated/cross-origin/malformed/oversized/group/local-path requests before database writes; valid batch invokes transactional RPC.');
})().catch(e=>{console.error(e);process.exitCode=1});
