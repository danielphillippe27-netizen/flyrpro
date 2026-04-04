'use client';

import type { BrokerageLeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const METRICS: { value: LeaderboardSortBy; label: string }[] = [
  { value: 'flyers', label: 'Doors' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'distance', label: 'Distance' },
];

function getDisplayValue(entry: BrokerageLeaderboardEntry, sortBy: LeaderboardSortBy): string {
  switch (sortBy) {
    case 'flyers':
      return String(entry.flyers);
    case 'conversations':
      return String(entry.conversations);
    case 'distance':
      return `${entry.distance.toFixed(1)} km`;
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

export function BrokerageLeaderboardView({
  entries,
  loading,
  error,
  onRetry,
  sortBy,
  onSortChange,
}: {
  entries: BrokerageLeaderboardEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  sortBy: LeaderboardSortBy;
  onSortChange: (sortBy: LeaderboardSortBy) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-muted-foreground">
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
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
      <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
        <div className="mb-3 text-4xl">🏢</div>
        <p className="font-medium text-foreground">No brokerage rankings yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspaces with a brokerage set will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="grid grid-cols-[28px,minmax(0,1fr),auto] items-center gap-2 text-sm sm:grid-cols-[40px,minmax(0,1fr),auto] sm:gap-3">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">Brokerage</span>
          <InlineHeaderSelect
            value={sortBy}
            onValueChange={(value) => onSortChange(value as LeaderboardSortBy)}
            options={METRICS}
            align="end"
          />
        </div>
      </div>

      <div>
        {entries.map((entry, index) => {
          const value = getDisplayValue(entry, sortBy);
          const subtitle = getSubtitle(entry);
          return (
            <Card
              key={entry.brokerage_key}
              className={`rounded-none border-0 border-b border-border bg-card p-3 shadow-none transition-colors sm:p-4 ${
                index === entries.length - 1 ? 'border-b-0' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 shrink-0 text-center">
                  {entry.rank === 1 ? (
                    <span className="text-lg text-primary" role="img" aria-label="1st place">👑</span>
                  ) : entry.rank === 2 ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      2
                    </span>
                  ) : entry.rank === 3 ? (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      3
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">
                      {entry.rank}
                    </span>
                  )}
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-xs font-medium text-primary">
                    {entry.display_name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {entry.display_name}
                  </span>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold text-primary">{value}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function InlineHeaderSelect({
  value,
  onValueChange,
  options,
  align = 'center',
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  align?: 'center' | 'end';
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-auto min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold text-primary shadow-none ring-0 hover:bg-transparent focus:ring-0 focus:ring-offset-0 [&_svg]:opacity-100">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
