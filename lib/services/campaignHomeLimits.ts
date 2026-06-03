export const MAX_CAMPAIGN_HOMES = 1000;
export const MAX_APP_HOMES = 2000;
export const APP_LIMIT_SCAN_COUNT = MAX_APP_HOMES + 1;

export const CAMPAIGN_HOME_LIMIT_MESSAGE =
  'FLYR currently supports up to 1,000 homes per campaign. Draw a smaller block.';

export const CAMPAIGN_TOO_LARGE_FOR_APP_MESSAGE =
  'This area has more than 2,000 homes, which is too big for the app. Draw a much smaller block.';

export type CampaignHomeLimitCode =
  | 'campaign_home_limit_exceeded'
  | 'campaign_too_large_for_app';

export class CampaignHomeLimitError extends Error {
  readonly status: number;
  readonly code: CampaignHomeLimitCode;
  readonly homeCount: number;
  readonly maxCampaignHomes = MAX_CAMPAIGN_HOMES;
  readonly maxAppHomes = MAX_APP_HOMES;

  constructor(homeCount: number) {
    const tooLargeForApp = homeCount > MAX_APP_HOMES;
    super(tooLargeForApp ? CAMPAIGN_TOO_LARGE_FOR_APP_MESSAGE : CAMPAIGN_HOME_LIMIT_MESSAGE);
    this.name = 'CampaignHomeLimitError';
    this.status = tooLargeForApp ? 413 : 422;
    this.code = tooLargeForApp ? 'campaign_too_large_for_app' : 'campaign_home_limit_exceeded';
    this.homeCount = homeCount;
  }
}

export function validateCampaignHomeCount(homeCount: number): void {
  if (!Number.isFinite(homeCount) || homeCount <= MAX_CAMPAIGN_HOMES) {
    return;
  }

  throw new CampaignHomeLimitError(Math.floor(homeCount));
}

export function campaignHomeLimitErrorPayload(error: CampaignHomeLimitError) {
  return {
    code: error.code,
    home_count: error.homeCount,
    max_campaign_homes: error.maxCampaignHomes,
    max_app_homes: error.maxAppHomes,
  };
}
