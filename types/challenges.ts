// Challenge-specific types

import type { Challenge, ChallengeType, ChallengeStatus } from './database';

export { type Challenge, type ChallengeType, type ChallengeStatus };

export interface CreateChallengePayload {
  type: ChallengeType;
  title: string;
  description?: string;
  goal_count: number;
  time_limit_hours?: number;
  participant_id?: string;
}

