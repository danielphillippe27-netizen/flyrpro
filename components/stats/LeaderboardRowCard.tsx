'use client';

import Image from 'next/image';
import { ChevronRight, Crown } from 'lucide-react';
import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { cn } from '@/lib/utils';
import { countryCodeToFlag } from '@/lib/countries';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (name.slice(0, 2) || '?').toUpperCase();
}

function getDisplayValue(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): string {
  switch (sortBy) {
    case 'doorknocks':
      return String(entry.doorknocks);
    case 'conversations':
      return String(entry.conversations);
    case 'leads':
      return String(entry.leads);
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
    default:
      return String(entry.doorknocks);
  }
}

function getSubtitle(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): string {
  switch (sortBy) {
    case 'doorknocks':
      return `${entry.doorknocks} doors`;
    case 'conversations':
      return `${entry.conversations} conversations`;
    case 'leads':
      return `${entry.leads} leads`;
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
    default:
      return '—';
  }
}

function getPendingValue(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): number {
  if (!entry.pending) return 0;
  switch (sortBy) {
    case 'conversations':
      return entry.pending.conversations;
    case 'leads':
      return entry.pending.leads;
    case 'distance':
      return entry.pending.distance;
    case 'doorknocks':
    default:
      return entry.pending.doorknocks;
  }
}

function formatPendingValue(value: number, sortBy: LeaderboardSortBy): string {
  const formatted = sortBy === 'distance' ? value.toFixed(1) : String(Math.round(value));
  return `+${formatted} pending`;
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
  const displayName = entry.name || 'User';
  const value = getDisplayValue(entry, sortBy);
  const subtitle = getSubtitle(entry, sortBy);
  const countryFlag = countryCodeToFlag(entry.country_code);
  const pendingValue = getPendingValue(entry, sortBy);

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
        ) : entry.rank <= 0 ? (
          <span className="text-xs font-semibold text-primary">Live</span>
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
        <p className="truncate text-[1.05rem] font-semibold text-foreground">
          {displayName}
          {countryFlag ? <span className="ml-2 align-baseline">{countryFlag}</span> : null}
        </p>
        <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[1.7rem] font-bold leading-none tracking-[-0.02em] text-primary sm:text-[1.9rem]">
          {value}
        </p>
        {pendingValue > 0 ? (
          <p className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold leading-tight text-primary">
            {formatPendingValue(pendingValue, sortBy)}
          </p>
        ) : null}
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
