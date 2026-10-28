// Own-account acceptance only. Creates and revokes a temporary auth session; sends no email.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const dotenv=require('dotenv'),{createClient}=require('@supabase/supabase-js'),{createServerClient}=require('@supabase/ssr');
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
  function request(url,body){const args=['curl',url,'--deployment',deployment,'--','--silent','--show-error','--header',`@${headers}`,'--write-out','\n%{http_code}'];if(body)args.push('--request','POST','--data',JSON.stringify(body));const r=spawnSync('vercel',args,{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error('Pilot HTTP request failed.');const parts=r.stdout.trim().split('\n'),status=Number(parts.pop());let data;try{data=JSON.parse(parts.join('\n'));}catch{throw Error('Pilot response was not application JSON.');}return{status,data};}
  const state=request(`/api/mac-companion?workspaceId=${workspace}`);if(state.status!==200||state.data.userId!==userId)throw Error('Authenticated pilot status failed.');
  const history=request(`/api/mac-companion?workspaceId=${workspace}&contactId=${contact}`);if(history.status!==200||history.data.messages.length!==2)throw Error('Authenticated private history failed.');
  const connection=request(`/api/crm-ai/connection?workspaceId=${workspace}`);if(connection.status!==200||!connection.data.canSave||!connection.data.configured)throw Error('Pilot OpenAI configuration failed.');
  if(!connection.data.connected){const answer=request('/api/crm-ai',{workspaceId:workspace,contactId:contact,question:'Summarize this contact'});if(answer.status!==403)throw Error('Missing personal key must fail closed.');}
  console.log(JSON.stringify({deployment,authenticatedStatus:state.status,privateMessages:history.data.messages.length,syncEnabled:state.data.preferences.sync_enabled,aiMessagesEnabled:state.data.preferences.ai_messages_enabled,openAiCanSave:connection.data.canSave,modelConfigured:connection.data.configured,personalKeyConnected:connection.data.connected}));
 }finally{await anon.auth.signOut({scope:'local'});await fs.rm(temporary,{recursive:true,force:true});}
})().catch(()=>{console.error('Pilot verification failed; credentials and message content were withheld.');process.exitCode=1;});
