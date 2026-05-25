import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureCampaignAccess(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<boolean> {
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, owner_id, workspace_id')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return false;
  }

  const row = campaign as { owner_id: string; workspace_id: string | null };
  if (row.owner_id === userId) {
    return true;
  }

  if (!row.workspace_id) {
    return false;
  }

  const { data: member } = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', row.workspace_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (member) {
    return true;
  }

  const { data: campaignMember } = await supabase
    .from('campaign_members')
    .select('user_id')
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();

  if (campaignMember) {
    return true;
  }

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('owner_id')
    .eq('id', row.workspace_id)
    .maybeSingle();

  return Boolean(workspace && (workspace as { owner_id: string }).owner_id === userId);
}
