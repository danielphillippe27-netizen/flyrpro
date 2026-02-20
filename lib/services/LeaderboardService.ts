import { createClient } from '@/lib/supabase/client';
import type {
  LeaderboardEntry,
  LeaderboardSortBy,
  LeaderboardTimeframe,
  BrokerageLeaderboardEntry,
  BrokerageLeaderboardTimeframe,
} from '@/types/database';

export class LeaderboardService {
  private static client = createClient();

  static async fetchLeaderboard(
    sortBy: LeaderboardSortBy = 'flyers',
    limit: number = 100,
    offset: number = 0,
    timeframe: LeaderboardTimeframe = 'all_time'
  ): Promise<LeaderboardEntry[]> {
    const { data, error } = await this.client.rpc('get_leaderboard', {
      sort_by: sortBy,
      limit_count: limit,
      offset_count: offset,
      timeframe,
    });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        user_id: String(row.user_id ?? ''),
        user_email: String(row.user_email ?? ''),
        name: String(row.name ?? row.user_email ?? 'User'),
        avatar_url: row.avatar_url ? String(row.avatar_url) : null,
        flyers: Number(row.flyers) || 0,
        conversations: Number(row.conversations) || 0,
        leads: Number(row.leads) || 0,
        distance: Number(row.distance) || 0,
        time_minutes: Number(row.time_minutes) || 0,
        day_streak: Number(row.day_streak) || 0,
        best_streak: Number(row.best_streak) || 0,
        rank: Number(row.rank) || 0,
        updated_at: String(row.updated_at ?? ''),
      }));
    }

    if (error) {
      console.warn('get_leaderboard RPC failed, falling back to user_stats:', error.message);
    }

    return this.fetchFromUserStats(sortBy, limit, offset);
  }

  private static async fetchFromUserStats(
    sortBy: LeaderboardSortBy,
    limit: number,
    offset: number
  ): Promise<LeaderboardEntry[]> {
    let orderBy = 'flyers';
    if (sortBy === 'conversations') orderBy = 'conversations';
    else if (sortBy === 'leads') orderBy = 'leads_created';
    else if (sortBy === 'distance') orderBy = 'distance_walked';
    else if (sortBy === 'time') orderBy = 'time_tracked';

    const { data: statsData, error: statsError } = await this.client
      .from('user_stats')
      .select('*')
      .order(orderBy, { ascending: false })
      .range(offset, offset + limit - 1);

    if (statsError) throw statsError;

    return (statsData || []).map((stat: Record<string, unknown>, index: number) => ({
      id: String(stat.id ?? ''),
      user_id: String(stat.user_id ?? ''),
      user_email: '',
      name: 'User',
      avatar_url: null,
      flyers: Number(stat.flyers) || 0,
      conversations: Number(stat.conversations) || 0,
      leads: Number(stat.leads_created) || 0,
      distance: Number(stat.distance_walked) || 0,
      time_minutes: Number(stat.time_tracked) || 0,
      day_streak: Number(stat.day_streak) || 0,
      best_streak: Number(stat.best_streak) || 0,
      rank: offset + index + 1,
      updated_at: String(stat.updated_at ?? ''),
    }));
  }

  /** Brokerage leaderboard from materialized views (all_time or month only). */
  static async fetchBrokerageLeaderboard(
    sortBy: LeaderboardSortBy = 'flyers',
    limit: number = 100,
    offset: number = 0,
    timeframe: BrokerageLeaderboardTimeframe = 'all_time'
  ): Promise<BrokerageLeaderboardEntry[]> {
    const { data, error } = await this.client.rpc('get_brokerage_leaderboard', {
      sort_by: sortBy,
      limit_count: limit,
      offset_count: offset,
      timeframe,
    });

    if (error) {
      console.warn('get_brokerage_leaderboard RPC failed:', error.message);
      return [];
    }

    return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
      brokerage_key: String(row.brokerage_key ?? ''),
      display_name: String(row.display_name ?? ''),
      flyers: Number(row.flyers) || 0,
      conversations: Number(row.conversations) || 0,
      leads: Number(row.leads) || 0,
      distance: Number(row.distance) || 0,
      time_minutes: Number(row.time_minutes) || 0,
      day_streak: Number(row.day_streak) || 0,
      best_streak: Number(row.best_streak) || 0,
      agent_count: Number(row.agent_count) || 0,
      rank: Number(row.rank) || 0,
      updated_at: String(row.updated_at ?? ''),
    }));
  }

  static subscribeToUpdates(
    callback: (entries: LeaderboardEntry[]) => void
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
          const entries = await this.fetchLeaderboard();
          callback(entries);
        }
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }
}
