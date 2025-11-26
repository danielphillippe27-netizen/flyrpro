import { createClient } from '@/lib/supabase/client';
import type { UserStats } from '@/types/database';

export class StatsService {
  private static client = createClient();

  static async fetchUserStats(userId: string): Promise<UserStats | null> {
    const { data, error } = await this.client
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async createOrUpdateUserStats(userId: string, updates: Partial<UserStats>): Promise<UserStats> {
    // Check if stats exist
    const existing = await this.fetchUserStats(userId);

    if (existing) {
      const { data, error } = await this.client
        .from('user_stats')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      const { data, error } = await this.client
        .from('user_stats')
        .insert({
          user_id: userId,
          flyers: 0,
          conversations: 0,
          leads_created: 0,
          distance_walked: 0,
          time_tracked: 0,
          day_streak: 0,
          best_streak: 0,
          xp: 0,
          ...updates,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    }
  }
}

