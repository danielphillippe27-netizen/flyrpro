import { createClient } from '@/lib/supabase/client';
import type { Challenge } from '@/types/database';
import type { CreateChallengePayload } from '@/types/challenges';

export class ChallengeService {
  private static client = createClient();

  static async fetchActiveChallenges(userId: string): Promise<Challenge[]> {
    const { data, error } = await this.client
      .from('challenges')
      .select('*')
      .or(`creator_id.eq.${userId},participant_id.eq.${userId}`)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Compute computed fields
    return (data || []).map((challenge) => this.computeChallengeFields(challenge));
  }

  static async fetchChallenge(id: string): Promise<Challenge | null> {
    const { data, error } = await this.client
      .from('challenges')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    return this.computeChallengeFields(data);
  }

  static async createChallenge(userId: string, payload: CreateChallengePayload): Promise<Challenge> {
    const expiresAt = payload.time_limit_hours
      ? new Date(Date.now() + payload.time_limit_hours * 60 * 60 * 1000).toISOString()
      : undefined;

    const { data, error } = await this.client
      .from('challenges')
      .insert({
        creator_id: userId,
        participant_id: payload.participant_id || userId,
        type: payload.type,
        title: payload.title,
        description: payload.description,
        goal_count: payload.goal_count,
        progress_count: 0,
        time_limit_hours: payload.time_limit_hours,
        status: 'active',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;
    return this.computeChallengeFields(data);
  }

  static async updateProgress(challengeId: string, increment: number = 1): Promise<Challenge> {
    // Get current challenge
    const challenge = await this.fetchChallenge(challengeId);
    if (!challenge) throw new Error('Challenge not found');

    const newProgress = challenge.progress_count + increment;
    const isCompleted = newProgress >= challenge.goal_count;

    const { data, error } = await this.client
      .from('challenges')
      .update({
        progress_count: newProgress,
        status: isCompleted ? 'completed' : challenge.status,
        completed_at: isCompleted ? new Date().toISOString() : challenge.completed_at,
      })
      .eq('id', challengeId)
      .select()
      .single();

    if (error) throw error;
    return this.computeChallengeFields(data);
  }

  private static computeChallengeFields(challenge: any): Challenge {
    const progressPercentage = challenge.goal_count > 0
      ? Math.min((challenge.progress_count / challenge.goal_count) * 100, 100)
      : 0;

    const now = new Date();
    const expiresAt = challenge.expires_at ? new Date(challenge.expires_at) : null;
    const isExpired = expiresAt ? now > expiresAt : false;
    const timeRemaining = expiresAt && !isExpired
      ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60 / 60))
      : undefined;

    const isCompleted = challenge.progress_count >= challenge.goal_count || challenge.status === 'completed';

    return {
      ...challenge,
      progress_percentage: progressPercentage,
      is_expired: isExpired,
      time_remaining: timeRemaining,
      is_completed: isCompleted,
    } as Challenge;
  }
}

