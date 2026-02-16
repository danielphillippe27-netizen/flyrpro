'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatsService, type StatsPeriod } from '@/lib/services/StatsService';
import type { UserStats } from '@/types/database';
import { cn } from '@/lib/utils';
import {
  formatDistanceWalked,
  formatTimeTracked,
  ratePercent,
} from '@/lib/stats/formatters';
import { StatCard } from './StatCard';
import { SuccessMetricBar } from './SuccessMetricBar';

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  lifetime: 'Lifetime',
};

export function YouViewContent({ userId }: { userId: string | null }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<StatsPeriod>('weekly');

  const loadStats = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await StatsService.fetchUserStats(userId, period);
      setStats(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stats';
      setError(message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [userId, period]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading && !stats) {
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

  if (!userId || !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] py-12">
        <p className="text-gray-600 dark:text-gray-400">Please sign in to view your stats</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period toggle: Your [Weekly|Daily|Monthly|Lifetime] stats */}
      <div className="flex flex-col gap-3">
        <p className="text-xl font-bold text-white">
          Your{' '}
          <span className="inline-flex rounded-lg border border-border bg-muted/50 p-[3px]">
            {(['weekly', 'daily', 'monthly', 'lifetime'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  period === p
                    ? 'bg-red-500/90 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </span>{' '}
          stats
        </p>
      </div>

      {/* Streaks */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Day Streak" value={stats.day_streak} />
        <StatCard label="Best Streak" value={stats.best_streak} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Doors Knocked" value={stats.doors_knocked} />
        <StatCard label="Flyers" value={stats.flyers} />
        <StatCard label="Conversations" value={stats.conversations} />
        <StatCard label="Leads Created" value={stats.leads_created} />
        <StatCard label="QR Codes Scanned" value={stats.qr_codes_scanned} />
        <StatCard label="Distance Walked" value={`${formatDistanceWalked(stats.distance_walked)} km`} />
        <StatCard label="Time Tracked" value={formatTimeTracked(stats.time_tracked)} />
        <StatCard label="Experience Points" value={stats.xp} />
        <StatCard label="Routes Walked" value={stats.routes_walked ?? 0} />
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
            value={ratePercent(stats.conversation_per_door)}
            icon="💬"
            color="#a855f7"
            description="Conversations per door knocked"
          />
          <SuccessMetricBar
            title="Conversation–Lead Rate"
            value={ratePercent(stats.conversation_lead_rate)}
            icon="⭐"
            color="#eab308"
            description="Leads per conversation"
          />
          <SuccessMetricBar
            title="FLYR™ QR Code Scan"
            value={ratePercent(stats.qr_code_scan_rate)}
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
