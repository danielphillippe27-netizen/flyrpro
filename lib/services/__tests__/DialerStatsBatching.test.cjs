// Run with node --test; requires the existing TypeScript dev dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ rows, failAt, delay = 10, apiCap = 1000 } = {}) {
  const queries = [];
  let active = 0;
  let peak = 0;
  const client = { from(table) {
    const query = { table, orders: [] };
    const builder = {
      select(columns) { query.columns = columns; return this; },
      eq(column, value) { query[column] = value; return this; },
      in(column, values) { query[column] = Array.from(values); return this; },
      order(column, options) { query.orders.push({ column, ...options }); return this; },
      range(from, to) { query.from = from; query.to = to; return this; },
      then(resolve, reject) {
        const index = queries.length;
        queries.push(query); active++; peak = Math.max(peak, active);
        return new Promise(done => setTimeout(() => {
          active--;
          let data = rows ? rows(query, index) : [{ contact_id: query.contact_id[0], status: 'answered', created_at: new Date().toISOString() }];
          if (data) {
            if (query.orders.some(order => order.column === 'id')) {
              data = [...data].sort((a, b) => String(a.id).localeCompare(String(b.id)));
            }
            const from = query.from || 0;
            data = data.slice(from, Math.min(query.to === undefined ? from + apiCap : query.to + 1, from + apiCap));
          }
          done(index === failAt ? { data: null, error: { message: 'fixture failure' } } : { data, error: null });
        }, delay)).then(resolve, reject);
      },
    };
    return builder;
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
  return { service: module.exports.StatsService, queries, peak: () => peak, active: () => active };
}
const ids = n => Array.from({ length: n }, (_, i) => `fixture-${i}`);

test('independent chunks overlap with a hard cap of four and preserve tenant/projection', async () => {
  const f = fixture();
  const stats = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(2000));
  assert.equal(f.queries.length, 16);
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
  assert.deepEqual(f.queries.map(q => q.contact_id.length), [250, 1, 250, 1]);
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

function callHistory(count) {
  const now = Date.now() - count * 1000;
  return Array.from({ length: count }, (_, index) => ({
    id: String(index).padStart(6, '0'),
    contact_id: 'fixture-0',
    status: index >= 1000 ? 'answered' : 'missed',
    created_at: new Date(now + index * 1000).toISOString(),
  }));
}

test('reads history beyond the standard 1000-row API cap and finds the newest call', async () => {
  const history = callHistory(1250);
  const f = fixture({ rows: () => history });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']);
  assert.equal(s.totalCalls, 1250);
  assert.equal(s.connectedCalls, 250);
  assert.equal(s.lastStatusByContactId['fixture-0'].status, 'answered');
  assert.deepEqual(f.queries.map(q => [q.from, q.to]), [[0, 999], [1000, 1999], [1250, 2249]]);
  assert.ok(f.queries.every(q => q.orders.some(order => order.column === 'id' && order.ascending === true)));
});

test('exact page boundary checks the final empty page without double counting', async () => {
  const history = callHistory(1000);
  const f = fixture({ rows: () => history });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']);
  assert.equal(s.totalCalls, 1000);
  assert.deepEqual(f.queries.map(q => q.from), [0, 1000]);
});

test('later-page failure rejects instead of reporting a partial history', async () => {
  const f = fixture({ rows: () => callHistory(1250), failAt: 1 });
  await assert.rejects(f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']), /fixture failure/);
  assert.equal(f.queries.length, 2);
});

test('multiple chunks remain capped at four reads across full history pages', async () => {
  const f = fixture({ rows: q => callHistory(1250).map(call => ({ ...call, contact_id: q.contact_id[0] })) });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(2000));
  assert.equal(s.totalCalls, 8 * 1250);
  assert.equal(s.connectedCalls, 8 * 250);
  assert.equal(f.queries.length, 24);
  assert.equal(f.peak(), 4);
  assert.ok(f.queries.every(q => q.workspace_id === 'fixture-workspace' && q.contact_id.length <= 250));
});

test('same-time calls spanning pages use stable ID order for deterministic last status', async () => {
  const stamp = new Date().toISOString();
  const history = callHistory(1001).map(call => ({ ...call, created_at: stamp }));
  history.reverse();
  const f = fixture({ rows: () => history });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']);
  assert.equal(s.totalCalls, 1001);
  assert.equal(s.lastStatusByContactId['fixture-0'].status, 'answered');
});

test('all history totals remain correct across several pages and an empty final page', async () => {
  const history = callHistory(3000);
  const f = fixture({ rows: () => history, delay: 0 });
  const s = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']);
  assert.equal(s.totalCalls, 3000);
  assert.equal(s.connectedCalls, 2000);
  assert.deepEqual(f.queries.map(q => q.from), [0, 1000, 2000, 3000]);
});

test('a failed chunk stops later pages and drains active reads before rejecting', async () => {
  const f = fixture({ rows: q => callHistory(3000).map(call => ({ ...call, contact_id: q.contact_id[0] })), failAt: 0 });
  await assert.rejects(f.service.fetchDialerCallStatsForContacts('fixture-workspace', ids(2000)), /fixture failure/);
  assert.equal(f.active(), 0, 'no read promises should remain active after rejection');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(f.queries.length, 4, 'other chunks must not keep fetching after the first failure');
});


test('a lower server cap cannot truncate a 1250-call history', async () => {
  const f = fixture({ rows: () => callHistory(1250), apiCap: 500 });
  const stats = await f.service.fetchDialerCallStatsForContacts('fixture-workspace', ['fixture-0']);
  assert.equal(stats.totalCalls, 1250);
  assert.equal(stats.connectedCalls, 250);
  assert.equal(stats.lastStatusByContactId['fixture-0'].status, 'answered');
  assert.deepEqual(f.queries.map(q => q.from), [0, 500, 1000, 1250]);
});
