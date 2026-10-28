import type { SupabaseClient } from '@supabase/supabase-js';

/** Keep each API write below the gateway's body limit for large farm manifests.
 * v2 is usable after insert; v3 becomes visible only after its final update.
 * Immutable objects must already exist before calling this function.
 */
export async function publishCanonicalTileArtifact(db: SupabaseClient, row: Record<string, unknown>) {
  const { compact_bundle, ...legacy } = row;
  const inserted = await db.from('campaign_map_tile_artifacts').upsert(legacy, {
    onConflict: 'campaign_id,asset_signature', ignoreDuplicates: true,
  });
  if (inserted.error) throw new Error(`Tile metadata publication failed: ${inserted.error.message}`);
  const compact = await db.from('campaign_map_tile_artifacts').update({ compact_bundle })
    .eq('campaign_id', row.campaign_id).eq('asset_signature', row.asset_signature)
    .eq('canonical_signature', row.canonical_signature);
  if (compact.error) throw new Error(`Compact tile publication failed: ${compact.error.message}`);
}
