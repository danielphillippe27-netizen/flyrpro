import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalTileBundle } from '@/lib/map/canonicalTileBundle';

export type CanonicalTileArtifact = {
  campaign_id: string;
  asset_signature: string;
  canonical_signature: string;
  geometry_revision: string;
  bucket: string;
  archive_key: string;
  details_key: string;
  sha256: string;
  byte_length: number;
  bundle: CanonicalTileBundle;
};

// Immutable, revision-addressed metadata only. Authorization is checked by the
// route on every request before this cache is consulted.
const artifacts = new Map<string, { expires: number; value: CanonicalTileArtifact }>();

export async function readCanonicalTileBundle(
  db: SupabaseClient, campaignId: string, platform: string, baseUrl: string
): Promise<CanonicalTileBundle | null> {
  if (!['web', 'ios', 'android'].includes(platform)) return null;
  const { data: settings, error: settingsError } = await db.from('campaign_map_tile_settings')
    .select('*').eq('campaign_id', campaignId).maybeSingle();
  // A server upgraded before its database, or a non-pilot campaign, remains legacy.
  if (settingsError || !settings?.[`${platform}_enabled`]) return null;
  const { data: current, error: currentError } = await db.from('campaign_map_bundles')
    .select('asset_signature').eq('campaign_id', campaignId).eq('is_current', true).maybeSingle();
  if (currentError || !current) return null;
  const { data, error } = await db.from('campaign_map_tile_artifacts').select('bundle')
    .eq('campaign_id', campaignId).eq('canonical_signature', current.asset_signature)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const bundle = data.bundle as CanonicalTileBundle;
  const prefix = `${baseUrl}/api/campaigns/${encodeURIComponent(campaignId)}/map-tiles/${bundle.tiles.geometry_revision}`;
  return { ...bundle, tiles: { ...bundle.tiles, tile_url_template: `${prefix}/{z}/{x}/{y}.mvt`, archive_url: `${prefix}/archive` } };
}

export async function readCanonicalTileArtifact(db: SupabaseClient, campaignId: string, revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) return null;
  const key = `${campaignId}:${revision}`;
  const cached = artifacts.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const { data, error } = await db.from('campaign_map_tile_artifacts').select('*')
    .eq('campaign_id', campaignId).eq('geometry_revision', revision)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Campaign tile metadata unavailable: ${error.message}`);
  if (data) {
    artifacts.delete(key);
    artifacts.set(key, { expires: Date.now() + 60_000, value: data as CanonicalTileArtifact });
    if (artifacts.size > 256) artifacts.delete(artifacts.keys().next().value!);
  }
  return data as CanonicalTileArtifact | null;
}
