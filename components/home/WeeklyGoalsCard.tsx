'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatTimeTracked } from '@/lib/stats/formatters';
import { Settings } from 'lucide-react';

interface WeeklyGoalsCardProps {
  doorsHit: number;
  weeklyDoorGoal: number;
  sessionsThisWeek: number;
  weeklySessionsGoal?: number | null;
  minutesThisWeek: number;
  weeklyMinutesGoal?: number | null;
  onEditGoals: () => void;
}

export function WeeklyGoalsCard({
  doorsHit,
  weeklyDoorGoal,
  sessionsThisWeek,
  weeklySessionsGoal,
  minutesThisWeek,
  weeklyMinutesGoal,
  onEditGoals,
}: WeeklyGoalsCardProps) {
  const doorsProgress = weeklyDoorGoal > 0 ? Math.min(100, (doorsHit / weeklyDoorGoal) * 100) : 0;

  return (
    <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Weekly Goals</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEditGoals}
            className="text-muted-foreground"
            aria-label="Edit goals"
          >
            <Settings className="w-4 h-4 mr-1" />
            Edit goals
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between min-h-0 space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Doors</span>
            <span className="font-medium text-foreground">
              {doorsHit} / {weeklyDoorGoal}
            </span>
          </div>
          <Progress value={doorsProgress} className="h-2" />
        </div>
        {weeklySessionsGoal != null && (
          <div className="text-sm">
            <span className="text-muted-foreground">Sessions: </span>
            <span className="font-medium text-foreground">
              {sessionsThisWeek} / {weeklySessionsGoal}
            </span>
          </div>
        )}
        {weeklyMinutesGoal != null && (
          <div className="text-sm">
            <span className="text-muted-foreground">Time: </span>
            <span className="font-medium text-foreground">
              {formatTimeTracked(minutesThisWeek)} / {formatTimeTracked(weeklyMinutesGoal)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
