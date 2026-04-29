import type { SupabaseClient } from '@supabase/supabase-js';

export type CampaignMapMode = 'smart_buildings' | 'hybrid' | 'standard_pins';

export interface CampaignMapModeAssessment {
  hasParcels: boolean;
  parcelCount: number;
  totalAddresses: number;
  linkedAddressCount: number;
  buildingLinkConfidence: number;
  mapMode: CampaignMapMode;
}

export interface CampaignMapModeComputationOptions {
  hasParcels?: boolean;
  parcelCount?: number;
  totalAddresses?: number;
  linkedAddressCount?: number;
}

export const SMART_BUILDINGS_LINK_THRESHOLD = 90;
export const HYBRID_LINK_THRESHOLD = 60;
export const ACCEPTABLE_LINK_CONFIDENCE_SCORE = 0.6;

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveCampaignMapMode(input: {
  hasParcels: boolean;
  buildingLinkConfidence: number;
}): CampaignMapMode {
  if (input.hasParcels) {
    return input.buildingLinkConfidence >= SMART_BUILDINGS_LINK_THRESHOLD
      ? 'smart_buildings'
      : 'hybrid';
  }

  if (input.buildingLinkConfidence >= SMART_BUILDINGS_LINK_THRESHOLD) {
    return 'smart_buildings';
  }

  if (input.buildingLinkConfidence >= HYBRID_LINK_THRESHOLD) {
    return 'hybrid';
  }

  return 'standard_pins';
}

export class CampaignMapModeService {
  constructor(private readonly supabase: SupabaseClient) {}

  async computeAssessment(
    campaignId: string,
    options: CampaignMapModeComputationOptions = {}
  ): Promise<CampaignMapModeAssessment> {
    const totalAddresses = options.totalAddresses ?? await this.fetchTotalAddresses(campaignId);
    const linkedAddressCount = options.linkedAddressCount ?? await this.fetchLinkedAddressCount(campaignId);
    const parcelCount = options.parcelCount ?? await this.fetchParcelCount(campaignId);
    const hasParcels = options.hasParcels ?? parcelCount > 0;
    const buildingLinkConfidence =
      totalAddresses > 0 ? roundPercentage((linkedAddressCount / totalAddresses) * 100) : 0;

    return {
      hasParcels,
      parcelCount,
      totalAddresses,
      linkedAddressCount,
      buildingLinkConfidence,
      mapMode: resolveCampaignMapMode({
        hasParcels,
        buildingLinkConfidence,
      }),
    };
  }

  async computeAndPersist(
    campaignId: string,
    options: CampaignMapModeComputationOptions = {}
  ): Promise<CampaignMapModeAssessment> {
    const assessment = await this.computeAssessment(campaignId, options);

    const { error } = await this.supabase
      .from('campaigns')
      .update({
        has_parcels: assessment.hasParcels,
        building_link_confidence: assessment.buildingLinkConfidence,
        map_mode: assessment.mapMode,
      })
      .eq('id', campaignId);

    if (error) {
      throw new Error(`Failed to persist campaign map mode: ${error.message}`);
    }

    return assessment;
  }

  private async fetchTotalAddresses(campaignId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('campaign_addresses')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    if (error) {
      throw new Error(`Failed to count campaign addresses: ${error.message}`);
    }

    return count ?? 0;
  }

  private async fetchLinkedAddressCount(campaignId: string): Promise<number> {
    const linkedAddressIds = new Set<string>();

    const { data: goldRows, error: goldError } = await this.supabase
      .from('campaign_addresses')
      .select('id')
      .eq('campaign_id', campaignId)
      .not('building_id', 'is', null);

    if (goldError) {
      throw new Error(`Failed to count Gold linked addresses: ${goldError.message}`);
    }

    for (const row of goldRows ?? []) {
      if (typeof row.id === 'string') linkedAddressIds.add(row.id);
    }

    const confidenceColumns = ['confidence', 'confidence_score'];

    for (const column of confidenceColumns) {
      const { data, error } = await this.supabase
        .from('building_address_links')
        .select('address_id')
        .eq('campaign_id', campaignId)
        .gte(column, ACCEPTABLE_LINK_CONFIDENCE_SCORE);

      if (!error) {
        for (const row of data ?? []) {
          if (typeof row.address_id === 'string') linkedAddressIds.add(row.address_id);
        }
        return linkedAddressIds.size;
      }
    }

    throw new Error('Failed to count linked addresses using confidence or confidence_score.');
  }

  private async fetchParcelCount(campaignId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('campaign_parcels')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    if (error) {
      throw new Error(`Failed to count campaign parcels: ${error.message}`);
    }

    return count ?? 0;
  }
}
