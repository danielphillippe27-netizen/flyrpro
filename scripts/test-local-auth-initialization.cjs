const fs=require('node:fs'),Module=require('node:module'),assert=require('node:assert/strict'),ts=require('typescript');
const root=process.cwd();let created=0,frames=0;
const fakeClient={auth:{}};
const mocks={
 '@supabase/ssr':{createBrowserClient:()=>{created++;return fakeClient;}},
 './browser-cookies':{browserAuthCookies:{}},
 '@/lib/supabase/shared-cookie':{browserSharedCookieOptions:()=>({})},
};
function load(path){const module=new Module(`${root}/${path}`);module.paths=Module._nodeModulePaths(root);module.require=id=>mocks[id]||Module.prototype.require.call(module,id);module._compile(ts.transpileModule(fs.readFileSync(`${root}/${path}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,path);return module.exports;}
(async()=>{
const oldOrigin=process.env.NEXT_PUBLIC_APP_URL,oldWindow=global.window,oldFrame=global.requestAnimationFrame;
try{
const {resolvePublicAppOrigin}=load('lib/auth/public-origin.ts');process.env.NEXT_PUBLIC_APP_URL='https://wolfgrid.app';
for(const origin of ['http://localhost:3000','http://127.0.0.1:3000','http://[::1]:3000'])assert.equal(resolvePublicAppOrigin(origin),origin,'Local OAuth/reset callbacks must retain their initiating host and port');
assert.equal(resolvePublicAppOrigin('https://sales.wolfgrid.app'),'https://wolfgrid.app','Retain production canonical callbacks');assert.equal(resolvePublicAppOrigin(),'https://wolfgrid.app');
process.env.NEXT_PUBLIC_APP_URL='https://flyrpro.app';assert.equal(resolvePublicAppOrigin(),'https://wolfgrid.app');
process.env.NEXT_PUBLIC_APP_URL='https://preview.example.com';assert.equal(resolvePublicAppOrigin('http://localhost:3001'),'http://localhost:3001');assert.equal(resolvePublicAppOrigin('https://elsewhere.example'),'https://preview.example.com');
const {getClientAsync}=load('lib/supabase/client.ts');global.window={};global.requestAnimationFrame=()=>{frames++;return 1;};
let timeout;const client=await Promise.race([getClientAsync(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Authentication stalled waiting for a hidden frame')),1000);})]);clearTimeout(timeout);
assert.equal(client,fakeClient);assert.equal(created,1);assert.equal(frames,0,'Initialization must not depend on a visible tab rendering');
delete global.window;await assert.rejects(getClientAsync(),/only be called in the browser/);
console.log('PASS local auth: localhost/IPv4/IPv6 callback origin, production canonical origin, background-tab client initialization and SSR guard.');
}finally{if(oldOrigin===undefined)delete process.env.NEXT_PUBLIC_APP_URL;else process.env.NEXT_PUBLIC_APP_URL=oldOrigin;global.window=oldWindow;global.requestAnimationFrame=oldFrame;}
})().catch(error=>{console.error(error);process.exitCode=1;});
