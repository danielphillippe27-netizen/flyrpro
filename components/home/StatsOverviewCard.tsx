'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatTimeTracked } from '@/lib/stats/formatters';

interface StatsOverviewCardProps {
  doorsAllTime: number;
  totalMinutesAllTime: number;
}

export function StatsOverviewCard({
  doorsAllTime,
  totalMinutesAllTime,
}: StatsOverviewCardProps) {
  return (
    <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2 shrink-0">
        <h2 className="text-lg font-semibold text-foreground">Lifetime Stats</h2>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center min-h-0">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total time</p>
            <p className="text-2xl font-semibold text-foreground">
              {formatTimeTracked(totalMinutesAllTime)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Doors hit</p>
            <p className="text-2xl font-semibold text-foreground">{doorsAllTime}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
