import type { SupabaseClient } from '@supabase/supabase-js';
import { BedrockCountryService, BEDROCK_CANADA_CONFIG, BEDROCK_US_CONFIG } from '@/lib/services/BedrockCountryService';
import { prebuildCampaignMapBundle } from '@/lib/services/CampaignMapBundlePrebuilder';

/** Publish a canonical farm map; the existing worker then builds its PMTiles archive. */
export async function prepareFarmMap(db: SupabaseClient, farmId: string, country: 'CA' | 'US', region: string) {
  let campaignId = '';
  let afterId: string | null = null;
  do {
    const seeded = await db.rpc('prepare_farm_map_addresses', { p_farm_id: farmId, p_after_id: afterId });
    if (seeded.error || !seeded.data) throw new Error(seeded.error?.message ?? 'Farm map addresses could not be prepared.');
    campaignId = seeded.data.campaign_id;
    afterId = seeded.data.next_id;
  } while (afterId);
  const service = new BedrockCountryService(country === 'CA' ? BEDROCK_CANADA_CONFIG : BEDROCK_US_CONFIG);
  const snapshot = await service.staticSnapshotForCampaign(campaignId, region);
  const { count, error: countError } = await db.from('campaign_addresses').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (countError) throw countError;
  const { error } = await db.from('campaign_snapshots').upsert({
    campaign_id: campaignId, bucket: snapshot.bucket, prefix: snapshot.prefix,
    buildings_key: snapshot.s3_keys.buildings, addresses_key: snapshot.s3_keys.addresses,
    metadata_key: snapshot.s3_keys.metadata, buildings_url: snapshot.urls.buildings,
    addresses_url: snapshot.urls.addresses, metadata_url: snapshot.urls.metadata,
    buildings_count: 0, addresses_count: count ?? 0,
    overture_release: snapshot.metadata?.overture_release, tile_metrics: snapshot.metadata?.tile_metrics ?? null,
    expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  }, { onConflict: 'campaign_id' });
  if (error) throw error;
  await prebuildCampaignMapBundle(db, campaignId);
  return campaignId;
}
