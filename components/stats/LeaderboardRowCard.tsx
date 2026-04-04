'use client';

import Image from 'next/image';
import { ChevronRight, Crown } from 'lucide-react';
import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';
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
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
    default:
      return String(entry.flyers);
  }
}

function getSubtitle(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): string {
  switch (sortBy) {
    case 'flyers':
      return `${entry.flyers} doors`;
    case 'conversations':
      return `${entry.conversations} conversations`;
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
    default:
      return '—';
  }
}

export function LeaderboardRowCard({
  entry,
  sortBy,
  isLast = false,
}: {
  entry: LeaderboardEntry;
  sortBy: LeaderboardSortBy;
  isLast?: boolean;
}) {
  const displayName = entry.name || entry.user_email || 'User';
  const value = getDisplayValue(entry, sortBy);
  const subtitle = getSubtitle(entry, sortBy);

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3.5 sm:px-5',
        !isLast && 'border-b border-border'
      )}
    >
      <div className="w-7 shrink-0 text-left sm:w-10">
        {entry.rank === 1 ? (
          <Crown className="h-5 w-5 fill-primary text-primary" />
        ) : entry.rank === 2 || entry.rank === 3 ? (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground"
          >
            {entry.rank}
          </span>
        ) : (
          <span className="text-base font-semibold text-muted-foreground">{entry.rank}</span>
        )}
      </div>

      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {entry.avatar_url ? (
          <Image
            src={entry.avatar_url}
            alt=""
            width={40}
            height={40}
            className="h-full w-full object-cover"
          />
        ) : (
          getInitials(displayName)
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[1.05rem] font-semibold text-foreground">{displayName}</p>
        <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[1.7rem] font-bold leading-none tracking-[-0.02em] text-primary sm:text-[1.9rem]">
          {value}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
