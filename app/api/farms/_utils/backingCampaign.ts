import { farmCampaignMarker } from '@/lib/farms/backingCampaign';

type AdminClient = {
  // PostgREST builders are chain-heavy; keep this helper lightweight.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type FarmCampaignRow = {
  id: string;
  owner_id: string;
  workspace_id?: string | null;
  name: string;
  description?: string | null;
  polygon?: string | null;
  home_limit?: number | null;
  linked_campaign_id?: string | null;
};

const FARM_SELECT_BASE = 'id, owner_id, workspace_id, name, description, polygon';

export function formatApiError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const candidate = error as { message?: string; details?: string | null; hint?: string | null };
  return [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' | ') || 'Unknown error';
}

export function isMissingFarmColumnError(error: unknown, column: string): boolean {
  const message = formatApiError(error).toLowerCase();
  return (
    message.includes(`could not find the '${column}' column`) ||
    message.includes(`column farms.${column}`) ||
    message.includes(`${column} does not exist`)
  );
}

export async function selectFarmCampaignRow(
  admin: AdminClient,
  farmId: string
): Promise<{ farm: FarmCampaignRow | null; hasLinkedCampaignColumn: boolean }> {
  let hasLinkedCampaignColumn = true;
  let hasHomeLimitColumn = true;
  let { data, error } = await admin
    .from('farms')
    .select(`${FARM_SELECT_BASE}, home_limit, linked_campaign_id`)
    .eq('id', farmId)
    .maybeSingle();

  if (error && isMissingFarmColumnError(error, 'home_limit')) {
    hasHomeLimitColumn = false;
    const fallback = await admin
      .from('farms')
      .select(`${FARM_SELECT_BASE}, linked_campaign_id`)
      .eq('id', farmId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error && isMissingFarmColumnError(error, 'linked_campaign_id')) {
    hasLinkedCampaignColumn = false;
    const fallback = await admin
      .from('farms')
      .select(hasHomeLimitColumn ? `${FARM_SELECT_BASE}, home_limit` : FARM_SELECT_BASE)
      .eq('id', farmId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) {
    return { farm: null, hasLinkedCampaignColumn };
  }

  return { farm: data as FarmCampaignRow, hasLinkedCampaignColumn };
}

export async function userCanAccessFarm(
  admin: AdminClient,
  userId: string,
  farm: FarmCampaignRow
): Promise<boolean> {
  if (farm.owner_id === userId) return true;
  if (!farm.workspace_id) return false;

  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', farm.workspace_id)
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(membership?.workspace_id);
}

export async function persistLinkedCampaignIdIfPossible(
  admin: AdminClient,
  farmId: string,
  campaignId: string,
  hasLinkedCampaignColumn: boolean
): Promise<void> {
  if (!hasLinkedCampaignColumn) return;

  const { error } = await admin
    .from('farms')
    .update({ linked_campaign_id: campaignId })
    .eq('id', farmId);

  if (error && !isMissingFarmColumnError(error, 'linked_campaign_id')) {
    throw new Error(formatApiError(error));
  }
}

export async function resolveBackingCampaignId(
  admin: AdminClient,
  farm: FarmCampaignRow,
  hasLinkedCampaignColumn: boolean
): Promise<string | null> {
  if (hasLinkedCampaignColumn && farm.linked_campaign_id) {
    const { data: linkedCampaign } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', farm.linked_campaign_id)
      .maybeSingle();

    if (linkedCampaign?.id) return linkedCampaign.id;
  }

  const marker = farmCampaignMarker(farm.id);
  let query = admin
    .from('campaigns')
    .select('id')
    .eq('owner_id', farm.owner_id)
    .ilike('description', `%${marker}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  query = farm.workspace_id ? query.eq('workspace_id', farm.workspace_id) : query.is('workspace_id', null);

  const { data } = await query;
  const campaignId = Array.isArray(data) && data[0]?.id ? data[0].id : null;

  if (campaignId) {
    await persistLinkedCampaignIdIfPossible(admin, farm.id, campaignId, hasLinkedCampaignColumn);
  }

  return campaignId;
}
