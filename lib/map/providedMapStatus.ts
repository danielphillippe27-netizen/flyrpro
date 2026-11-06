import type { CampaignAddress } from '@/types/database';

/** Cycle outcomes own display status; campaign revisions still own geometry. */
export function applyProvidedMapStatus(address: CampaignAddress, provided?: CampaignAddress): CampaignAddress {
  return {
    ...address,
    address_status: provided?.address_status ?? 'none',
    visited: provided?.visited ?? false,
    scans: provided?.scans ?? 0,
    last_scanned_at: provided?.last_scanned_at,
    status_revision: undefined,
    last_action_by: undefined,
    last_action_actor_name: undefined,
  };
}
