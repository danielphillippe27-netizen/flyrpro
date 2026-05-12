/**
 * Campaign provisioning quality field regression fixtures
 *
 * Run with: npx tsx lib/services/__tests__/CampaignProvisionQuality.test.ts
 */

import {
  CAMPAIGN_LINKING_PENDING_REASON,
  buildCampaignDataQualityResponse,
  buildPendingCampaignDataQualityPatch,
} from '../CampaignProvisionQuality';
import type { LinkQualityAssessment } from '../CampaignLinkQualityService';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${name}`);
    console.error(`  ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test('campaign creation initializes quality fields while building links are pending', () => {
  assertEqual(buildPendingCampaignDataQualityPatch(), {
    coverage_score: 0,
    data_quality: 'weak',
    standard_mode_recommended: true,
    data_quality_reason: CAMPAIGN_LINKING_PENDING_REASON,
  });
});

test('deferred campaign creation response exposes pending quality fields', () => {
  assertEqual(buildCampaignDataQualityResponse(null), {
    coverage_score: 0,
    data_quality: 'weak',
    standard_mode_recommended: true,
    reason: CAMPAIGN_LINKING_PENDING_REASON,
  });
});

test('optimized campaign creation response exposes completed link quality fields', () => {
  const assessment: LinkQualityAssessment = {
    status: 'degraded',
    score: 72,
    coverageScore: 72,
    dataQuality: 'usable',
    standardModeRecommended: false,
    reason: 'low building-address confidence',
    repairRecommended: true,
    metrics: {
      total_addresses: 100,
      matched: 84,
      orphan_count: 16,
      orphan_rate: 0.16,
      suspect_count: 4,
      suspect_rate: 0.04,
      parcel_bridge_count: 10,
      parcel_bridge_rate: 0.119,
      avg_confidence: 0.76,
      coverage_percent: 84,
      street_mismatch_count: 4,
      conflict_count: 0,
      density_warning_count: 0,
    },
  };

  assertEqual(buildCampaignDataQualityResponse(assessment), {
    coverage_score: 72,
    data_quality: 'usable',
    standard_mode_recommended: false,
    reason: 'low building-address confidence',
  });
});

test('optimized strong campaign response does not expose stale pending reason', () => {
  const assessment: LinkQualityAssessment = {
    status: 'healthy',
    score: 99,
    coverageScore: 99,
    dataQuality: 'strong',
    standardModeRecommended: false,
    reason: null,
    repairRecommended: false,
    metrics: {
      total_addresses: 343,
      matched: 342,
      orphan_count: 1,
      orphan_rate: 0.0029,
      suspect_count: 9,
      suspect_rate: 0.0262,
      parcel_bridge_count: 10,
      parcel_bridge_rate: 0.0292,
      avg_confidence: 0.99,
      coverage_percent: 100,
      street_mismatch_count: 6,
      conflict_count: 0,
      density_warning_count: 0,
    },
  };

  assertEqual(buildCampaignDataQualityResponse(assessment), {
    coverage_score: 99,
    data_quality: 'strong',
    standard_mode_recommended: false,
    reason: null,
  });
});

if (testsFailed > 0) {
  console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
  process.exit(1);
}

console.log(`\nAll ${testsPassed} campaign provisioning quality tests passed.`);
