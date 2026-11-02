import { putExternalMapPayload } from './ExternalMapPayload';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Keep each API write below the gateway's body limit for large farm manifests.
 * v2 is usable after insert; v3 becomes visible only after its final update.
 * Immutable objects must already exist before calling this function.
 */
export async function publishCanonicalTileArtifact(db: SupabaseClient, row: Record<string, unknown>) {
  let { compact_bundle, ...legacy } = row;
  // Manifest records can exceed database request/statement limits on farms.
  // Publish immutable private objects before exposing their pointers.
  const bucket = String(row.bucket ?? '');
  const campaign = String(row.campaign_id ?? '');
  const externalize = async (value: unknown) => {
    const bundle = value as { asset_signature: string; tiles: { geometry_revision: string; geometry_pack?: Record<string, unknown> } };
    // The public API is stable across deployments; signed manifests can be read
    // directly without sending tens of megabytes through the function gateway.
    const prefix = `https://wolfgrid.app/api/campaigns/${encodeURIComponent(campaign)}/map-tiles/${bundle.tiles.geometry_revision}`;
    const prepared = { ...bundle, tiles: { ...bundle.tiles, tile_url_template: `${prefix}/{z}/{x}/{y}.mvt`, archive_url: `${prefix}/archive`,
      ...(bundle.tiles.geometry_pack ? { geometry_pack: { ...bundle.tiles.geometry_pack, url: `${prefix}/geometry` } } : {}) } };
    return { ...await putExternalMapPayload(bucket, campaign, prepared), asset_signature: bundle.asset_signature };
  };
  if (Buffer.byteLength(JSON.stringify(legacy.bundle)) > 4 * 1024 * 1024) {
    legacy = { ...legacy, bundle: await externalize(legacy.bundle) };
  }
  if (compact_bundle && Buffer.byteLength(JSON.stringify(compact_bundle)) > 4 * 1024 * 1024) {
    compact_bundle = await externalize(compact_bundle);
  }
  const inserted = await db.from('campaign_map_tile_artifacts').upsert(legacy, {
    onConflict: 'campaign_id,asset_signature', ignoreDuplicates: true,
  });
  if (inserted.error) throw new Error(`Tile metadata publication failed: ${inserted.error.message}`);
  const compact = await db.from('campaign_map_tile_artifacts').update({ compact_bundle })
    .eq('campaign_id', row.campaign_id).eq('asset_signature', row.asset_signature)
    .eq('canonical_signature', row.canonical_signature);
  if (compact.error) throw new Error(`Compact tile publication failed: ${compact.error.message}`);
}
