// Executes actual source with an isolated query fixture and the installed Turf math.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const turf = require('@turf/turf');

const center = [-78, 43];
const home = {
  id: 'home', campaign_id: 'campaign-a', is_hidden: false,
  geom: JSON.stringify({ type: 'Polygon', coordinates: [[[-78,43],[-77.99999,43],[-78,43.00001],[-78,43]]] }),
  centroid: JSON.stringify({ type: 'Point', coordinates: center }),
};
function neighbor(id, campaign, meters, hidden = false) {
  return { ...home, id, campaign_id: campaign, is_hidden: hidden,
    centroid: JSON.stringify(turf.destination(turf.point(center), meters, 90, { units: 'meters' }).geometry) };
}
function fixture(rows) {
  const queries = [];
  const client = { from(table) {
    const filters = [];
    return {
      select() { return this; },
      eq(column, value) { filters.push({ column, value, equal: true }); return this; },
      neq(column, value) { filters.push({ column, value, equal: false }); return this; },
      async limit(limit) {
        const data = rows.filter(row => filters.every(f => f.equal ? row[f.column] === f.value : row[f.column] !== f.value)).slice(0, limit);
        queries.push({ table, filters, returned: data.length });
        return { data, error: null };
      },
    };
  }};
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../BuildingService.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === '@/lib/supabase/client') return { createClient: () => client };
      if (name === '@turf/turf') return turf;
      throw new Error('Unexpected dependency ' + name);
    },
  }, { timeout: 1000 });
  return { service: module.exports.BuildingService, queries };
}

test('implicit scope comes from the building rather than closer foreign-campaign rows', async () => {
  const f = fixture([neighbor('foreign', 'campaign-b', 5), neighbor('own', 'campaign-a', 20)]);
  const rows = await f.service.findNearestNeighbors(home);
  assert.deepEqual(Array.from(rows, row => row.building.id), ['own']);
  assert.ok(f.queries[0].filters.some(f => f.column === 'campaign_id' && f.value === 'campaign-a'));
});

test('explicit campaign override remains supported', async () => {
  const f = fixture([neighbor('foreign', 'campaign-b', 5), neighbor('own', 'campaign-a', 20)]);
  const rows = await f.service.findNearestNeighbors(home, 50, 3, 'campaign-b');
  assert.deepEqual(Array.from(rows, row => row.building.id), ['foreign']);
});

test('hidden, radius, exclusion and nearest-count behavior are unchanged within scope', async () => {
  const f = fixture([home, neighbor('hidden', 'campaign-a', 1, true), neighbor('far', 'campaign-a', 100),
    neighbor('near', 'campaign-a', 10), neighbor('second', 'campaign-a', 20), neighbor('third', 'campaign-a', 30)]);
  const rows = await f.service.findNearestNeighbors(home, 50, 2);
  assert.deepEqual(Array.from(rows, row => row.building.id), ['near', 'second']);
});

test('missing campaign context fails closed before issuing a global query', async () => {
  const f = fixture([neighbor('foreign', 'campaign-b', 5)]);
  const rows = await f.service.findNearestNeighbors({ ...home, campaign_id: undefined });
  assert.equal(rows.length, 0);
  assert.equal(f.queries.length, 0);
});

test('unrelated campaigns cannot exhaust the candidate cap before own neighbors are fetched', async () => {
  const rows = [...Array.from({ length: 101 }, (_, i) => neighbor('foreign-' + i, 'campaign-b', 5)),
    neighbor('own', 'campaign-a', 20)];
  const f = fixture(rows);
  const result = await f.service.findNearestNeighbors(home);
  assert.deepEqual(Array.from(result, row => row.building.id), ['own']);
  assert.equal(f.queries[0].returned, 1);
});
