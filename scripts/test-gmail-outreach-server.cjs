const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
(async () => {
  const root = process.cwd(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-outreach-server-'));
  const userId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const contactId = '33333333-3333-4333-8333-333333333333';
  const requestId = '44444444-4444-4444-8444-444444444444';
  let stored = null, sends = 0;
  const state = global.__outreachTest = { user: { id: userId }, membership: { workspaceId, role: 'member' }, contact: { id: contactId, user_id: userId, email: 'home@example.com' } };
  function query(table) {
    const q = {
      select() { return q; }, eq() { return q; }, match() { return q; },
      async maybeSingle() { return { data: table === 'contacts' ? state.contact : stored }; },
      async single() { return { data: stored }; },
      async insert(data) { if (table === 'gmail_outreach_sends') { if (stored) return { error: { code: '23505' } }; stored = { ...data }; } return { error: null }; },
      update(data) { return { async match() { stored = { ...stored, ...data }; return { error: null }; } }; },
    }; return q;
  }
  state.admin = { from: query };
  await build({ entryPoints: ['app/api/outreach/gmail/send/route.ts'], outfile: path.join(temp, 'route.cjs'), platform: 'node', format: 'cjs', bundle: true, packages: 'external', tsconfig: 'tsconfig.json', plugins: [{ name: 'mock-server', setup(b) {
    b.onResolve({ filter: /^@\/(app\/api\/_utils\/(request-user|workspace)|lib\/(supabase\/server|outreach\/gmail))$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: a.path.endsWith('request-user') ? 'export const resolveUserFromRequest=async()=>global.__outreachTest.user' : a.path.endsWith('workspace') ? 'export const resolveWorkspaceMembershipForUser=async()=>global.__outreachTest.membership' : a.path.endsWith('server') ? 'export const createAdminClient=()=>global.__outreachTest.admin' : 'export const gmailAccess=async()=>({email:"sender@example.com",token:"mock"});export const gmailMime=()=>"mock";', loader: 'js' }));
  } }] });
  const Module = require('module');
  const createRequire = Module.createRequire(path.join(root, 'package.json'));
  const source = await fs.readFile(path.join(temp, 'route.cjs'), 'utf8');
  const compiled = new Module(path.join(root, 'outreach-test.cjs')); compiled.paths = module.paths; compiled.require = createRequire; compiled._compile(source, path.join(root, 'outreach-test.cjs'));
  const { POST } = compiled.exports;
  const originalFetch = global.fetch;
  global.fetch = async () => { sends++; return new Response(JSON.stringify({ id: 'gmail-id' }), { status: 200 }); };
  const payload = { requestId, workspaceId, contactId, subject: 'Hello', body: 'Campaign update' };
  const invoke = (data = payload) => POST(new Request('https://wolfgrid.app/api/outreach/gmail/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
  try {
    state.user = null; assert.equal((await invoke()).status, 401); state.user = { id: userId };
    state.membership = { workspaceId: 'wrong', role: 'member' }; assert.equal((await invoke()).status, 403); state.membership = { workspaceId, role: 'member' };
    state.contact.user_id = 'another-user'; assert.equal((await invoke()).status, 403); state.contact.user_id = userId;
    assert.equal(sends, 0);
    assert.equal((await (await invoke()).json()).status, 'accepted'); assert.equal(sends, 1);
    assert.equal((await (await invoke()).json()).duplicate, true); assert.equal(sends, 1);
    assert.equal((await invoke({ ...payload, body: 'Changed content' })).status, 409);
    stored = null;
    global.fetch = async () => { sends++; throw new Error('Response interrupted'); };
    assert.equal((await (await invoke()).json()).status, 'unknown');
    const count = sends; assert.equal((await (await invoke()).json()).status, 'unknown'); assert.equal(sends, count);
    console.log('PASS: auth, workspace scope, contact ownership, idempotency, changed-payload rejection, uncertain-result no-retry. No external requests.');
  } finally { global.fetch = originalFetch; delete global.__outreachTest; }
})().catch(error => { console.error(error); process.exitCode = 1; });
