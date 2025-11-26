'use client';

import type { LeaderboardEntry } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function LeaderboardRowCard({ entry }: { entry: LeaderboardEntry }) {
  const isTopThree = entry.rank <= 3;
  const rankColors: Record<number, string> = {
    1: 'bg-yellow-100 text-yellow-800',
    2: 'bg-gray-100 text-gray-800',
    3: 'bg-orange-100 text-orange-800',
  };

  return (
    <Card className={`p-4 ${isTopThree ? 'border-2' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Badge className={rankColors[entry.rank] || 'bg-gray-100 text-gray-800'}>
            #{entry.rank}
          </Badge>
          <div>
            <p className="font-semibold">{entry.user_email}</p>
            <div className="flex gap-4 text-sm text-gray-600 mt-1">
              <span>{entry.flyers} flyers</span>
              <span>{entry.conversations} conv</span>
              <span>{entry.leads} leads</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">Streak</p>
          <p className="font-bold">{entry.day_streak} days</p>
        </div>
      </div>
    </Card>
  );
}

