'use client';

import type { LeaderboardEntry } from '@/types/database';
import { LeaderboardRowCard } from './LeaderboardRowCard';

export function LeaderboardView({
  entries,
  loading,
}: {
  entries: LeaderboardEntry[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading leaderboard...</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 bg-card rounded-lg border border-border">
        <p className="text-muted-foreground">No leaderboard entries yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-6">
      {entries.map((entry) => (
        <LeaderboardRowCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

