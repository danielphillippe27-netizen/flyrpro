import { BedrockCountryService, BEDROCK_CANADA_CONFIG } from '@/lib/services/BedrockCountryService';

const CANADA_REGIONS = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
]);

const service = new BedrockCountryService(BEDROCK_CANADA_CONFIG);

export class BedrockCanadaService {
  static isCanadaRegion(regionCode: string | null | undefined) {
    const normalized = regionCode?.trim().toUpperCase();
    return Boolean(normalized && CANADA_REGIONS.has(normalized));
  }

  static provisionCampaign = service.provisionCampaign.bind(service);
}

