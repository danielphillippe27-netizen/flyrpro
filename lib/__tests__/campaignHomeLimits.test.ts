import assert from 'node:assert/strict';
import {
  APP_LIMIT_SCAN_COUNT,
  CAMPAIGN_HOME_LIMIT_MESSAGE,
  CAMPAIGN_TOO_LARGE_FOR_APP_MESSAGE,
  CampaignHomeLimitError,
  MAX_APP_HOMES,
  MAX_CAMPAIGN_HOMES,
  campaignHomeLimitErrorPayload,
  campaignHomeCapNotice,
  validateCampaignHomeCount,
} from '../services/campaignHomeLimits';

function assertPasses(homeCount: number) {
  assert.doesNotThrow(() => validateCampaignHomeCount(homeCount));
}

function assertFails(
  homeCount: number,
  expected: {
    status: number;
    code: string;
    message: string;
  }
) {
  assert.throws(
    () => validateCampaignHomeCount(homeCount),
    (error) => {
      assert.ok(error instanceof CampaignHomeLimitError);
      assert.equal(error.status, expected.status);
      assert.equal(error.code, expected.code);
      assert.equal(error.message, expected.message);
      assert.equal(error.homeCount, homeCount);
      assert.equal(error.maxCampaignHomes, MAX_CAMPAIGN_HOMES);
      assert.equal(error.maxAppHomes, MAX_APP_HOMES);
      assert.deepEqual(campaignHomeLimitErrorPayload(error), {
        code: expected.code,
        home_count: homeCount,
        max_campaign_homes: MAX_CAMPAIGN_HOMES,
        max_app_homes: MAX_APP_HOMES,
      });
      return true;
    }
  );
}

assert.equal(APP_LIMIT_SCAN_COUNT, MAX_APP_HOMES + 1);
assert.equal(
  campaignHomeCapNotice(1234),
  'Campaign home limit applied: This area contains 1,234 homes. We drew the first 1,000 homes. For future reference, campaigns have a 1,000-home limit.'
);
assertPasses(0);
assertPasses(1);
assertPasses(MAX_CAMPAIGN_HOMES);

assertFails(MAX_CAMPAIGN_HOMES + 1, {
  status: 422,
  code: 'campaign_home_limit_exceeded',
  message: CAMPAIGN_HOME_LIMIT_MESSAGE,
});

assertFails(MAX_APP_HOMES, {
  status: 422,
  code: 'campaign_home_limit_exceeded',
  message: CAMPAIGN_HOME_LIMIT_MESSAGE,
});

assertFails(MAX_APP_HOMES + 1, {
  status: 413,
  code: 'campaign_too_large_for_app',
  message: CAMPAIGN_TOO_LARGE_FOR_APP_MESSAGE,
});

console.log('campaignHomeLimits tests passed');
