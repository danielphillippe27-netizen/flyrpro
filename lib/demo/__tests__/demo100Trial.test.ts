/**
 * Run with: npx tsx lib/demo/__tests__/demo100Trial.test.ts
 */
import assert from 'node:assert/strict';
import {
  DEMO_100_REFERRAL_CODE,
  DEMO_100_TRIAL_OFFER,
  buildDemo100TrialEndsAt,
  isDemo100TrialOffer,
  resolveDemo100TrialGrant,
} from '../demo100Trial';

const now = new Date('2026-09-08T16:00:00.000Z');
const trialEnd = buildDemo100TrialEndsAt(now);

assert.equal(isDemo100TrialOffer(DEMO_100_TRIAL_OFFER), true);
assert.equal(isDemo100TrialOffer('another-offer'), false);
assert.equal(trialEnd, '2026-10-08T16:00:00.000Z');
assert.deepEqual(resolveDemo100TrialGrant({}, now), {
  shouldGrant: true,
  preservePaidStatus: false,
  trialEndsAt: trialEnd,
});
assert.deepEqual(
  resolveDemo100TrialGrant(
    {
      subscriptionStatus: 'trialing',
      trialEndsAt: trialEnd,
      referralCodeUsed: DEMO_100_REFERRAL_CODE,
    },
    new Date('2026-09-09T16:00:00.000Z')
  ),
  {
    shouldGrant: false,
    preservePaidStatus: false,
    trialEndsAt: trialEnd,
  }
);
assert.equal(
  resolveDemo100TrialGrant({ subscriptionStatus: 'active' }, now).preservePaidStatus,
  true
);

console.log('demo100Trial tests passed');
