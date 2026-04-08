/**
 * Frontend challenge domain types — structured for future backend alignment.
 * See ChallengeTemplate (catalog), ChallengeInstance (per-user participation),
 * and LeaderboardEntry (scores within an instance scope).
 */

export type ChallengeScope = 'global' | 'team';

/** How the challenge window is determined */
export type ChallengeTemplateType = 'fixed_date' | 'rolling_onboarding';

export type ChallengeMetric =
  | 'doors_knocked'
  | 'flyers_delivered'
  | 'homes_reached'
  | 'conversations'
  | 'leads_generated'
  | 'sessions_completed'
  | 'consistency_days';

/** Published lifecycle of a template (catalog row). Rolling templates stay `active` while instances are per-user. */
export type ChallengeTemplateStatus = 'upcoming' | 'active' | 'completed' | 'archived';

/** Per-user participation state (especially important for rolling_onboarding). */
export type ChallengeInstanceStatus = 'upcoming' | 'active' | 'completed' | 'archived';

export type ChallengeVisibility = 'public' | 'workspace_private';

export type ChallengeTemplate = {
  id: string;
  /** URL slug (e.g. first-30-days); falls back to id in links when absent */
  slug?: string | null;
  title: string;
  description: string;
  scope: ChallengeScope;
  type: ChallengeTemplateType;
  metric: ChallengeMetric;
  /** Optional UI label override, e.g. "homes reached" */
  metricLabelOverride?: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  workspaceId: string | null;
  createdBy: string | null;
  templateStatus: ChallengeTemplateStatus;
  visibility: ChallengeVisibility;
  targetAudience: string | null;
  participantCount: number;
  /** Team: all members auto-enrolled when true */
  includeAllMembersByDefault?: boolean;
};

export type ChallengeInstance = {
  id: string;
  templateId: string;
  userId: string;
  workspaceId: string | null;
  joinedAt: string;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  finalRank: number | null;
  finalScore: number | null;
  locked: boolean;
  instanceStatus: ChallengeInstanceStatus;
  /** 1-based day for rolling / fixed progress display */
  currentDay?: number | null;
  totalDays?: number | null;
  currentScore?: number | null;
  currentRank?: number | null;
};

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  score: number;
  rank: number;
  challengeInstanceId?: string | null;
};

export type ChallengeDetailPack = {
  template: ChallengeTemplate;
  /** Viewer instance if any (rolling or enrolled) */
  viewerInstance: ChallengeInstance | null;
  /** All-time (or full challenge window) standings */
  leaderboard: LeaderboardEntry[];
  /** Rolling last 30 days — same metric, independent ranking (optional per template in API) */
  leaderboardLast30Days: LeaderboardEntry[];
  /** Aggregates for overview */
  overview: {
    totalParticipants: number;
    averageScore: number;
    topPerformerName: string;
    topPerformerScore: number;
  };
};
