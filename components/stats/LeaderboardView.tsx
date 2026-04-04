'use client';

import type { LeaderboardEntry, LeaderboardSortBy } from '@/types/database';
import { LeaderboardRowCard } from './LeaderboardRowCard';
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

export function LeaderboardView({
  entries,
  loading,
  error,
  onRetry,
  sortBy,
  onSortChange,
}: {
  entries: LeaderboardEntry[];
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
        <p className="text-sm">Loading leaderboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
        <div className="mb-3 text-4xl">🏆</div>
        <p className="font-medium text-foreground">No leaderboard entries yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a session to appear on the leaderboard
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex justify-end border-b border-border px-4 py-4 sm:px-5">
        <InlineHeaderSelect
          value={sortBy}
          onValueChange={(value) => onSortChange(value as LeaderboardSortBy)}
          options={METRICS}
          align="end"
        />
      </div>

      <div>
        {entries.map((entry, index) => (
          <LeaderboardRowCard
            key={entry.id}
            entry={entry}
            sortBy={sortBy}
            isLast={index === entries.length - 1}
          />
        ))}
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
      <SelectTrigger
        className="h-auto min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold text-primary shadow-none ring-0 hover:bg-transparent focus:ring-0 focus:ring-offset-0 [&_svg]:opacity-100"
      >
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
