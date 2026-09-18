const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = process.cwd();
const ts = require(root + '/node_modules/typescript');
const React = require(root + '/node_modules/react');
const { JSDOM } = require(root + '/node_modules/jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://wolfgrid.app/login' });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require(root + '/node_modules/react-dom/client');
let calls = [], authError = { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' };
const client = { auth: {
  getSession: async () => ({ data: { session: null } }),
  getUser: async () => ({ data: { user: null }, error: null }),
  signInWithPassword: async () => { calls.push('sign-in'); return { data: {}, error: authError }; },
  signUp: async () => { calls.push('sign-up'); return { data: { user: { identities: [{}] } }, error: null }; },
  resetPasswordForEmail: async () => { calls.push('recovery'); return { error: null }; },
}};
const mocks = {
 'next/navigation': { useRouter: () => ({ replace() {} }) },
 '@/lib/supabase/client': { getClientAsync: async () => client },
 '@/components/ui/button': { Button: ({ size, variant, ...p }) => React.createElement('button', p) },
 '@/components/ui/input': { Input: p => React.createElement('input', p) },
 '@/components/ui/label': { Label: p => React.createElement('label', p) },
 'next/image': { __esModule: true, default: ({ priority, fill, ...p }) => React.createElement('img', p) },
 '@/lib/auth/public-origin': { resolvePublicAppOrigin: x => x },
 '@/lib/supabase/shared-cookie': { clearBrowserSupabaseAuthCookies() {}, withSharedWolfGridCookie: (_, x) => x },
};
function load(path) {
 const m = new Module(root + '/' + path); m.paths = Module._nodeModulePaths(root);
 m.require = x => mocks[x] || Module.prototype.require.call(m, x);
 m._compile(ts.transpileModule(fs.readFileSync(root + '/' + path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, root + '/' + path);
 return m.exports;
}
async function clickText(text) {
 const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(text)); assert.ok(b, text);
 await React.act(async () => { b.click(); });
}
async function submit(twice=false) { await React.act(async () => { const f=document.querySelector('form'); f.dispatchEvent(new dom.window.Event('submit', {bubbles:true,cancelable:true})); if(twice) f.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})); }); }
(async () => {
 const Page=load('app/login/page.tsx').default;const mount=createRoot(document.getElementById('root'));
 await React.act(async()=>mount.render(React.createElement(Page)));
 await submit(true); assert.deepEqual(calls,['sign-in']);assert.match(document.body.textContent,/Invalid email or password/); console.log('PASS password failure makes one sign-in request, no sign-up, double submit guarded');
 calls=[];authError={status:429,code:'over_request_rate_limit',message:'Rate limit exceeded'};
 await submit();assert.deepEqual(calls,['sign-in']);assert.match(document.body.textContent,/not provided an exact retry time/);assert.doesNotMatch(document.body.textContent,/60 seconds/);console.log('PASS rate limit does not claim an invented cooldown');
 calls=[];await clickText('New to WolfGrid');await submit();assert.deepEqual(calls,['sign-up']);assert.match(document.body.textContent,/Check your email/);console.log('PASS explicit account creation only calls sign-up');
 await clickText('Already have an account');calls=[];await clickText('Forgot password');await submit();assert.deepEqual(calls,[]);console.log('PASS recovery validates email without trying sign-in or sign-up');
 let refreshes=0;mocks['next/server']={NextResponse:{next:()=>({cookies:{set(){}}}),redirect:()=>({})}};
 mocks['@supabase/ssr']={createServerClient:()=>({auth:{getSession:async()=>{refreshes++}}})};
 mocks['@/lib/supabase/env']={getSupabaseUrl:()=>'',getSupabaseAnonKey:()=>''};
 const {middleware}=load('middleware.ts');
 for(const pathname of ['/auth/callback','/login','/reset-password']) await middleware({nextUrl:{hostname:'wolfgrid.app',pathname}});
 assert.equal(refreshes,0);await middleware({nextUrl:{hostname:'wolfgrid.app',pathname:'/home'},cookies:{getAll:()=>[]}});assert.equal(refreshes,1);console.log('PASS callback preserves verifier; protected pages still refresh sessions');
 await React.act(async()=>mount.unmount());
})().catch(e=>{console.error(e);process.exitCode=1});
