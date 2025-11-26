import { createClient } from '@/lib/supabase/client';
import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';

export class LeaderboardService {
  private static client = createClient();

  static async fetchLeaderboard(
    sortBy: LeaderboardSortBy = 'flyers',
    limit: number = 100,
    offset: number = 0
  ): Promise<LeaderboardEntry[]> {
    // Use Supabase RPC function if available, otherwise query user_stats
    const { data, error } = await this.client
      .rpc('get_leaderboard', {
        sort_by: sortBy,
        limit_count: limit,
        offset_count: offset,
      })
      .catch(async () => {
        // Fallback to direct query if RPC doesn't exist
        let orderBy = 'flyers';
        if (sortBy === 'conversations') orderBy = 'conversations';
        else if (sortBy === 'leads') orderBy = 'leads_created';
        else if (sortBy === 'distance') orderBy = 'distance_walked';
        else if (sortBy === 'time') orderBy = 'time_tracked';

        const { data: statsData, error: statsError } = await this.client
          .from('user_stats')
          .select(`
            *,
            user:auth.users!user_id(email)
          `)
          .order(orderBy, { ascending: false })
          .range(offset, offset + limit - 1);

        if (statsError) throw statsError;

        // Transform to leaderboard format
        return {
          data: (statsData || []).map((stat, index) => ({
            id: stat.id,
            user_id: stat.user_id,
            user_email: (stat.user as any)?.email || '',
            flyers: stat.flyers || 0,
            conversations: stat.conversations || 0,
            leads: stat.leads_created || 0,
            distance: stat.distance_walked || 0,
            time_minutes: stat.time_tracked || 0,
            day_streak: stat.day_streak || 0,
            best_streak: stat.best_streak || 0,
            rank: offset + index + 1,
            updated_at: stat.updated_at,
          })),
          error: null,
        };
      });

    if (error) throw error;
    return data || [];
  }

  static subscribeToUpdates(
    callback: (entry: LeaderboardEntry) => void
  ): () => void {
    const channel = this.client
      .channel('leaderboard-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_stats',
        },
        async () => {
          // Refetch leaderboard on update
          const entries = await this.fetchLeaderboard();
          entries.forEach(callback);
        }
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }
}

