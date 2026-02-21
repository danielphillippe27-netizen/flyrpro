'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { fetchHomeDashboard, type HomeDashboardData } from '@/lib/home-dashboard';
import { HomeHeaderRow } from './HomeHeaderRow';
import { WeeklyGoalsCard } from './WeeklyGoalsCard';
import { QuickActionsRow } from './QuickActionsRow';
import { StatsOverviewCard } from './StatsOverviewCard';
import { QuoteCard } from './QuoteCard';
import { RecentSnapshot } from './RecentSnapshot';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useWorkspace } from '@/lib/workspace-context';

interface HomeDashboardViewProps {
  onCreateCampaign?: () => void;
  canCreateCampaign?: boolean;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-40 rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      </div>
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

export function HomeDashboardView({
  onCreateCampaign,
  canCreateCampaign = true,
}: HomeDashboardViewProps) {
  const { currentWorkspaceId } = useWorkspace();
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHomeDashboard(currentWorkspaceId);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 py-6">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 py-6">
        <Card className="rounded-xl border border-border">
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={load} variant="default">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const {
    user,
    stats,
    weeklyGoals,
    recentCampaigns,
    lastSessionAt,
  } = data;

  const hasAnyActivity =
    stats.doorsAllTime > 0 ||
    stats.doorsThisWeek > 0 ||
    stats.totalMinutesAllTime > 0;

  const handleEditGoals = () => {
    // TODO: Open existing settings/goals modal or route; if none exists, placeholder.
    window.location.href = '/settings#goals';
  };

  return (
    <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 py-6 space-y-6">
      <HomeHeaderRow
        firstName={user.firstName}
        lastName={user.lastName}
        doorsThisWeek={stats.doorsThisWeek}
        weeklyDoorGoal={weeklyGoals.doors}
        dayStreak={stats.dayStreak}
        lastSessionAt={lastSessionAt}
      />

      <QuoteCard />

      {!hasAnyActivity && (
        <Card className="rounded-xl border border-border bg-card">
          <CardHeader>
            <h2 className="text-lg font-semibold text-foreground">Get started</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Start your first session to see your progress here.
            </p>
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/campaigns">Start your first session</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <QuickActionsRow
        activeRouteCampaignId={null}
        onCreateCampaign={onCreateCampaign}
        canCreateCampaign={canCreateCampaign}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="w-full aspect-[4/1] min-h-0">
          <WeeklyGoalsCard
            doorsHit={stats.doorsThisWeek}
            weeklyDoorGoal={weeklyGoals.doors}
            sessionsThisWeek={stats.sessionsThisWeek}
            weeklySessionsGoal={weeklyGoals.sessions}
            minutesThisWeek={stats.minutesThisWeek}
            weeklyMinutesGoal={weeklyGoals.minutes}
            onEditGoals={handleEditGoals}
          />
        </div>
        <div className="w-full aspect-[4/1] min-h-0">
          <StatsOverviewCard
            doorsAllTime={stats.doorsAllTime}
            totalMinutesAllTime={stats.totalMinutesAllTime}
          />
        </div>
      </div>

      <RecentSnapshot recentCampaigns={recentCampaigns} />
    </div>
  );
}
