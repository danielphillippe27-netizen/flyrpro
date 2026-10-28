const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const root = process.cwd();
let session = null, frames = 0;
const client = { auth: { getSession: async () => ({ data: { session } }) } };
const mocks = {
  '@supabase/ssr': { createServerClient: () => client, createBrowserClient: () => client },
  'next/server': { NextResponse: { next: () => ({ status: 200, cookies: { set() {} } }), redirect: (url, status = 307) => ({ status, url }) } },
  '@/lib/supabase/env': { getSupabaseUrl: () => 'https://example.supabase.co', getSupabaseAnonKey: () => 'fixture' },
  '@/lib/supabase/shared-cookie': { withSharedWolfGridCookie: (_, options) => options, browserSharedCookieOptions: () => ({}) },
  './browser-cookies': { browserAuthCookies: {} },
};
function load(file) {
  const m = new Module(`${root}/${file}`); m.paths = Module._nodeModulePaths(root);
  m.require = id => mocks[id] || Module.prototype.require.call(m, id);
  m._compile(ts.transpileModule(fs.readFileSync(`${root}/${file}`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
  return m.exports;
}
function request(path) {
  const url = new URL(`https://pilot.vercel.app${path}`); url.clone = () => new URL(url);
  return { nextUrl: url, cookies: { getAll: () => [], set() {} } };
}
(async () => {
  mocks['@/lib/auth/landing-redirect'] = load('lib/auth/landing-redirect.ts');
  const { middleware } = load('middleware.ts');
  let result = await middleware(request('/settings/mac'));
  assert.equal(result.status, 307); assert.equal(result.url.pathname, '/login');
  assert.equal(result.url.searchParams.get('next'), '/settings/mac');
  assert.equal((await middleware(request('/login'))).status, 200);
  assert.equal((await middleware(request('/home'))).status, 200);
  session = { user: { id: 'owner' } };
  assert.equal((await middleware(request('/settings/mac'))).status, 200);
  global.window = {}; global.requestAnimationFrame = () => { frames++; };
  const { getClientAsync } = load('lib/supabase/client.ts');
  let timeout;
  const actual = await Promise.race([getClientAsync(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Hidden-window authentication stalled')), 1000); })]);
  clearTimeout(timeout); assert.equal(actual, client); assert.equal(frames, 0);
  delete global.window; delete global.requestAnimationFrame;
  await assert.rejects(getClientAsync(), /browser/);
  console.log('PASS: Mac setup redirects unauthenticated requests before streaming; signed-in and unrelated routes unchanged; hidden-window auth never waits for rendering.');
})().catch(error => { console.error(error); process.exitCode = 1; });
