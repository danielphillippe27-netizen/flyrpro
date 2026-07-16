import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureCampaignAccess(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_view_campaign', {
    p_campaign_id: campaignId,
    p_user_id: userId,
  });
  return !error && data === true;
}

export async function ensureCampaignAddressMutationAccess(
  supabase: SupabaseClient,
  campaignId: string,
  addressId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_mutate_campaign_address', {
    p_campaign_id: campaignId,
    p_campaign_address_id: addressId,
    p_user_id: userId,
  });
  return !error && data === true;
}

export async function ensureCampaignManagerAccess(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_manage_campaign', {
    p_campaign_id: campaignId,
    p_user_id: userId,
  });
  return !error && data === true;
}
