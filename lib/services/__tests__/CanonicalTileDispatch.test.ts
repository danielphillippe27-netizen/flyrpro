import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchCanonicalTileBuild } from '../CanonicalTileDispatch';

async function main() {
  let reads = 0, invokes = 0;
  let status: string | undefined = 'queued';
  let error: Error | null = null;
  const filters: Record<string, string> = {};
  const db = { from(table: string) {
    assert.equal(table, 'campaign_map_tile_jobs');
    const query = { select() { return query; }, eq(key: string, value: string) { filters[key] = value; return query; },
      async maybeSingle() { reads++; return { data: status ? { status } : null, error }; } };
    return query;
  } } as unknown as SupabaseClient;
  const bundle = { campaign_id: 'new-campaign', asset_signature: 'current-revision', links_status: 'ready' };
  const dispatch = async () => { invokes++; };
  assert.equal(await dispatchCanonicalTileBuild(db, { ...bundle, links_status: 'pending_provision' }, dispatch), false);
  assert.equal(reads, 0, 'Provisional maps must not dispatch a tile build');
  assert.equal(await dispatchCanonicalTileBuild(db, bundle, dispatch), true);
  assert.deepEqual(filters, { campaign_id: bundle.campaign_id, canonical_signature: bundle.asset_signature });
  for (status of [undefined, 'running', 'succeeded', 'failed', 'superseded']) {
    assert.equal(await dispatchCanonicalTileBuild(db, bundle, dispatch), false);
  }
  assert.equal(invokes, 1, 'Only queued work for the exact revision wakes the worker');
  status = 'queued';
  assert.equal(await dispatchCanonicalTileBuild(db, bundle, async () => { throw new Error('offline'); }), false);
  error = new Error('database unavailable');
  assert.equal(await dispatchCanonicalTileBuild(db, bundle, dispatch), false);
  console.log('PASS: finalized maps dispatch existing queued work, skip all other states, and retain scheduled recovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
