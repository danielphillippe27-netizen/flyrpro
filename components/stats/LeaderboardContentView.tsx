'use client';

import { useState, useEffect } from 'react';
import { LeaderboardService } from '@/lib/services/LeaderboardService';
import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { LeaderboardView } from './LeaderboardView';
import { MetricPickerView } from './MetricPickerView';

export function LeaderboardContentView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<LeaderboardSortBy>('flyers');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLeaderboard = async () => {
      setLoading(true);
      try {
        const data = await LeaderboardService.fetchLeaderboard(sortBy, 100, 0);
        setEntries(data);
      } catch (error) {
        console.error('Error loading leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    loadLeaderboard();
  }, [sortBy]);

  return (
    <div>
      <MetricPickerView sortBy={sortBy} onSortChange={setSortBy} />
      <LeaderboardView entries={entries} loading={loading} />
    </div>
  );
}

