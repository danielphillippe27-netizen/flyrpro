'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ChallengeTemplate, ChallengeInstance } from '@/types/challenges';
import { formatMetricValue } from '@/lib/challenges/metric-labels';

function timeRemainingLabel(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  const now = Date.now();
  if (end.getTime() <= now) return null;
  const days = Math.ceil((end.getTime() - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

export function ChallengeUserStandingCard({
  template,
  instance,
  className,
}: {
  template: ChallengeTemplate;
  instance: ChallengeInstance | null;
  className?: string;
}) {
  if (!instance) return null;

  const locked = instance.locked || instance.instanceStatus === 'completed';
  const remaining = !locked ? timeRemainingLabel(instance.endsAt) : null;

  return (
    <Card
      className={cn(
        'border-primary/20 bg-gradient-to-br from-primary/5 to-transparent sticky top-4 z-[1]',
        className
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Your standing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {locked ? (
          <>
            <div className="text-muted-foreground text-xs uppercase tracking-wide">Final standing</div>
            <div className="font-semibold text-foreground">
              Rank #{instance.finalRank ?? instance.currentRank ?? '—'}
            </div>
            <div className="text-muted-foreground">
              {instance.finalScore != null
                ? formatMetricValue(
                    template.metric,
                    instance.finalScore,
                    template.metricLabelOverride
                  )
                : '—'}
            </div>
            {instance.completedAt ? (
              <p className="text-xs text-muted-foreground pt-1">
                Completed on {new Date(instance.completedAt).toLocaleDateString()}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {template.type === 'rolling_onboarding' &&
            instance.currentDay != null &&
            instance.totalDays != null ? (
              <div className="font-medium">
                Day {instance.currentDay} of {instance.totalDays}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Rank <span className="font-semibold text-foreground">#{instance.currentRank ?? '—'}</span>
              </span>
              {instance.currentScore != null ? (
                <span className="text-muted-foreground">
                  {formatMetricValue(
                    template.metric,
                    instance.currentScore,
                    template.metricLabelOverride
                  )}
                </span>
              ) : null}
            </div>
            {remaining ? <p className="text-xs text-muted-foreground">{remaining}</p> : null}
            {template.type === 'rolling_onboarding' &&
            instance.currentDay != null &&
            instance.totalDays != null ? (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{
                    width: `${Math.min(100, Math.round((instance.currentDay / instance.totalDays) * 100))}%`,
                  }}
                />
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
