const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),Module=require('node:module');const{build}=require('esbuild');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-runtime-')),outfile=path.join(dir,'runtime.cjs');await build({entryPoints:['lib/mac-companion/runtime.ts'],outfile,bundle:true,format:'cjs',platform:'node'});const mod=new Module(outfile);mod._compile(await fs.readFile(outfile,'utf8'),outfile);const{createMacSyncRuntime}=mod.exports;
 const ws='workspace',user='owner';let enabled=true,revision=1,actualUser=user,readDelay=0,uploaded=[],nativeCalls=[],state={a:0,b:0},extra=false,groupLeak=false;
 const native={postMessage:async input=>{nativeCalls.push(input);if(input.action==='status')return{deviceId:'device',messagesAllowed:true};if(input.action==='scan')return{scanId:'scan',identifiers:['+19055550101','+14165550102','+16475550103']};if(input.action==='read'){await new Promise(r=>setTimeout(r,readDelay));if(input.cursor)return[];return[{rowID:1,guid:input.identifiers[0],participants:input.identifiers,direction:'incoming',body:'Synthetic',bodyStatus:'decoded',service:'SMS',sentAt:null,hasAttachments:false}];}return{ok:true};}};
 global.window={webkit:{messageHandlers:{wolfgridMac:native}}};
 global.fetch=async(url,init={})=>{if(!init.body)return new Response(JSON.stringify({userId:actualUser,preferences:{sync_enabled:enabled,ai_messages_enabled:false,revision,sync_consent_at:'consent'},devices:[]}));const body=JSON.parse(init.body);if(body.action==='manifest')return new Response(JSON.stringify({enabled,contacts:[{id:'a',identifiers:['+19055550101'],cursor:state.a},{id:'b',identifiers:['+14165550102'],cursor:state.b},...(extra?[{id:'c',identifiers:['+16475550103'],cursor:0}]:[])]}));if(body.action==='sync'){uploaded.push(body);state[body.contactId]=body.messages.at(-1)?.rowID??body.cursor;return new Response(JSON.stringify({cursor:state[body.contactId]}));}return new Response('{}');};
 const runtime=createMacSyncRuntime(ws,user);await runtime.tick();assert.deepEqual(uploaded.filter(b=>b.messages.length).map(b=>b.contactId).sort(),['a','b']);assert.equal(nativeCalls.filter(c=>c.action==='scan').length,1,'one participant scan per polling pass');
 extra=true;await runtime.tick();assert(uploaded.some(b=>b.contactId==='c'&&b.messages.length));
 enabled=false;const before=uploaded.length;await runtime.tick();assert.equal(uploaded.length,before);assert(nativeCalls.some(c=>c.action==='clear-approval'));
 enabled=true;readDelay=100;const second=createMacSyncRuntime(ws,user);const pending=second.tick();await new Promise(r=>setTimeout(r,20));second.stop();await pending;assert.equal(uploaded.length,before,'logout/close discards in-flight native read');
 actualUser='other';const third=createMacSyncRuntime(ws,user);await third.tick();assert(nativeCalls.some(c=>c.action==='invalidate'));assert.equal(uploaded.length,before);
 actualUser=user;readDelay=30;
 const fourth=createMacSyncRuntime(ws,user),fetchOnline=global.fetch,realNow=Date.now;let offline=true,attempts=0,clock=realNow();
 global.fetch=async(...args)=>{attempts++;if(offline)throw Error('offline');return fetchOnline(...args);};Date.now=()=>clock;
 try{
  await fourth.tick();const failedAttempts=attempts;offline=false;
  await fourth.tick();assert.equal(attempts,failedAttempts,'temporary failure backs off before retrying');
  clock+=21000;const beforeRecovery=uploaded.length;await Promise.all([fourth.tick(),fourth.tick()]);
  assert(uploaded.length>beforeRecovery,'sync recovers after the backoff');
  assert.equal(nativeCalls.filter(c=>c.action==='scan').length,4,'overlapping ticks share one scan/import loop');
 }finally{Date.now=realNow;global.fetch=fetchOnline;fourth.stop();}
 runtime.stop();third.stop();console.log('PASS: runtime consent, one scan per pass, fair/new-contact backfill, pause, pending-read cancellation, account invalidation, offline backoff/recovery and overlapping ticks.');
})().catch(e=>{console.error(e);process.exitCode=1});
