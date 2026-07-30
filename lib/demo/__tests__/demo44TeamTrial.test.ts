/**
 * Run with: npx tsx lib/demo/__tests__/demo44TeamTrial.test.ts
 */
import assert from 'node:assert/strict';
import {
  DEMO_44_TEAM_TRIAL_OFFER,
  buildDemo44TrialEndsAt,
  getTrialDaysRemaining,
  isDemo44TeamTrialOffer,
  isWorkspaceTrialActive,
  resolveDemo44TrialGrant,
} from '../demo44TeamTrial';

const now = new Date('2026-07-21T16:00:00.000Z');
const trialEnd = buildDemo44TrialEndsAt(now);

assert.equal(isDemo44TeamTrialOffer(DEMO_44_TEAM_TRIAL_OFFER), true);
assert.equal(isDemo44TeamTrialOffer('another-offer'), false);
assert.equal(trialEnd, '2026-10-19T16:00:00.000Z');
assert.equal(isWorkspaceTrialActive('trialing', trialEnd, now), true);
assert.equal(isWorkspaceTrialActive('active', trialEnd, now), false);
assert.equal(isWorkspaceTrialActive('trialing', now.toISOString(), now), false);
assert.equal(getTrialDaysRemaining(trialEnd, now), 90);
assert.equal(getTrialDaysRemaining('not-a-date', now), null);

assert.deepEqual(resolveDemo44TrialGrant({}, now), {
  shouldGrant: true,
  preservePaidStatus: false,
  trialEndsAt: trialEnd,
});
assert.deepEqual(
  resolveDemo44TrialGrant(
    {
      subscriptionStatus: 'trialing',
      trialEndsAt: trialEnd,
      referralCodeUsed: 'DEMO_44_TEAM_TRIAL',
    },
    new Date('2026-07-22T16:00:00.000Z')
  ),
  {
    shouldGrant: false,
    preservePaidStatus: false,
    trialEndsAt: trialEnd,
  }
);
assert.equal(
  resolveDemo44TrialGrant({ subscriptionStatus: 'active' }, now).preservePaidStatus,
  true
);

console.log('demo44TeamTrial tests passed');
