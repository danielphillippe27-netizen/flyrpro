// Run with node --test; requires the existing TypeScript dev dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ rows, failAt, delay = 10 } = {}) {
  const queries = [];
  let active = 0;
  let peak = 0;
  const client = { from(table) {
    const query = { table };
    return {
      select(columns) { query.columns = columns; return this; },
      eq(column, value) { query[column] = value; return this; },
      in(column, ids) {
        query[column] = Array.from(ids);
        const index = queries.length;
        queries.push(query); active++; peak = Math.max(peak, active);
        return new Promise(resolve => setTimeout(() => {
          active--;
          resolve(index === failAt ? { data: null, error: { message: 'fixture failure' } }
            : { data: rows ? rows(query, index) : [{ contact_id: ids[0], status: 'answered', created_at: new Date().toISOString() }], error: null });
        }, delay));
      },
    };
  } };
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../StatsService.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require(name) {
      assert.equal(name, '@/lib/supabase/client', 'unexpected runtime dependency');
      return { createClient: () => client };
    },
  }, { timeout: 1000 });
  return { service: module.exports.StatsService, queries, peak: () => peak };
}
const ids = n => Array.from({ length: n }, (_, i) => `fixture-${i}`);

test('independent chunks overlap with a hard cap of four and preserve tenant/projection', async () => {
  const f = fixture();
  const stats = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(2000));
  assert.equal(f.queries.length, 8);
  assert.equal(f.peak(), 4);
  assert.equal(stats.totalCalls, 8);
  for (const q of f.queries) {
    assert.equal(q.table, 'dialer_calls');
    assert.equal(q.workspace_id, 'fixture-workspace');
    assert.equal(q.columns, 'contact_id, status, disposition, answered_at, created_at');
    assert.equal(q.contact_id.length, 250);
  }
});

test('duplicate and empty IDs do not create extra chunks', async () => {
  const f = fixture();
  await f.service.fetchDialerCallStatsForContacts('fixture-workspace', [...ids(251), 'fixture-0', '']);
  assert.deepEqual(f.queries.map(q => q.contact_id.length), [250, 1]);
  assert.equal(new Set(f.queries.flatMap(q => q.contact_id)).size, 251);
});

test('empty input and missing workspace produce no reads', async () => {
  const f = fixture();
  assert.equal((await f.service.fetchDialerCallStatsForContacts('', ids(1))).totalCalls, 0);
  assert.equal((await f.service.fetchDialerCallStatsForContacts('fixture-workspace', [])).totalCalls, 0);
  assert.equal(f.queries.length, 0);
});

test('counts connected outcomes and chooses the newest call per contact', async () => {
  const recent = new Date().toISOString();
  const f = fixture({ rows: () => [
    { contact_id: 'a', status: 'missed', created_at: '2000-01-01T00:00:00Z' },
    { contact_id: 'a', status: 'answered', created_at: recent },
    { contact_id: 'b', disposition: 'appointment_set', created_at: recent },
    { contact_id: 'c', answered_at: recent, created_at: recent },
  ] });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['a', 'b', 'c']);
  assert.equal(s.totalCalls, 4);
  assert.equal(s.connectedCalls, 3);
  assert.equal(s.newCallsThisWeek, 3);
  assert.equal(s.connectedCallsThisWeek, 3);
  assert.equal(s.lastStatusByContactId.a.status, 'answered');
});

test('query errors reject instead of returning partial counts or starting later groups', async () => {
  const f = fixture({ failAt: 0 });
  await assert.rejects(f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(2000)), /fixture failure/);
  assert.ok(f.peak() <= 4);
  assert.ok(f.queries.length <= 4);
});

test('null rows preserve an empty statistics result', async () => {
  const f = fixture({ rows: () => null });
  assert.equal((await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(251))).totalCalls, 0);
});
