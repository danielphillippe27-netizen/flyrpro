'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LeaderboardSortBy } from '@/types/database';

export function MetricPickerView({
  sortBy,
  onSortChange,
}: {
  sortBy: LeaderboardSortBy;
  onSortChange: (sortBy: LeaderboardSortBy) => void;
}) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <label className="text-sm font-medium text-muted-foreground mb-2 block">Sort by</label>
      <Select value={sortBy} onValueChange={(v) => onSortChange(v as LeaderboardSortBy)}>
        <SelectTrigger className="w-full md:w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="flyers">Flyers</SelectItem>
          <SelectItem value="conversations">Conversations</SelectItem>
          <SelectItem value="leads">Leads</SelectItem>
          <SelectItem value="distance">Distance</SelectItem>
          <SelectItem value="time">Time</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

