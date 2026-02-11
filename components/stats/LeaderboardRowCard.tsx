'use client';

import type { LeaderboardEntry } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function LeaderboardRowCard({ entry }: { entry: LeaderboardEntry }) {
  const isTopThree = entry.rank <= 3;
  const rankColors: Record<number, string> = {
    1: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200',
    2: 'bg-gray-100 dark:bg-gray-600/40 text-gray-800 dark:text-gray-200',
    3: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200',
  };

  return (
    <Card className={`p-4 border-border ${isTopThree ? 'border-2' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge className={rankColors[entry.rank] || 'bg-muted text-muted-foreground'}>
            #{entry.rank}
          </Badge>
          <div>
            <p className="font-semibold text-foreground">{entry.user_email}</p>
            <div className="flex gap-4 text-sm text-muted-foreground mt-1">
              <span>{entry.flyers} flyers</span>
              <span>{entry.conversations} conv</span>
              <span>{entry.leads} leads</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Streak</p>
          <p className="font-bold text-foreground">{entry.day_streak} days</p>
        </div>
      </div>
    </Card>
  );
}

