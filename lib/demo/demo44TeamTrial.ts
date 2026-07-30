export const DEMO_44_TEAM_TRIAL_OFFER = 'team-lead-90-day-trial';
export const DEMO_44_CLIENT_SOURCE = 'demo-44-team-trial';
export const DEMO_44_REFERRAL_CAMPAIGN = 'demo-44-team-lead-trial';
export const DEMO_44_REFERRAL_CODE = 'DEMO_44_TEAM_TRIAL';
export const DEMO_44_TRIAL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDemo44TeamTrialOffer(value: string | null | undefined): boolean {
  return value === DEMO_44_TEAM_TRIAL_OFFER;
}

export function buildDemo44TrialEndsAt(now = new Date()): string {
  return new Date(now.getTime() + DEMO_44_TRIAL_DAYS * DAY_MS).toISOString();
}

export function resolveDemo44TrialGrant(
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
  const alreadyClaimed = workspace.referralCodeUsed === DEMO_44_REFERRAL_CODE;

  if (preservePaidStatus || alreadyClaimed) {
    return {
      shouldGrant: false,
      preservePaidStatus,
      trialEndsAt: workspace.trialEndsAt ?? null,
    };
  }

  const freshTrialEnd = buildDemo44TrialEndsAt(now);
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

export function isWorkspaceTrialActive(
  status: string | null | undefined,
  trialEndsAt: string | null | undefined,
  now = new Date()
): boolean {
  if ((status ?? '').toLowerCase() !== 'trialing' || !trialEndsAt) return false;
  const endTime = new Date(trialEndsAt).getTime();
  return Number.isFinite(endTime) && endTime > now.getTime();
}

export function getTrialDaysRemaining(
  trialEndsAt: string | null | undefined,
  now = new Date()
): number | null {
  if (!trialEndsAt) return null;
  const endTime = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(endTime)) return null;
  return Math.max(0, Math.ceil((endTime - now.getTime()) / DAY_MS));
}
