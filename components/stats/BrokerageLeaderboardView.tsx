'use client';

import type { BrokerageLeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

function getDisplayValue(entry: BrokerageLeaderboardEntry, sortBy: LeaderboardSortBy): string {
  switch (sortBy) {
    case 'flyers':
      return String(entry.flyers);
    case 'conversations':
      return String(entry.conversations);
    case 'leads':
      return String(entry.leads);
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
    case 'time':
      return `${Math.round(entry.time_minutes)} min`;
    case 'day_streak':
      return String(entry.day_streak);
    case 'best_streak':
      return String(entry.best_streak);
    default:
      return String(entry.flyers);
  }
}

function getSubtitle(entry: BrokerageLeaderboardEntry): string {
  const parts: string[] = [];
  if (entry.flyers > 0) parts.push(`${entry.flyers} flyers`);
  if (entry.conversations > 0) parts.push(`${entry.conversations} conv`);
  if (entry.agent_count > 0) parts.push(`${entry.agent_count} agents`);
  return parts.join(' · ') || '—';
}

const rankStyles: Record<number, string> = {
  1: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/50',
  2: 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700/50',
  3: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50',
};

export function BrokerageLeaderboardView({
  entries,
  loading,
  error,
  onRetry,
  sortBy,
  timeframeLabel,
}: {
  entries: BrokerageLeaderboardEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sortBy: LeaderboardSortBy;
  timeframeLabel: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-sm">Loading brokerage leaderboard...</p>
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
    return (
      <div className="text-center py-16 bg-card rounded-lg border border-border">
        <div className="text-4xl mb-3">🏢</div>
        <p className="text-muted-foreground font-medium">No brokerage rankings {timeframeLabel}</p>
        <p className="text-muted-foreground/60 text-sm mt-1">
          Workspaces with a brokerage set will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const value = getDisplayValue(entry, sortBy);
        const subtitle = getSubtitle(entry);
        const isTopThree = entry.rank <= 3;
        return (
          <Card
            key={entry.brokerage_key}
            className={cn(
              'p-3 sm:p-4 transition-colors',
              isTopThree && rankStyles[entry.rank],
              !isTopThree && 'border-border'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 text-center shrink-0">
                {entry.rank === 1 ? (
                  <span className="text-lg" role="img" aria-label="1st place">
                    👑
                  </span>
                ) : entry.rank === 2 ? (
                  <span className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 inline-flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-200">
                    2
                  </span>
                ) : entry.rank === 3 ? (
                  <span className="w-6 h-6 rounded-full bg-orange-300 dark:bg-orange-700 inline-flex items-center justify-center text-xs font-bold text-orange-800 dark:text-orange-200">
                    3
                  </span>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">
                    #{entry.rank}
                  </span>
                )}
              </div>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-muted-foreground">
                  {entry.display_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-foreground text-sm truncate block">
                  {entry.display_name}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-bold text-primary">{value}</p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
