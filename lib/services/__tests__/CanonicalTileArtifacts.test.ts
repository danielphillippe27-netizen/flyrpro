import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalTileBundle } from '@/lib/map/canonicalTileBundle';
import { makeCanonicalCompactBundle } from '../CanonicalCompactBundle';
import { canonicalTileAvailability, readCanonicalCompactBundle, readCanonicalTileBundle, readCanonicalTileArtifact } from '../CanonicalTileArtifacts';

const base = {
  schema: 'tiles-v2', campaign_id: 'campaign', asset_signature: 'legacy', canonical_signature: 'current', source_version: '1',
  tiles: { geometry_revision: 'revision', tile_url_template: '', archive_url: '', sha256: 'hash', byte_length: 1,
    bounds: [0, 0, 1, 1], layers: {}, geometry_pack: { url: '', sha256: 'geometry-hash', byte_length: 1, count: 0 } },
  records: { addresses: [], buildings: [], parcels: [] }, links: [], address_orphans: [], building_orphans: [], building_units: [],
  roads: { type: 'FeatureCollection', features: [] }, counts: {}, display_mode_hint: 'buildings', links_status: 'ready',
  reconciliation: {}, reconciliation_report: {},
} as CanonicalTileBundle;
const compact = makeCanonicalCompactBundle(base);

function database(enabled: boolean, compactAvailable: boolean, jobStatus?: string, linksStatus = 'ready'): SupabaseClient {
  return {
    from(table: string) {
      let selection = '';
      const query = {
        select(value: string) { selection = value; return query; },
        eq() { return query; }, order() { return query; }, limit() { return query; },
        async maybeSingle() {
          if (table === 'campaign_map_tile_settings') return { data: { ios_enabled: enabled }, error: null };
          if (table === 'campaign_map_bundles') return { data: { asset_signature: 'current', links_status: linksStatus }, error: null };
          if (table === 'campaign_map_tile_jobs') return { data: jobStatus ? { status: jobStatus } : null, error: null };
          return { data: selection === 'compact_bundle' ? { compact_bundle: compactAvailable ? compact : null } : { bundle: base }, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

async function main() {
  const db = database(true, true);
  const v2 = await readCanonicalTileBundle(db, 'campaign', 'ios', 'https://example.test');
  const v3 = await readCanonicalCompactBundle(db, 'campaign', 'ios', 'https://example.test');
  assert.equal(v2?.schema, 'tiles-v2');
  assert.equal(v3?.schema, 'tiles-v3');
  assert.equal(v3?.tiles.geometry_pack?.url, 'https://example.test/api/campaigns/campaign/map-tiles/revision/geometry');
  assert.notEqual(v2?.asset_signature, v3?.asset_signature);
  assert.equal(await readCanonicalCompactBundle(database(true, false), 'campaign', 'ios', 'https://example.test'), null);
  assert.equal(await readCanonicalCompactBundle(database(false, true), 'campaign', 'ios', 'https://example.test'), null);
  assert.equal(await canonicalTileAvailability(database(false, false), 'campaign', 'ios'), 'disabled');
  assert.equal(await canonicalTileAvailability(database(true, false, 'queued'), 'campaign', 'ios'), 'preparing');
  assert.equal(await canonicalTileAvailability(database(true, false, 'running'), 'campaign', 'ios'), 'preparing');
  assert.equal(await canonicalTileAvailability(database(true, false, 'failed'), 'campaign', 'ios'), 'failed');
  assert.equal(await canonicalTileAvailability(database(true, false, 'succeeded'), 'campaign', 'ios'), 'unavailable');
  assert.equal(await readCanonicalCompactBundle(database(true, true, 'succeeded', 'pending_provision'), 'campaign', 'ios', 'https://example.test'), null);
  assert.equal(await canonicalTileAvailability(database(true, true, 'succeeded', 'pending_provision'), 'campaign', 'ios'), 'preparing');
  assert.equal(await canonicalTileAvailability(database(true, true, 'failed', 'linking_failed'), 'campaign', 'ios'), 'failed');
  assert.equal(await canonicalTileAvailability(database(true, false), 'campaign', 'other'), 'disabled');
  const beforeSettings = (createdAt: string): SupabaseClient => ({ from(table: string) {
    const chain = { select() { return chain; }, eq() { return chain; }, async maybeSingle() {
      if (table === 'campaign_map_tile_settings') return { data: null, error: null };
      if (table === 'campaigns') return { data: { created_at: createdAt }, error: null };
      return { data: { new_campaigns_after: '2026-10-28T00:00:00Z' }, error: null };
    } }; return chain;
  } }) as unknown as SupabaseClient;
  assert.equal(await canonicalTileAvailability(beforeSettings('2026-10-28T01:00:00Z'), 'campaign', 'web'), 'preparing');
  assert.equal(await canonicalTileAvailability(beforeSettings('2026-10-27T23:00:00Z'), 'campaign', 'web'), 'disabled');
  let metadataReads = 0;
  let metadataSelection = '';
  const metadataDb = { from() {
    const query = { select(fields: string) { metadataSelection = fields; return query; }, eq() { return query; }, order() { return query; }, limit() { return query; },
      async maybeSingle() { metadataReads++; await Promise.resolve(); return { data: { campaign_id: 'large-farm', archive_key: 'map.pmtiles' }, error: null }; } };
    return query;
  } } as unknown as SupabaseClient;
  const revision = 'a'.repeat(64);
  const [first, second] = await Promise.all([readCanonicalTileArtifact(metadataDb, 'large-farm', revision), readCanonicalTileArtifact(metadataDb, 'large-farm', revision)]);
  assert.equal(metadataReads, 1, 'Concurrent tile requests share a metadata read');
  assert.equal(first, second);
  assert(!metadataSelection.includes('*') && !metadataSelection.includes('bundle'), 'Never download manifests for individual tiles');
  await readCanonicalTileArtifact(metadataDb, 'large-farm', revision);
  assert.equal(metadataReads, 1, 'Subsequent tiles reuse cached metadata');
  console.log('PASS: metadata-only tile reads, coalesced concurrent lookups, independent compact and legacy versions, authenticated URLs and rollout fallback');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
