// Own-account acceptance only. Creates and revokes a temporary auth session; sends no email.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const dotenv=require('dotenv'),{createClient}=require('@supabase/supabase-js'),{createServerClient}=require('@supabase/ssr');
let verificationStage="setup";
(async()=>{
 const deployment=process.argv[2];if(!/^https:\/\/flyrpro-[a-z0-9-]+\.vercel\.app$/.test(deployment||''))throw Error('Supply the exact owned pilot deployment URL.');
 const env=dotenv.parse(await fs.readFile('.env.local'));
 const userId='6d5b64bc-ff8d-4331-a808-86074a7266dc',workspace='8246edea-ffa7-4560-b484-e5493a61a127',contact='f11bbe77-5e20-49d2-87c6-840603d0a1ee';
 const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const owner=await admin.auth.admin.getUserById(userId);if(owner.error||owner.data.user?.email!=='daniel@wolfgrid.app')throw Error('Pilot account identity mismatch.');
 const link=await admin.auth.admin.generateLink({type:'magiclink',email:owner.data.user.email});if(link.error)throw Error('Could not create own-account acceptance session.');
 const session=await anon.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'});if(session.error||session.data.user?.id!==userId)throw Error('Could not authenticate own-account acceptance session.');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-crm-pilot-auth-'));let cookies=[];
 try{
  const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>cookies,setAll:next=>{cookies=next;}}});
  const accepted=await client.auth.setSession({access_token:session.data.session.access_token,refresh_token:session.data.session.refresh_token});if(accepted.error)throw Error('Could not encode acceptance session cookies.');
  const headers=path.join(temporary,'headers');await fs.writeFile(headers,`Cookie: ${cookies.map(c=>`${c.name}=${c.value}`).join('; ')}\nx-wolfgrid-user-id: ${userId}\nContent-Type: application/json\nOrigin: ${deployment}\n`,{mode:0o600});
  const info=JSON.parse(spawnSync('/usr/bin/plutil',['-convert','json','-o','-','apps/mac/build/WolfGrid Mac Preview.app/Contents/Info.plist'],{encoding:'utf8'}).stdout);
  if(info.WolfGridWebOrigin!==deployment)throw Error('Preview entry mismatch');
  const protection=new Map();let entry=info.WolfGridPilotEntryURL;
  for(let i=0;i<5;i++){
   const response=await fetch(entry,{redirect:'manual',headers:{Cookie:[...protection].map(([k,v])=>`${k}=${v}`).join('; ')},signal:AbortSignal.timeout(20000)});
   for(const value of response.headers.getSetCookie()){const pair=value.split(';',1)[0],split=pair.indexOf('=');protection.set(pair.slice(0,split),pair.slice(split+1));}
   const next=response.headers.get('location');await response.body?.cancel();if(!next)break;
   entry=new URL(next,entry).href;if(new URL(entry).origin!==deployment)throw Error('Preview protection failed');
  }
  const cookie=[...cookies.map(c=>`${c.name}=${c.value}`),...[...protection].map(([k,v])=>`${k}=${v}`)].join('; ');
  async function request(url,body){
   const response=await fetch(new URL(url,deployment),{method:body?'POST':'GET',headers:{Cookie:cookie,'x-wolfgrid-user-id':userId,'Content-Type':'application/json',Origin:deployment},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
   let data;try{data=await response.json();}catch{throw Error('Pilot response was not application JSON.');}return{status:response.status,data};
  }
  verificationStage="CRM status";const state=await request(`/api/mac-companion?workspaceId=${workspace}`);if(state.status!==200||state.data.userId!==userId)throw Error('Authenticated pilot status failed.');
  verificationStage="contacts";const contacts=await request(`/api/crm-workspace?workspaceId=${workspace}`);if(contacts.status!==200||!Array.isArray(contacts.data.clients))throw Error('Authenticated contacts failed.');
  const chosen=contacts.data.clients.find(c=>c.id===contact)??contacts.data.clients[0];
  const history=chosen?await request(`/api/mac-companion?workspaceId=${workspace}&contactId=${chosen.id}`):{status:200,data:{messages:[]}};if(history.status!==200||!Array.isArray(history.data.messages))throw Error('Authenticated private history failed: '+history.status+' '+String(history.data?.error??'').slice(0,180));
  verificationStage="OpenAI configuration";const connection=await request(`/api/crm-ai/connection?workspaceId=${workspace}`);if(connection.status!==200||!connection.data.canSave||!connection.data.configured)throw Error('Pilot OpenAI configuration failed.');
  if(!connection.data.connected){const answer=await request('/api/crm-ai',{workspaceId:workspace,contactId:contact,question:'Summarize this contact'});if(answer.status!==403)throw Error('Missing personal key must fail closed.');}
  let farmStatus,pmTiles;
  if(process.argv[3]) {
   if(!/^[0-9a-f-]{36}$/.test(process.argv[3]))throw Error('Invalid campaign ID');
   verificationStage="farm listing";const farms=await request(`/api/farms?workspaceId=${workspace}`);if(farms.status!==200&&process.argv[4]!=='maps-only')throw Error('Farm API failed: '+farms.status+' '+String(farms.data.error ?? '').slice(0,200));farmStatus=farms.status;
   verificationStage="compact map";const pm=await request(`/api/campaigns/${process.argv[3]}/map-bundle?format=tiles-v3&platform=web`);if(pm.status!==200||pm.data.schema!=='tiles-v3')throw Error('Compact map API failed: '+pm.status);
   verificationStage="archive redirect";const archive=new URL(pm.data.tiles.archive_url);if(archive.origin!==deployment)throw Error('Archive origin changed');
   const redirect=await fetch(archive,{redirect:'manual',headers:{Cookie:cookie,Range:'bytes=0-126'},signal:AbortSignal.timeout(20000)});
   let bytes,rangeStatus=redirect.status;
   if(rangeStatus===307){
    const location=redirect.headers.get('location');await redirect.body?.cancel();
    if(!location||!new URL(location).hostname.endsWith('.amazonaws.com'))throw Error('Archive origin changed');
    verificationStage="storage byte range";const response=await fetch(location,{headers:{Range:'bytes=0-126'},signal:AbortSignal.timeout(20000)});
    if(response.status!==206||Number(response.headers.get('content-length'))>4096){await response.body?.cancel();throw Error('PMTiles range request failed: storage status '+response.status);}
    bytes=Buffer.from(await response.arrayBuffer());rangeStatus=response.status;
   }else {if(Number(redirect.headers.get('content-length'))>4096){await redirect.body?.cancel();throw Error('PMTiles range request failed: size');}bytes=Buffer.from(await redirect.arrayBuffer());}
   if(rangeStatus!==206||bytes.length!==127||bytes.subarray(0,7).toString()!=='PMTiles')throw Error('Invalid PMTiles header');
   pmTiles={schema:pm.data.schema,archiveStatus:206,headerBytes:bytes.length};
  }
  console.log(JSON.stringify({deployment,authenticatedStatus:state.status,...(pmTiles?{farmStatus,pmTiles}:{}),privateMessages:history.data.messages.length,contacts:contacts.data.clients.length,syncEnabled:state.data.preferences.sync_enabled,aiMessagesEnabled:state.data.preferences.ai_messages_enabled,openAiCanSave:connection.data.canSave,modelConfigured:connection.data.configured,personalKeyConnected:connection.data.connected}));
 }finally{await anon.auth.signOut({scope:'local'});await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{const safe=['Authenticated pilot status failed.','Authenticated contacts failed.','Authenticated private history failed:','Pilot OpenAI configuration failed.','Pilot HTTP request failed.','Pilot response was not application JSON.','Could not create own-account acceptance session.','Could not authenticate own-account acceptance session.','Farm API failed: ','Compact map API failed: ','PMTiles range request failed: ','Archive origin changed','Invalid PMTiles header'];console.error('Pilot verification failed at '+verificationStage+' ('+error.name+'); credentials and message content were withheld.'+(safe.some(prefix=>error.message?.startsWith(prefix))?' '+error.message:''));process.exitCode=1;});
