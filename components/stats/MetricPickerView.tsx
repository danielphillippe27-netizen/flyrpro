'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LeaderboardSortBy, LeaderboardTimeframe } from '@/types/database';

const METRICS: { value: LeaderboardSortBy; label: string }[] = [
  { value: 'flyers', label: 'Flyers' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'leads', label: 'Leads' },
  { value: 'distance', label: 'Distance' },
  { value: 'time', label: 'Time' },
];

const TIMEFRAMES: { value: LeaderboardTimeframe; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
];

export function MetricPickerView({
  sortBy,
  onSortChange,
  timeframe,
  onTimeframeChange,
}: {
  sortBy: LeaderboardSortBy;
  onSortChange: (sortBy: LeaderboardSortBy) => void;
  timeframe: LeaderboardTimeframe;
  onTimeframeChange: (timeframe: LeaderboardTimeframe) => void;
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Period</label>
        <Select value={timeframe} onValueChange={(v) => onTimeframeChange(v as LeaderboardTimeframe)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAMES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Sort by</label>
        <Select value={sortBy} onValueChange={(v) => onSortChange(v as LeaderboardSortBy)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRICS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
