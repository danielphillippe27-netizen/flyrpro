import { createClient } from '@/lib/supabase/client';
import { callLeaderboardRpc } from '@/lib/supabase/leaderboard-rpc';
import type {
  LeaderboardEntry,
  MetricSnapshot,
  LeaderboardSortBy,
  LeaderboardTimeframe,
  BrokerageLeaderboardEntry,
  BrokerageLeaderboardTimeframe,
} from '@/types/database';

function parseMetricSnapshot(value: unknown): MetricSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { doorknocks: 0, conversations: 0, leads: 0, distance: 0 };
  }

  const snapshot = value as Record<string, unknown>;
  return {
    doorknocks: Number(snapshot.doorknocks) || 0,
    conversations: Number(snapshot.conversations) || 0,
    leads: Number(snapshot.leads) || 0,
    distance: Number(snapshot.distance) || 0,
  };
}

export class LeaderboardService {
  private static client = createClient();

  static async fetchLeaderboard(
    sortBy: LeaderboardSortBy = 'doorknocks',
    limit: number = 100,
    offset: number = 0,
    timeframe: LeaderboardTimeframe = 'all_time',
    workspaceId: string | null = null
  ): Promise<LeaderboardEntry[]> {
    const { data, error } = await callLeaderboardRpc(this.client, {
      p_metric: sortBy,
      p_timeframe: timeframe,
      p_workspace_id: workspaceId,
      p_limit: limit,
      p_offset: offset,
    });

    if (!error && Array.isArray(data)) {
      return data.map((row: Record<string, unknown>) => ({
        id: String(row.id ?? ''),
        user_id: String(row.user_id ?? ''),
        user_email: '',
        name: String(row.name ?? 'User'),
        avatar_url: row.avatar_url ? String(row.avatar_url) : null,
        country_code: row.country_code ? String(row.country_code) : null,
        brokerage: row.brokerage ? String(row.brokerage) : null,
        doorknocks: Number(row.doorknocks) || 0,
        conversations: Number(row.conversations) || 0,
        leads: Number(row.leads) || 0,
        distance: Number(row.distance) || 0,
        rank: Number(row.rank) || 0,
        pending: parseMetricSnapshot(row.pending),
        updated_at: row.updated_at ? String(row.updated_at) : undefined,
      }));
    }

    if (error) {
      throw error;
    }

    return [];
  }

  /** Brokerage leaderboard from materialized views (all_time or month only). */
  static async fetchBrokerageLeaderboard(
    sortBy: LeaderboardSortBy = 'doorknocks',
    limit: number = 100,
    offset: number = 0,
    timeframe: BrokerageLeaderboardTimeframe = 'all_time'
  ): Promise<BrokerageLeaderboardEntry[]> {
    const { data, error } = await this.client.rpc('get_brokerage_leaderboard', {
      sort_by: sortBy === 'doorknocks' ? 'flyers' : sortBy,
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
      doorknocks: Number(row.flyers) || 0,
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
          table: 'leaderboard_rollups',
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
