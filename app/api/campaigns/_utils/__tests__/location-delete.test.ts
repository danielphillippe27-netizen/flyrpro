import assert from 'node:assert/strict';
import { deleteBuildingDeep } from '../location-delete';

async function main() {
  const calls: Array<{ table: string; operation: string; column?: string; value?: unknown }> = [];
  const db = {
    from(table: string) {
      let operation = 'select';
      // This small fluent fake models the Supabase query builder.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        select() { return query; }, limit() { return query; }, maybeSingle() { return query; },
        eq(column: string, value: unknown) {
          calls.push({ table, operation, column, value });
          if ((column === 'id' || column === 'building_id') && typeof value === 'string' && value.startsWith('durham_')) {
            throw new Error('external id used against UUID column');
          }
          return query;
        },
        in(column: string, value: unknown[]) {
          calls.push({ table, operation, column, value });
          if (table === 'campaign_addresses' && column === 'building_id') {
            assert.ok(value.every(id => typeof id === 'string' && !id.startsWith('durham_')));
          }
          return query;
        },
        upsert() { operation = 'upsert'; calls.push({ table, operation }); return query; },
        delete() { operation = 'delete'; return query; },
        then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve({ data: table === 'buildings' ? null : [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const result = await deleteBuildingDeep(db as never, 'campaign-1', 'durham_buildings:262575');
  assert.equal(result.found, true);
  assert.equal(result.buildingId, 'durham_buildings:262575');
  assert.ok(calls.some(call => call.table === 'campaign_hidden_buildings' && call.operation === 'upsert'));
  assert.ok(calls.some(call => call.table === 'building_address_links' && call.column === 'building_id'));
  console.log('Unlinked external building deletion uses campaign suppression without invalid UUID queries.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
