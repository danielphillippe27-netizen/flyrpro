'use client';

import { useEffect, useState } from 'react';
import { StatsService } from '@/lib/services/StatsService';
import type { UserStats } from '@/types/database';
import { StatCard } from './StatCard';

export function YouViewContent({ userId }: { userId: string | null }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const loadStats = async () => {
      try {
        const data = await StatsService.fetchUserStats(userId);
        setStats(data);
      } catch (error) {
        console.error('Error loading stats:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, [userId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading stats...</div>;
  }

  if (!stats) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border">
        <p className="text-gray-600">No stats available yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Flyers" value={stats.flyers} />
      <StatCard label="Conversations" value={stats.conversations} />
      <StatCard label="Leads Created" value={stats.leads_created} />
      <StatCard label="Distance Walked" value={`${stats.distance_walked} km`} />
      <StatCard label="Time Tracked" value={`${Math.round(stats.time_tracked / 60)}h`} />
      <StatCard label="Day Streak" value={stats.day_streak} />
      <StatCard label="Best Streak" value={stats.best_streak} />
      <StatCard label="XP" value={stats.xp} />
    </div>
  );
}

