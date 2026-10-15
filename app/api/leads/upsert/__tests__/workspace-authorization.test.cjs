// Run: node --test app/api/leads/upsert/__tests__/workspace-authorization.test.cjs
// Requires the project's TypeScript dev dependency (or an existing NODE_PATH).
// Executes actual source with allowlisted mocks; no Next/server/env/provider imports.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(filename, imports = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics || []).length, 0, 'source must transpile');
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    require(name) {
      if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename, timeout: 1000 });
  return module.exports;
}

const workspaceHelper = loadSource(path.resolve(__dirname, '../../../_utils/workspace.ts'));
const owner = { id: 'synthetic-owner' };
const validWorkspace = { workspaceId: 'synthetic-workspace' };

async function request({ workspace = validWorkspace, user = owner, body = {} } = {}) {
  const effects = { writes: [], crm: [], resolver: [] };
  const admin = {
    from(table) {
      return {
        insert(payload) {
          effects.writes.push({ table, payload });
          return {
            select() { return this; },
            async single() { return { data: { id: 'synthetic-contact', full_name: payload.full_name, status: payload.status }, error: null }; },
          };
        },
      };
    },
  };
  const { POST } = loadSource(path.resolve(__dirname, '../route.ts'), {
    'next/server': { NextResponse: { json: (data, options) => ({ data, status: options?.status || 200 }) } },
    '@/app/api/_utils/request-user': { resolveUserFromRequest: async () => user },
    '@/app/api/_utils/workspace': { resolveWorkspaceIdForUser: async (...args) => { effects.resolver.push(args); return workspace; } },
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/integrations/auto-push': { pushLeadToConnectedCrms: async (...args) => { effects.crm.push(args); return []; } },
  });
  const response = await POST({ json: async () => ({ fullName: 'Synthetic Lead', workspaceId: 'synthetic-workspace', ...body }) });
  return { response, effects };
}

for (const [name, workspace, status] of [
  ['non-member workspace', { workspaceId: null, error: 'You are not a member of the selected workspace', status: 403 }, 403],
  ['missing membership', { workspaceId: null, error: 'No workspace membership found for this user', status: 400 }, 400],
  ['unresolved workspace without status', { workspaceId: null }, 400],
  ['resolver denial even with workspace ID', { workspaceId: 'synthetic-workspace', error: 'Access denied', status: 403 }, 403],
]) {
  test(`${name} rejects before any writes or CRM delivery`, async () => {
    const { response, effects } = await request({ workspace });
    assert.equal(response.status, status);
    assert.equal(effects.writes.length, 0);
    assert.equal(effects.crm.length, 0);
  });
}

test('unauthenticated requests remain 401 with no resolution or mutation', async () => {
  const { response, effects } = await request({ user: null });
  assert.equal(response.status, 401);
  assert.equal(effects.resolver.length, 0);
  assert.equal(effects.writes.length, 0);
  assert.equal(effects.crm.length, 0);
});

test('missing lead name remains 400 without writes', async () => {
  const { response, effects } = await request({ body: { fullName: '  ' } });
  assert.equal(response.status, 400);
  assert.equal(effects.writes.length, 0);
  assert.equal(effects.crm.length, 0);
});

for (const role of ['member', 'owner']) {
  test(`valid ${role} preserves 201 and binds the authenticated user`, async () => {
    // Exercise real membership resolution, including a solo owner's default workspace.
    const workspace = await workspaceHelper.resolveWorkspaceIdForUser(
      {}, owner.id, role === 'member' ? 'synthetic-workspace' : null,
      [{ workspace_id: 'synthetic-workspace', role, created_at: '2026-01-01' }],
      { current_workspace_id: 'synthetic-workspace' },
    );
    const { response, effects } = await request({ workspace, body: { user_id: 'foreign-user', email: 'fixture@example.invalid', outcome: 'interested' } });
    assert.equal(response.status, 201);
    assert.equal(effects.writes.length, 1);
    assert.equal(effects.writes[0].table, 'contacts');
    assert.equal(effects.writes[0].payload.user_id, owner.id);
    assert.equal(effects.writes[0].payload.workspace_id, 'synthetic-workspace');
    assert.equal(effects.writes[0].payload.email, 'fixture@example.invalid');
    assert.equal(response.data.fullName, 'Synthetic Lead');
    assert.equal(response.data.outcome, 'interested');
    assert.equal(effects.crm.length, 1);
  });
}

test('real resolver denies foreign workspace membership', async () => {
  const workspace = await workspaceHelper.resolveWorkspaceIdForUser(
    {}, owner.id, 'foreign-workspace', [{ workspace_id: 'synthetic-workspace', role: 'owner' }], {},
  );
  const { response, effects } = await request({ workspace });
  assert.equal(response.status, 403);
  assert.equal(effects.writes.length, 0);
  assert.equal(effects.crm.length, 0);
});
