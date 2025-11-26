// Campaign-specific types and utilities

import type { CampaignV2, CampaignAddress, CampaignType, AddressSource, CampaignStatus } from './database';

export { type CampaignV2, type CampaignAddress, type CampaignType, type AddressSource, type CampaignStatus };

export interface CreateCampaignPayload {
  name: string;
  type: CampaignType;
  address_source: AddressSource;
  seed_query?: string;
  addresses?: Omit<CampaignAddress, 'id' | 'campaign_id' | 'created_at'>[];
}

export interface CampaignWithAddresses extends CampaignV2 {
  addresses: CampaignAddress[];
}

