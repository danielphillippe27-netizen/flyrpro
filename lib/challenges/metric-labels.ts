import type { ChallengeMetric } from '@/types/challenges';

const PLURAL: Record<ChallengeMetric, string> = {
  doors_knocked: 'doors knocked',
  flyers_delivered: 'flyers delivered',
  homes_reached: 'homes reached',
  conversations: 'conversations',
  leads_generated: 'leads generated',
  sessions_completed: 'sessions completed',
  consistency_days: 'consistent days',
};

export function metricLabelForTemplate(
  metric: ChallengeMetric,
  metricLabelOverride?: string | null
): string {
  if (metricLabelOverride?.trim()) return metricLabelOverride.trim();
  return PLURAL[metric];
}

export function formatMetricValue(metric: ChallengeMetric, score: number, labelOverride?: string | null): string {
  const label = metricLabelForTemplate(metric, labelOverride);
  return `${score.toLocaleString()} ${label}`;
}
