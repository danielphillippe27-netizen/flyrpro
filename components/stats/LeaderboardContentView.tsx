'use client';

import { useState, useEffect, useCallback } from 'react';
import { LeaderboardService } from '@/lib/services/LeaderboardService';
import { getClientAsync } from '@/lib/supabase/client';
import type { LeaderboardEntry, LeaderboardSortBy, LeaderboardTimeframe } from '@/types/database';
import { LeaderboardView } from './LeaderboardView';
import { MetricPickerView } from './MetricPickerView';

export function LeaderboardContentView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<LeaderboardSortBy>('flyers');
  const [timeframe, setTimeframe] = useState<LeaderboardTimeframe>('all_time');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    getClientAsync()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        setCurrentUserId(session?.user?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await LeaderboardService.fetchLeaderboard(sortBy, 100, 0, timeframe);
      setEntries(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('JWT') || msg.includes('401') || msg.includes('auth')) {
        setError('Please sign in to view the leaderboard.');
      } else if (msg.includes('does not exist') || msg.includes('function')) {
        setError('Leaderboard is temporarily unavailable.');
      } else {
        setError('Could not load leaderboard. Check your connection and try again.');
      }
      console.error('Leaderboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [sortBy, timeframe]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    const unsub = LeaderboardService.subscribeToUpdates((newEntries) => {
      setEntries(newEntries);
    });
    return unsub;
  }, []);

  return (
    <div className="space-y-4">
      <MetricPickerView
        sortBy={sortBy}
        onSortChange={setSortBy}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
      />
      <LeaderboardView
        entries={entries}
        loading={loading}
        error={error}
        onRetry={loadLeaderboard}
        currentUserId={currentUserId}
        sortBy={sortBy}
        timeframe={timeframe}
      />
    </div>
  );
}
