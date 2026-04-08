import type { ChallengeTemplate } from '@/types/challenges';

export function templateTimeframeLabel(t: ChallengeTemplate): string {
  if (t.type === 'rolling_onboarding' && t.durationDays) {
    return `${t.durationDays} days from your join date`;
  }
  if (t.startDate && t.endDate) {
    const a = new Date(t.startDate);
    const b = new Date(t.endDate);
    return `${a.toLocaleDateString()} – ${b.toLocaleDateString()}`;
  }
  return 'Schedule TBD';
}
