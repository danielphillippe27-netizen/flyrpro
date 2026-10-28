import type { SupabaseClient } from '@supabase/supabase-js';
import type { CanonicalTileBundle } from '@/lib/map/canonicalTileBundle';
import type { CanonicalCompactBundle } from './CanonicalCompactBundle';

export type CanonicalTileArtifact = {
  campaign_id: string;
  asset_signature: string;
  canonical_signature: string;
  geometry_revision: string;
  bucket: string;
  archive_key: string;
  details_key: string;
  geometry_key?: string | null;
  sha256: string;
  byte_length: number;
  bundle: CanonicalTileBundle;
  compact_bundle?: CanonicalCompactBundle | null;
};

// Immutable, revision-addressed metadata only. Authorization is checked by the
// route on every request before this cache is consulted.
const artifacts = new Map<string, { expires: number; value: CanonicalTileArtifact }>();

async function readBundle(
  db: SupabaseClient, campaignId: string, platform: string, baseUrl: string, compact: boolean
): Promise<CanonicalTileBundle | CanonicalCompactBundle | null> {
  if (!['web', 'ios', 'android'].includes(platform)) return null;
  const { data: settings, error: settingsError } = await db.from('campaign_map_tile_settings')
    .select('*').eq('campaign_id', campaignId).maybeSingle();
  // A server upgraded before its database, or a non-pilot campaign, remains legacy.
  if (settingsError || !settings?.[`${platform}_enabled`]) return null;
  const { data: current, error: currentError } = await db.from('campaign_map_bundles')
    .select('asset_signature, links_status').eq('campaign_id', campaignId).eq('is_current', true).maybeSingle();
  if (currentError || !current) return null;
  if (current.links_status && current.links_status !== 'ready') return null;
  const { data, error } = await db.from('campaign_map_tile_artifacts').select(compact ? 'compact_bundle' : 'bundle')
    .eq('campaign_id', campaignId).eq('canonical_signature', current.asset_signature)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return null;
  const bundle = ('compact_bundle' in data ? data.compact_bundle : data.bundle) as CanonicalTileBundle | CanonicalCompactBundle | null;
  if (!bundle) return null;
  const prefix = `${baseUrl}/api/campaigns/${encodeURIComponent(campaignId)}/map-tiles/${bundle.tiles.geometry_revision}`;
  return { ...bundle, tiles: { ...bundle.tiles, tile_url_template: `${prefix}/{z}/{x}/{y}.mvt`, archive_url: `${prefix}/archive`,
    ...(bundle.tiles.geometry_pack ? { geometry_pack: { ...bundle.tiles.geometry_pack, url: `${prefix}/geometry` } } : {}) } };
}

export async function readCanonicalTileBundle(db: SupabaseClient, campaignId: string, platform: string, baseUrl: string) {
  return await readBundle(db, campaignId, platform, baseUrl, false) as CanonicalTileBundle | null;
}

export async function readCanonicalCompactBundle(db: SupabaseClient, campaignId: string, platform: string, baseUrl: string) {
  return await readBundle(db, campaignId, platform, baseUrl, true) as CanonicalCompactBundle | null;
}

/** Report why a tile-only client cannot open a campaign yet.  A missing
 * artifact is never treated as permission to fall back silently. */
export async function canonicalTileAvailability(db: SupabaseClient, campaignId: string, platform: string) {
  if (!['web', 'ios', 'android'].includes(platform)) return 'disabled' as const;
  const { data: settings, error: settingsError } = await db.from('campaign_map_tile_settings')
    .select('*').eq('campaign_id', campaignId).maybeSingle();
  if (settingsError) return 'unavailable' as const;
  // The first bundle creates the settings row. Until then, distinguish a new
  // campaign from an older one so clients cannot fall back during provisioning.
  if (!settings) {
    const [campaign, rollout] = await Promise.all([
      db.from('campaigns').select('created_at').eq('id', campaignId).maybeSingle(),
      db.from('campaign_map_tile_rollout_control').select('new_campaigns_after').eq('singleton', true).maybeSingle(),
    ]);
    if (campaign.error || rollout.error || !campaign.data || !rollout.data) return 'unavailable' as const;
    const createdAt = Date.parse(campaign.data.created_at);
    const cutover = Date.parse(rollout.data.new_campaigns_after);
    if (!Number.isFinite(createdAt) || !Number.isFinite(cutover)) return 'unavailable' as const;
    return createdAt >= cutover
      ? 'preparing' as const : 'disabled' as const;
  }
  if (!settings?.[`${platform}_enabled`]) return 'disabled' as const;
  const { data: current, error: currentError } = await db.from('campaign_map_bundles')
    .select('asset_signature, links_status').eq('campaign_id', campaignId).eq('is_current', true).maybeSingle();
  if (currentError) return 'unavailable' as const;
  if (!current) return 'preparing' as const;
  if (current.links_status === 'linking_failed') return 'failed' as const;
  if (current.links_status && current.links_status !== 'ready') return 'preparing' as const;
  const { data: job, error: jobError } = await db.from('campaign_map_tile_jobs')
    .select('status').eq('campaign_id', campaignId).eq('canonical_signature', current.asset_signature).maybeSingle();
  if (jobError) return 'unavailable' as const;
  if (job?.status === 'failed') return 'failed' as const;
  if (job?.status === 'succeeded') return 'unavailable' as const;
  return 'preparing' as const;
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
