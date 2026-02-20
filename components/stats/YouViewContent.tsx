'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatsService } from '@/lib/services/StatsService';
import type { UserStats } from '@/types/database';
import {
  formatDistanceWalked,
  formatTimeTracked,
  ratePercent,
} from '@/lib/stats/formatters';
import { StatCard } from './StatCard';
import { SuccessMetricBar } from './SuccessMetricBar';

const EMPTY_STATS: UserStats = {
  id: '',
  user_id: '',
  day_streak: 0,
  best_streak: 0,
  doors_knocked: 0,
  flyers: 0,
  conversations: 0,
  leads_created: 0,
  qr_codes_scanned: 0,
  distance_walked: 0,
  time_tracked: 0,
  conversation_per_door: 0,
  conversation_lead_rate: 0,
  qr_code_scan_rate: 0,
  qr_code_lead_rate: 0,
  streak_days: null,
  xp: 0,
  routes_walked: 0,
  updated_at: '',
  created_at: null,
};

export function YouViewContent({ userId, authChecked = false }: { userId: string | null; authChecked?: boolean }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await StatsService.fetchUserStats(userId);
      setStats(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stats';
      setError(message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Still resolving auth or loading stats
  if (!authChecked || (userId && loading && !stats && !error)) {
    return (
      <div className="flex items-center justify-center min-h-[200px] py-8 text-gray-600 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] py-12 gap-4">
        <p className="text-center text-gray-600 dark:text-gray-400 max-w-sm">{error}</p>
        <button
          type="button"
          onClick={loadStats}
          className="px-5 py-2.5 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Auth resolved and no user
  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] py-12">
        <p className="text-center text-gray-600 dark:text-gray-400">Please sign in to view your stats</p>
      </div>
    );
  }

  const displayStats = stats ?? EMPTY_STATS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <p className="text-xl font-bold text-white">Your stats</p>
        <p className="text-sm text-muted-foreground">
          Updated from the app via <code className="rounded bg-muted px-1">increment_user_stats</code> and sessions.
        </p>
        {!stats && (
          <p className="text-sm text-muted-foreground">No stats recorded yet. Complete a session in the app to see your numbers here.</p>
        )}
      </div>

      {/* Streaks */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Day Streak" value={displayStats.day_streak} />
        <StatCard label="Best Streak" value={displayStats.best_streak} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Doors Knocked" value={displayStats.doors_knocked} />
        <StatCard label="Flyers" value={displayStats.flyers} />
        <StatCard label="Conversations" value={displayStats.conversations} />
        <StatCard label="Leads Created" value={displayStats.leads_created} />
        <StatCard label="QR Codes Scanned" value={displayStats.qr_codes_scanned} />
        <StatCard label="Distance Walked" value={`${formatDistanceWalked(displayStats.distance_walked)} km`} />
        <StatCard label="Time Tracked" value={formatTimeTracked(displayStats.time_tracked)} />
        <StatCard label="Experience Points" value={displayStats.xp} />
        <StatCard label="Routes Walked" value={displayStats.routes_walked ?? 0} />
      </div>

      {/* Success metrics */}
      <section>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground mb-4">
          <span>📈</span>
          Success Metrics
        </h3>
        <div className="flex flex-col gap-5">
          <SuccessMetricBar
            title="Conversations per Door"
            value={ratePercent(displayStats.conversation_per_door)}
            icon="💬"
            color="#a855f7"
            description="Conversations per door knocked"
          />
          <SuccessMetricBar
            title="Conversation–Lead Rate"
            value={ratePercent(displayStats.conversation_lead_rate)}
            icon="⭐"
            color="#eab308"
            description="Leads per conversation"
          />
          <SuccessMetricBar
            title="FLYR™ QR Code Scan"
            value={ratePercent(displayStats.qr_code_scan_rate)}
            icon="📱"
            color="#ef4444"
            description="QR code scans per flyer"
          />
        </div>
      </section>

      {/* Refresh */}
      <div className="pt-4 text-center">
        <button
          type="button"
          onClick={loadStats}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
