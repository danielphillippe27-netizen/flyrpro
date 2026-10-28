const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const root=process.cwd();let native=false,calls=[],providerOptions,providerError=null,missingURL=false,failPrepare=false;
const mocks={'@/lib/mac-companion/client':{hasMacBridge:()=>native,macNative:async(action,data)=>{calls.push({action,...data});if(action==='oauth-prepare'&&failPrepare)throw Error('already signing in');return{ok:true};}}};
function load(file){const m=new Module(`${root}/${file}`);m.paths=Module._nodeModulePaths(root);m.require=id=>mocks[id]||Module.prototype.require.call(m,id);m._compile(ts.transpileModule(fs.readFileSync(`${root}/${file}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return m.exports;}
const api={auth:{signInWithOAuth:async options=>{providerOptions=options;if(native)assert.equal(calls[0].action,'oauth-prepare','native lock must precede writing the verifier');return{data:{url:missingURL?null:'https://auth.example.com/auth/v1/authorize?public-challenge=fixture'},error:providerError};}}};
(async()=>{
 global.window={location:{href:''}};
 const {startProviderSignIn}=load('lib/auth/mac-oauth.ts');
 await startProviderSignIn(api,'google','https://wolfgrid.app/auth/callback?next=%2Fhome');
 assert.equal(providerOptions.options.redirectTo,'https://wolfgrid.app/auth/callback?next=%2Fhome');assert(!providerOptions.options.skipBrowserRedirect);assert.equal(window.location.href,'https://auth.example.com/auth/v1/authorize?public-challenge=fixture');assert.deepEqual(calls,[]);
 native=true;window.location.href='app-login';await startProviderSignIn(api,'google','https://wolfgrid.app/auth/callback');
 assert(providerOptions.options.skipBrowserRedirect);const target=new URL(providerOptions.options.redirectTo);assert.equal(target.protocol,'wolfgrid-mac:');assert.equal(target.host,'auth');assert.equal(target.pathname,'/callback');assert.equal(target.searchParams.get('attempt'),calls[0].attempt);assert.equal(calls[1].action,'oauth');assert.equal(calls[1].attempt,calls[0].attempt);assert.deepEqual(Object.keys(calls[1]).sort(),['action','attempt','url']);assert.equal(window.location.href,'app-login','Mac never navigates its WebKit window to the provider');
 calls=[];await startProviderSignIn(api,'apple','https://wolfgrid.app/auth/callback');assert.equal(providerOptions.provider,'apple');assert(!providerOptions.options.queryParams);
 calls=[];providerError=Error('provider unavailable');await assert.rejects(startProviderSignIn(api,'google','https://wolfgrid.app/auth/callback'),/provider unavailable/);assert.equal(calls.at(-1).action,'oauth-cancel');providerError=null;
 calls=[];missingURL=true;await assert.rejects(startProviderSignIn(api,'google','https://wolfgrid.app/auth/callback'),/Could not start/);assert.equal(calls.at(-1).action,'oauth-cancel');missingURL=false;
 calls=[];failPrepare=true;providerOptions=null;await assert.rejects(startProviderSignIn(api,'google','https://wolfgrid.app/auth/callback'),/already signing in/);assert.equal(providerOptions,null,'second window cannot overwrite the active verifier');
 const {landingAuthRedirect}=load('lib/auth/landing-redirect.ts');assert.equal(landingAuthRedirect('?code=google-code',''),'/auth/callback?code=google-code&next=%2Fhome');assert.equal(landingAuthRedirect('?code=recovery&type=recovery',''),'/reset-password?code=recovery&type=recovery');assert.equal(landingAuthRedirect('','#access_token=fake&type=bearer'),null);
 console.log('PASS: ordinary Google/Apple routing, Mac PKCE/browser handoff, prepare-before-verifier, cancellation cleanup, no token bridge payloads, and OAuth codes never routed to password reset.');
})().catch(error=>{console.error(error);process.exitCode=1});
