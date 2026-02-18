'use client';

import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name.slice(0, 2) || '?').toUpperCase();
}

function getDisplayValue(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): string {
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
    default:
      return String(entry.flyers);
  }
}

function getSubtitle(entry: LeaderboardEntry): string {
  const parts: string[] = [];
  if (entry.flyers > 0) parts.push(`${entry.flyers} flyers`);
  if (entry.conversations > 0) parts.push(`${entry.conversations} conv`);
  if (entry.leads > 0) parts.push(`${entry.leads} leads`);
  if (entry.distance > 0) parts.push(`${entry.distance.toFixed(1)} km`);
  return parts.join(' · ') || '—';
}

const rankStyles: Record<number, string> = {
  1: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/50',
  2: 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700/50',
  3: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50',
};

export function LeaderboardRowCard({
  entry,
  isCurrentUser,
  sortBy,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  sortBy: LeaderboardSortBy;
}) {
  const displayName = entry.name || entry.user_email || 'User';
  const value = getDisplayValue(entry, sortBy);
  const subtitle = getSubtitle(entry);
  const isTopThree = entry.rank <= 3;

  return (
    <Card
      className={cn(
        'p-3 sm:p-4 transition-colors',
        isTopThree && rankStyles[entry.rank],
        isCurrentUser && !isTopThree && 'bg-primary/5 border-primary/20',
        !isTopThree && !isCurrentUser && 'border-border'
      )}
    >
      <div className="flex items-center gap-3">
        {/* Rank */}
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

        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {entry.avatar_url ? (
            <img
              src={entry.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {getInitials(displayName)}
            </span>
          )}
        </div>

        {/* Name & subtitle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-sm truncate">
              {displayName}
            </span>
            {isCurrentUser && (
              <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-medium shrink-0">
                You
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        </div>

        {/* Value */}
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-primary">{value}</p>
        </div>
      </div>
    </Card>
  );
}
