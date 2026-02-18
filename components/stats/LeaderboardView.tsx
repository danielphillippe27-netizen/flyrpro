'use client';

import type { LeaderboardEntry, LeaderboardSortBy, LeaderboardTimeframe } from '@/types/database';
import { LeaderboardRowCard } from './LeaderboardRowCard';
import { Loader2 } from 'lucide-react';

const TIMEFRAME_LABELS: Record<LeaderboardTimeframe, string> = {
  day: 'today',
  week: 'this week',
  month: 'this month',
  year: 'this year',
  all_time: '',
};

export function LeaderboardView({
  entries,
  loading,
  error,
  onRetry,
  currentUserId,
  sortBy,
  timeframe,
}: {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  currentUserId: string | null;
  sortBy: LeaderboardSortBy;
  timeframe: LeaderboardTimeframe;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm">Loading leaderboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
        <p className="text-destructive text-sm">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    const periodLabel = TIMEFRAME_LABELS[timeframe];
    return (
      <div className="text-center py-16 bg-card rounded-lg border border-border">
        <div className="text-4xl mb-3">🏆</div>
        <p className="text-muted-foreground font-medium">No leaderboard entries{periodLabel ? ` ${periodLabel}` : ' yet'}</p>
        <p className="text-muted-foreground/60 text-sm mt-1">
          {periodLabel ? `No sessions recorded ${periodLabel}` : 'Start a session to appear on the leaderboard'}
        </p>
      </div>
    );
  }

  const normalizeId = (id: string | null | undefined) =>
    (id ?? '').toLowerCase().replace(/-/g, '');

  const currentUserInList = currentUserId
    ? entries.some((e) => normalizeId(e.user_id) === normalizeId(currentUserId))
    : false;

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <LeaderboardRowCard
          key={entry.id}
          entry={entry}
          isCurrentUser={normalizeId(entry.user_id) === normalizeId(currentUserId)}
          sortBy={sortBy}
        />
      ))}

      {currentUserId && !currentUserInList && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-3 rounded-lg bg-primary/5 border border-primary/20 p-4">
            <div className="w-8 text-center text-sm text-muted-foreground">—</div>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-primary">You</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground text-sm">You</span>
                <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-medium">
                  You
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                No activity {TIMEFRAME_LABELS[timeframe] || 'this period'}
              </p>
            </div>
            <div className="text-sm font-bold text-muted-foreground">—</div>
          </div>
        </div>
      )}
    </div>
  );
}
