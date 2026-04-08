'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChallengeStatusBadge } from '@/components/challenges/ChallengeStatusBadge';
import { ChallengeLeaderboard } from '@/components/challenges/ChallengeLeaderboard';
import { ChallengeUserStandingCard } from '@/components/challenges/ChallengeUserStandingCard';
import { formatMetricValue } from '@/lib/challenges/metric-labels';
import { templateTimeframeLabel } from '@/lib/challenges/timeframe';
import { cardStatusForTemplate } from '@/lib/challenges/status';
import type {
  ChallengeInstance,
  ChallengeTemplate,
  LeaderboardEntry,
} from '@/types/challenges';

export function ChallengeDetailView({
  viewerUserId,
  template,
  viewerInstance,
  leaderboard,
  leaderboardLast30Days,
  overview,
  leaderboardLocked,
}: {
  viewerUserId: string;
  template: ChallengeTemplate;
  viewerInstance: ChallengeInstance | null;
  leaderboard: LeaderboardEntry[];
  leaderboardLast30Days: LeaderboardEntry[];
  overview: {
    totalParticipants: number;
    averageScore: number;
    topPerformerName: string;
    topPerformerScore: number;
  };
  leaderboardLocked: boolean;
}) {
  const cardStatus = cardStatusForTemplate(template, viewerInstance);
  const timeframe = templateTimeframeLabel(template);

  return (
    <div className="min-h-full bg-gray-50 dark:bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-4" asChild>
            <Link href="/challenges" className="gap-2">
              <ArrowLeft className="size-4" />
              Challenges
            </Link>
          </Button>

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="min-w-0 space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ChallengeStatusBadge status={cardStatus} />
                {leaderboardLocked ? (
                  <span className="text-xs text-muted-foreground rounded-md border border-border/60 px-2 py-0.5">
                    Saved result
                  </span>
                ) : null}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                {template.title}
              </h1>
              <p className="text-muted-foreground max-w-2xl">{template.description}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{timeframe}</span>
                <span>
                  {template.participantCount.toLocaleString()}{' '}
                  {template.participantCount === 1 ? 'participant' : 'participants'}
                </span>
                <span className="capitalize">{template.scope === 'global' ? 'Global' : 'Team'}</span>
              </div>
            </div>
            <ChallengeUserStandingCard template={template} instance={viewerInstance} />
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total participants
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">
              {overview.totalParticipants.toLocaleString()}
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Avg (full challenge)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">
              {overview.averageScore.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 1,
              })}
            </CardContent>
          </Card>
          <Card className="border-border/60 sm:col-span-2">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Top (full challenge)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-baseline gap-2">
              <span className="text-xl font-semibold">{overview.topPerformerName}</span>
              <span className="text-sm text-muted-foreground">
                {formatMetricValue(
                  template.metric,
                  overview.topPerformerScore,
                  template.metricLabelOverride
                )}
              </span>
            </CardContent>
          </Card>
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
            <div className="grid gap-4 md:grid-cols-2 min-w-0">
              <ChallengeLeaderboard
                title="Full challenge"
                subtitle="Everyone in this challenge — total homes reached during each person’s personal window."
                entries={leaderboard}
                metric={template.metric}
                metricLabelOverride={template.metricLabelOverride}
                viewerUserId={viewerUserId}
                locked={leaderboardLocked}
              />
              <ChallengeLeaderboard
                title="Last 30 days"
                subtitle="Same people as left — only activity from the last 30 days, still inside each person’s window."
                entries={leaderboardLast30Days}
                metric={template.metric}
                metricLabelOverride={template.metricLabelOverride}
                viewerUserId={viewerUserId}
                locked={leaderboardLocked}
              />
            </div>
          </div>
          <Card className="border-border/60 h-fit">
            <CardHeader>
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              {viewerInstance?.locked || viewerInstance?.instanceStatus === 'completed' ? (
                <p>
                  This challenge is complete for you. Your rank and score are locked as a historical record.
                </p>
              ) : viewerInstance?.instanceStatus === 'active' ? (
                <p>You are actively competing. Keep going — standings update as you work routes and campaigns.</p>
              ) : (
                <p>
                  {cardStatus === 'upcoming'
                    ? 'This challenge has not started yet for you.'
                    : 'Join from the list when enrollment opens.'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
