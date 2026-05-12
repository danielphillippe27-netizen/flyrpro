/**
 * CampaignLinkQualityService grading regression fixtures
 *
 * Run with: npx tsx lib/services/__tests__/CampaignLinkQualityService.test.ts
 */

import {
  CampaignLinkQualityService,
  type LinkQualityAssessment,
} from '../CampaignLinkQualityService';
import type { SpatialJoinSummary } from '../StableLinkerService';
import type { SupabaseClient } from '@supabase/supabase-js';

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${name}`);
      testsPassed++;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${name}`);
      console.error(`  ${message}`);
      testsFailed++;
    });
}

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function summary(overrides: Partial<SpatialJoinSummary>): SpatialJoinSummary {
  return {
    matched: 92,
    orphans: 8,
    suspect: 0,
    avgConfidence: 0.94,
    coveragePercent: 92,
    matchBreakdown: {
      containmentVerified: 92,
      containmentSuspect: 0,
      pointOnSurface: 0,
      parcelVerified: 0,
      proximityVerified: 0,
      proximityFallback: 0,
    },
    processing_metadata: {
      execution_time_ms: 100,
      avg_precision_meters: 0,
      street_mismatch_count: 0,
      conflict_count: 0,
      density_warning_count: 0,
    },
    ...overrides,
  };
}

test('grades high-coverage/high-confidence campaigns as strong', () => {
  const assessment = CampaignLinkQualityService.assess(
    summary({
      matched: 96,
      orphans: 4,
      coveragePercent: 96,
    }),
    100
  );

  assertEqual(assessment.coverageScore, 94);
  assertEqual(assessment.dataQuality, 'strong');
  assertEqual(assessment.standardModeRecommended, false);
  assertEqual(assessment.reason, null);
});

test('grades low-confidence building links as weak and recommends standard mode', () => {
  const assessment = CampaignLinkQualityService.assess(
    summary({
      matched: 90,
      orphans: 10,
      avgConfidence: 0.55,
      coveragePercent: 90,
    }),
    100
  );

  assertEqual(assessment.dataQuality, 'weak');
  assertEqual(assessment.standardModeRecommended, true);
  assertEqual(assessment.reason, 'low building-address confidence');
  assertTrue(assessment.coverageScore < 90, 'Expected low confidence to reduce coverage score');
});

test('grades campaigns with no building links as weak', () => {
  const assessment = CampaignLinkQualityService.assess(
    summary({
      matched: 0,
      orphans: 25,
      avgConfidence: 0,
      coveragePercent: 0,
      matchBreakdown: {
        containmentVerified: 0,
        containmentSuspect: 0,
        pointOnSurface: 0,
        parcelVerified: 0,
        proximityVerified: 0,
        proximityFallback: 0,
      },
    }),
    25
  );

  assertEqual(assessment.status, 'failed');
  assertEqual(assessment.coverageScore, 0);
  assertEqual(assessment.dataQuality, 'weak');
  assertEqual(assessment.standardModeRecommended, true);
  assertEqual(assessment.reason, 'no building-address links');
});

test('persist writes campaign-level quality fields used by campaign creation', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      assertEqual(table, 'campaigns');
      return {
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            eq(column: string, value: string) {
              assertEqual(column, 'id');
              assertEqual(value, 'campaign-1');
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  const service = new CampaignLinkQualityService(supabase as unknown as SupabaseClient);
  const assessment: LinkQualityAssessment = CampaignLinkQualityService.assess(summary({}), 100);

  await service.persist('campaign-1', assessment);

  assertEqual(updates.length, 1);
  assertEqual(updates[0].coverage_score, assessment.coverageScore);
  assertEqual(updates[0].data_quality, assessment.dataQuality);
  assertEqual(updates[0].standard_mode_recommended, assessment.standardModeRecommended);
  assertEqual(updates[0].data_quality_reason, assessment.reason);
});

setTimeout(() => {
  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
    process.exit(1);
  }

  console.log(`\nAll ${testsPassed} campaign link quality tests passed.`);
}, 0);
