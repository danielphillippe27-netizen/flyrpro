import { formatMetricValue } from '@/lib/challenges/metric-labels';
import type { ChallengeTemplate, ChallengeInstance, LeaderboardEntry } from '@/types/challenges';

export type ChallengeTemplateRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  scope: 'global' | 'team';
  type: 'fixed_date' | 'rolling_onboarding';
  metric: string;
  metric_label_override: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  workspace_id: string | null;
  status: 'upcoming' | 'active' | 'completed' | 'archived';
  visibility: 'public' | 'workspace_private';
  target_audience: string | null;
  include_all_members: boolean;
  created_at: string;
  updated_at: string;
};

const LEGACY_SLUG_ALIASES: Record<string, string> = {
  'global-first-30': 'first-30-days',
};

export function normalizeChallengeLookupKey(raw: string): string {
  const trimmed = raw.trim();
  return LEGACY_SLUG_ALIASES[trimmed] ?? trimmed;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export function challengeLookupFilter(raw: string): { id?: string; slug?: string } {
  const key = normalizeChallengeLookupKey(raw);
  if (isUuid(key)) return { id: key };
  return { slug: key };
}

export function mapTemplateRow(
  row: ChallengeTemplateRow,
  participantCountOverride?: number
): ChallengeTemplate {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    scope: row.scope,
    type: row.type,
    metric: row.metric as ChallengeTemplate['metric'],
    metricLabelOverride: row.metric_label_override,
    startDate: row.start_date,
    endDate: row.end_date,
    durationDays: row.duration_days,
    workspaceId: row.workspace_id,
    createdBy: null,
    templateStatus: row.status,
    visibility: row.visibility,
    targetAudience: row.target_audience,
    participantCount:
      typeof participantCountOverride === 'number' ? participantCountOverride : 0,
    includeAllMembersByDefault: row.include_all_members,
  };
}

type RpcLbRow = {
  user_id: string;
  display_name: string;
  score: number | string;
  rank: number | string;
  active_badges?: string[] | null;
  current_streak?: number | string | null;
  accountability_posted?: boolean | null;
  latest_session_id?: string | null;
};

export function mapRpcLeaderboard(rows: RpcLbRow[] | null): LeaderboardEntry[] {
  if (!rows?.length) return [];
  return rows
    .map((r) => ({
      userId: String(r.user_id),
      displayName: String(r.display_name ?? 'Member'),
      score: Number(r.score) || 0,
      rank: Number(r.rank) || 0,
      activeBadges: Array.isArray(r.active_badges)
        ? r.active_badges.map((badge) => String(badge)) as LeaderboardEntry['activeBadges']
        : [],
      currentStreak: Number(r.current_streak) || 0,
      accountabilityPosted: Boolean(r.accountability_posted),
      latestSessionId: r.latest_session_id ? String(r.latest_session_id) : null,
    }))
    .sort((a, b) => a.rank - b.rank);
}

export function buildRollingViewerInstance(params: {
  userId: string;
  joinAtIso: string;
  durationDays: number;
  challengeWindowScore: number;
  challengeWindowRank: number | null;
}): ChallengeInstance {
  const joinAt = new Date(params.joinAtIso);
  const endsAt = new Date(joinAt.getTime() + params.durationDays * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const locked = now >= endsAt.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayFloat = Math.floor((now - joinAt.getTime()) / msPerDay) + 1;
  const currentDay = locked ? params.durationDays : Math.min(params.durationDays, Math.max(1, dayFloat));

  return {
    id: `rolling-${params.userId}`,
    templateId: '',
    userId: params.userId,
    workspaceId: null,
    joinedAt: joinAt.toISOString(),
    startsAt: joinAt.toISOString(),
    endsAt: endsAt.toISOString(),
    completedAt: locked ? endsAt.toISOString() : null,
    finalRank: locked ? params.challengeWindowRank : null,
    finalScore: locked ? params.challengeWindowScore : null,
    locked,
    instanceStatus: locked ? 'completed' : 'active',
    currentDay,
    totalDays: params.durationDays,
    currentScore: params.challengeWindowScore,
    currentRank: params.challengeWindowRank ?? undefined,
  };
}

export function viewerSummaryLine(
  template: ChallengeTemplate,
  instance: ChallengeInstance | null
): string | null {
  if (!instance) return null;
  if (instance.locked && instance.finalRank != null && instance.finalScore != null) {
    return `Final rank #${instance.finalRank} · ${formatMetricValue(
      template.metric,
      instance.finalScore,
      template.metricLabelOverride
    )}`;
  }
  if (instance.instanceStatus === 'active' && template.type === 'rolling_onboarding') {
    const parts: string[] = [];
    if (instance.currentDay != null && instance.totalDays != null) {
      parts.push(`Day ${instance.currentDay} of ${instance.totalDays}`);
    }
    if (instance.currentRank != null) parts.push(`rank #${instance.currentRank}`);
    if (instance.currentScore != null) {
      parts.push(
        formatMetricValue(template.metric, instance.currentScore, template.metricLabelOverride)
      );
    }
    return parts.length ? parts.join(' · ') : null;
  }
  return null;
}

export function overviewFromEntries(
  template: ChallengeTemplate,
  entries: LeaderboardEntry[],
  totalParticipantsFallback: number
): {
  totalParticipants: number;
  averageScore: number;
  topPerformerName: string;
  topPerformerScore: number;
} {
  if (!entries.length) {
    return {
      totalParticipants: totalParticipantsFallback,
      averageScore: 0,
      topPerformerName: '—',
      topPerformerScore: 0,
    };
  }
  const sum = entries.reduce((a, e) => a + e.score, 0);
  const top = entries[0];
  const avg = sum / entries.length;
  return {
    totalParticipants: Math.max(totalParticipantsFallback, entries.length),
    averageScore: Math.round(avg * 10) / 10,
    topPerformerName: top.displayName,
    topPerformerScore: top.score,
  };
}
