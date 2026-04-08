import type { ChallengeInstance, ChallengeTemplate } from '@/types/challenges';

export function cardStatusForTemplate(
  template: ChallengeTemplate,
  instance: ChallengeInstance | null
): 'upcoming' | 'active' | 'completed' | 'archived' {
  if (template.templateStatus === 'archived') return 'archived';
  if (template.type === 'rolling_onboarding') {
    if (instance?.locked || instance?.instanceStatus === 'completed') return 'completed';
    if (instance?.instanceStatus === 'active') return 'active';
    return template.templateStatus === 'upcoming' ? 'upcoming' : 'active';
  }
  return template.templateStatus;
}
