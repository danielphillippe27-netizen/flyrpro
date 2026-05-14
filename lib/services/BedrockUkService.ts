import { BedrockCountryService, BEDROCK_UK_CONFIG } from '@/lib/services/BedrockCountryService';

const UK_REGIONS = new Set([
  'GB',
]);

const service = new BedrockCountryService(BEDROCK_UK_CONFIG);

export class BedrockUkService {
  static isUkRegion(regionCode: string | null | undefined) {
    const normalized = regionCode?.trim().toUpperCase();
    return Boolean(normalized && UK_REGIONS.has(normalized));
  }

  static provisionCampaign = service.provisionCampaign.bind(service);
  static staticSnapshotForCampaign = service.staticSnapshotForCampaign.bind(service);
}
