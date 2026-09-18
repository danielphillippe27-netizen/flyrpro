const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { browserAuthCookies } = require('../lib/supabase/browser-cookies.ts');
const name = 'sb-test-auth-token';
const options = { domain: '.wolfgrid.app', path: '/', secure: true, sameSite: 'lax', maxAge: 3600 };
(async () => {
  const dom = new JSDOM('', { url: 'https://wolfgrid.app/login' });
  global.window = dom.window; global.document = dom.window.document;
  document.cookie = `${name}=stale; Path=/; Secure`;
  document.cookie = `${name}=shared; Domain=.wolfgrid.app; Path=/; Secure`;
  document.cookie = 'unrelated=keep; Path=/';
  await browserAuthCookies.setAll([{ name, value: '', options: { ...options, maxAge: 0 } }]);
  assert.ok(!(await browserAuthCookies.getAll()).some(c => c.name === name));
  assert.match(document.cookie, /unrelated=keep/);
  console.log('PASS invalid session cleanup deletes legacy and shared cookies, preserves unrelated cookies');
  document.cookie = `${name}=stale; Path=/; Secure`;
  await browserAuthCookies.setAll([{ name, value: 'fresh', options }]);
  assert.deepEqual((await browserAuthCookies.getAll()).filter(c => c.name === name), [{ name, value: 'fresh' }]);
  assert.match(dom.cookieJar.getCookieStringSync('https://sales.wolfgrid.app/'), /sb-test-auth-token=fresh/);
  console.log('PASS refresh replaces legacy token and shares the new token with subdomains');
  await browserAuthCookies.setAll([{ name: name+'-code-verifier', value: 'verifier', options }]);
  assert.match(document.cookie, /code-verifier=verifier/);
  assert.match(document.cookie, /auth-token=fresh/);
  console.log('PASS PKCE writes preserve the current session');
  const local = new JSDOM('', { url: 'http://localhost:3000/login' });
  global.window = local.window; global.document = local.window.document;
  await browserAuthCookies.setAll([{ name, value: 'local', options: {path:'/',maxAge:3600} }]);
  assert.match(document.cookie, /auth-token=local/);
  console.log('PASS localhost cookies keep their normal scope');
})().catch(e => { console.error(e); process.exitCode=1; });
