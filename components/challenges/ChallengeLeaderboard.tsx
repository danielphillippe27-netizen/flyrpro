'use client';

import { cn } from '@/lib/utils';
import type { LeaderboardEntry } from '@/types/challenges';
import { formatMetricValue } from '@/lib/challenges/metric-labels';
import type { ChallengeMetric } from '@/types/challenges';

export function ChallengeLeaderboard({
  title = 'Leaderboard',
  subtitle,
  entries,
  metric,
  metricLabelOverride,
  viewerUserId,
  locked,
}: {
  title?: string;
  /** Muted explainer under the title */
  subtitle?: string | null;
  entries: LeaderboardEntry[];
  metric: ChallengeMetric;
  metricLabelOverride?: string | null;
  viewerUserId: string;
  locked?: boolean;
}) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);

  return (
    <div className="rounded-lg border border-border/60 bg-card overflow-hidden min-w-0 h-full flex flex-col">
      <div className="flex items-start justify-between px-4 py-3 border-b border-border/60 bg-muted/30 gap-2 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle ? (
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
          ) : null}
        </div>
        {locked ? (
          <span className="text-xs text-muted-foreground whitespace-nowrap">Results locked</span>
        ) : null}
      </div>
      <ul className="divide-y divide-border/50 max-h-[min(420px,50vh)] overflow-y-auto flex-1 min-h-0">
        {sorted.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">No entries yet.</li>
        ) : (
          sorted.map((row) => {
            const isYou = row.userId === viewerUserId;
            return (
              <li
                key={`${row.userId}-${row.rank}`}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-2.5 text-sm',
                  isYou && 'bg-primary/5'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="tabular-nums text-muted-foreground w-7 shrink-0">#{row.rank}</span>
                  <span className={cn('font-medium truncate', isYou && 'text-primary')}>
                    {row.displayName}
                    {isYou ? <span className="text-muted-foreground font-normal"> (you)</span> : null}
                  </span>
                </div>
                <span className="tabular-nums shrink-0 text-muted-foreground">
                  {formatMetricValue(metric, row.score, metricLabelOverride)}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
