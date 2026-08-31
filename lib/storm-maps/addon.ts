import type { WorkspaceBillingAddon } from '@/types/database';
import type { createAdminClient } from '@/lib/supabase/server';

export const STORM_MAPS_ADDON_KEY = 'storm_maps' as const;

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export function isStormMapsBetaAvailable() {
  return process.env.STORM_MAPS_BETA_AVAILABLE === 'true'
    && Boolean(process.env.TOMORROW_IO_API_KEY)
    && Boolean(process.env.STORM_MAPS_SIGNING_SECRET)
    && Boolean(process.env.WEATHER_PROVIDER_CONTACT_EMAIL);
}

export async function getWorkspaceStormMapsAddon(
  admin: SupabaseAdmin,
  workspaceId: string,
): Promise<WorkspaceBillingAddon | null> {
  const { data } = await admin
    .from('workspace_billing_addons')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('addon_key', STORM_MAPS_ADDON_KEY)
    .maybeSingle();

  return data ? (data as WorkspaceBillingAddon) : null;
}

export async function isWorkspaceStormMapsActive(admin: SupabaseAdmin, workspaceId: string) {
  if (!isStormMapsBetaAvailable()) return false;
  const addon = await getWorkspaceStormMapsAddon(admin, workspaceId);
  return addon?.status === 'active';
}
