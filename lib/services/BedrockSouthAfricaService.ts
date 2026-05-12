import { BedrockCountryService, BEDROCK_SOUTH_AFRICA_CONFIG } from '@/lib/services/BedrockCountryService';

const SOUTH_AFRICA_REGIONS = new Set([
  'EC',
  'FS',
  'GP',
  'KZN',
  'LP',
  'MP',
  'NC',
  'NW',
  'WC',
  'ZA',
]);

const service = new BedrockCountryService(BEDROCK_SOUTH_AFRICA_CONFIG);

export class BedrockSouthAfricaService {
  static isSouthAfricaRegion(regionCode: string | null | undefined) {
    const normalized = regionCode?.trim().toUpperCase();
    return Boolean(normalized && SOUTH_AFRICA_REGIONS.has(normalized));
  }

  static provisionCampaign = service.provisionCampaign.bind(service);
}
