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

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('owner_id')
    .eq('id', row.workspace_id)
    .maybeSingle();

  if (workspace && (workspace as { owner_id: string }).owner_id === userId) {
    return true;
  }

  const { data: manager } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', row.workspace_id)
    .eq('user_id', userId)
    .maybeSingle();

  const managerRole = String((manager as { role?: string | null } | null)?.role ?? '').toLowerCase();
  if (managerRole === 'owner' || managerRole === 'admin') {
    return true;
  }

  const { data: assignment } = await supabase
    .from('campaign_assignments')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('assigned_to_user_id', userId)
    .in('status', ['accepted', 'in_progress'])
    .maybeSingle();

  if (assignment) {
    return true;
  }

  return false;
}
