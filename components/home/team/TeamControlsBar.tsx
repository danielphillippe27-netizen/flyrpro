'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RangePreset = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type TeamControlsRange = {
  preset: RangePreset;
  start: string;
  end: string;
};

export type TeamControlsBarProps = {
  range: TeamControlsRange;
  onRangeChange: (range: TeamControlsRange) => void;
  memberIds: string[];
  onMemberFilterChange: (ids: string[]) => void;
  members: { user_id: string; display_name: string; color?: string }[];
  showMapMode?: boolean;
  mapMode?: 'routes' | 'knocked_homes';
  onMapModeChange?: (mode: 'routes' | 'knocked_homes') => void;
};

function getRangeForPreset(preset: RangePreset): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  if (preset === 'weekly') {
    start.setDate(start.getDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === 'monthly') {
    start.setDate(1);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === 'yearly') {
    start.setMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export function TeamControlsBar({
  range,
  onRangeChange,
  memberIds,
  onMemberFilterChange,
  members,
  showMapMode,
  mapMode,
  onMapModeChange,
}: TeamControlsBarProps) {
  const setPreset = (preset: RangePreset) => {
    const { start, end } = getRangeForPreset(preset);
    onRangeChange({ preset, start, end });
  };

  const isAll = memberIds.length === 0;
  const selectAll = () => onMemberFilterChange([]);

  const toggleMember = (userId: string) => {
    if (isAll) {
      onMemberFilterChange([userId]);
    } else if (memberIds.includes(userId)) {
      const next = memberIds.filter((id) => id !== userId);
      onMemberFilterChange(next.length === 0 ? [] : next);
    } else {
      onMemberFilterChange([...memberIds, userId]);
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-gray-50 dark:bg-background pb-3 -mx-1 flex flex-wrap items-center gap-3 border-b border-border/50 mb-4">
      <span className="text-sm text-muted-foreground">Range:</span>
      <div className="flex flex-wrap gap-1">
        {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
          <Button
            key={p}
            variant={range.preset === p ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPreset(p)}
          >
            {p === 'weekly' ? 'Weekly' : p === 'monthly' ? 'Monthly' : 'Yearly'}
          </Button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground ml-2">Members:</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            {isAll ? 'All' : `${memberIds.length} selected`}
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuCheckboxItem
            checked={isAll}
            onCheckedChange={() => selectAll()}
          >
            All
          </DropdownMenuCheckboxItem>
          {members.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.user_id}
              checked={isAll || memberIds.includes(m.user_id)}
              onCheckedChange={() => toggleMember(m.user_id)}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 mr-2 inline-block"
                style={{ backgroundColor: m.color ?? '#94a3b8' }}
                aria-hidden
              />
              {m.display_name || 'Member'}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {showMapMode && onMapModeChange && (
        <>
          <span className="text-sm text-muted-foreground ml-2">Map:</span>
          <Button
            variant={mapMode === 'routes' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onMapModeChange('routes')}
          >
            Routes
          </Button>
          <Button
            variant={mapMode === 'knocked_homes' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onMapModeChange('knocked_homes')}
          >
            Knocked homes
          </Button>
        </>
      )}
    </div>
  );
}
