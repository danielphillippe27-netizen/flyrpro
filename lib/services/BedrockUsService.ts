import { BedrockCountryService, BEDROCK_US_CONFIG } from '@/lib/services/BedrockCountryService';

const US_REGIONS = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
]);

const service = new BedrockCountryService(BEDROCK_US_CONFIG);

export class BedrockUsService {
  static isUsRegion(regionCode: string | null | undefined) {
    const normalized = regionCode?.trim().toUpperCase();
    return Boolean(normalized && US_REGIONS.has(normalized));
  }

  static provisionCampaign = service.provisionCampaign.bind(service);
}

