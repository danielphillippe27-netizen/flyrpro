export const DEMO_100_TRIAL_OFFER = 'demo100-30-day-trial';
export const DEMO_100_CLIENT_SOURCE = 'demo100-30-day-trial';
export const DEMO_100_REFERRAL_CAMPAIGN = 'demo100-30-day-trial';
export const DEMO_100_REFERRAL_CODE = 'DEMO_100_30_DAY_TRIAL';
export const DEMO_100_TRIAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDemo100TrialOffer(value: string | null | undefined): boolean {
  return value === DEMO_100_TRIAL_OFFER;
}

export function buildDemo100TrialEndsAt(now = new Date()): string {
  return new Date(now.getTime() + DEMO_100_TRIAL_DAYS * DAY_MS).toISOString();
}

export function resolveDemo100TrialGrant(
  workspace: {
    subscriptionStatus?: string | null;
    trialEndsAt?: string | null;
    referralCodeUsed?: string | null;
  },
  now = new Date()
): {
  shouldGrant: boolean;
  preservePaidStatus: boolean;
  trialEndsAt: string | null;
} {
  const status = (workspace.subscriptionStatus ?? '').toLowerCase();
  const preservePaidStatus = status === 'active' || status === 'past_due';
  const alreadyClaimed = workspace.referralCodeUsed === DEMO_100_REFERRAL_CODE;

  if (preservePaidStatus || alreadyClaimed) {
    return {
      shouldGrant: false,
      preservePaidStatus,
      trialEndsAt: workspace.trialEndsAt ?? null,
    };
  }

  const freshTrialEnd = buildDemo100TrialEndsAt(now);
  const freshTrialEndTime = new Date(freshTrialEnd).getTime();
  const existingTrialEndTime = workspace.trialEndsAt
    ? new Date(workspace.trialEndsAt).getTime()
    : 0;

  return {
    shouldGrant: true,
    preservePaidStatus: false,
    trialEndsAt:
      Number.isFinite(existingTrialEndTime) && existingTrialEndTime > freshTrialEndTime
        ? workspace.trialEndsAt ?? freshTrialEnd
        : freshTrialEnd,
  };
}
