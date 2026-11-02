import type { SupabaseClient } from '@supabase/supabase-js';

export async function invalidateDeletedMap(db: SupabaseClient, campaignId: string): Promise<void> {
  const { error } = await db.rpc('invalidate_campaign_map_bundle', { p_campaign_id: campaignId });
  if (!error) return;
  const { error: fallback } = await db.from('campaign_map_bundles')
    .update({ is_current: false, expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId).eq('is_current', true);
  if (fallback) console.error('[location-delete] Failed to invalidate map:', fallback.message);
}
