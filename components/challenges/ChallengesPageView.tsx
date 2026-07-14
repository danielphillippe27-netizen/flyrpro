'use client';

import { useEffect, useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChallengeCard } from '@/components/challenges/ChallengeCard';
import { useChallengesViewer } from '@/components/challenges/useChallengesViewer';
import type { ChallengeInstance, ChallengeTemplate } from '@/types/challenges';
import { cn } from '@/lib/utils';

const FIRST_30_SLUG = 'first-30-days';

export type ListedChallenge = ChallengeTemplate & {
  viewerSummaryLine?: string | null;
  viewerInstance?: ChallengeInstance | null;
};

export function ChallengesPageView() {
  const { isTeamWorkspace, canCreateTeamChallenge } = useChallengesViewer();
  const [globalTemplates, setGlobalTemplates] = useState<ListedChallenge[]>([]);
  const [teamTemplates, setTeamTemplates] = useState<ListedChallenge[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch('/api/challenges', { credentials: 'include' })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          global?: ListedChallenge[];
          team?: ListedChallenge[];
          error?: string;
          warning?: string;
        } | null;
        if (!res.ok) {
          throw new Error(json?.error ?? 'Failed to load challenges');
        }
        if (cancelled) return;
        setGlobalTemplates(json?.global ?? []);
        setTeamTemplates(json?.team ?? []);
        if (json?.warning) {
          setLoadError(json.warning);
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load challenges');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleGlobals = useMemo(
    () => globalTemplates.filter((t) => t.templateStatus !== 'archived'),
    [globalTemplates]
  );

  const visibleTeams = useMemo(
    () => teamTemplates.filter((t) => t.templateStatus !== 'archived'),
    [teamTemplates]
  );

  const spotlight = useMemo(() => {
    const bySlug = visibleGlobals.find((t) => t.slug === FIRST_30_SLUG);
    if (bySlug && bySlug.templateStatus === 'active') return bySlug;
    return visibleGlobals.find((t) => t.templateStatus === 'active') ?? null;
  }, [visibleGlobals]);

  const globalActive = useMemo(
    () =>
      visibleGlobals.filter(
        (t) => t.templateStatus === 'active' && t.id !== spotlight?.id
      ),
    [visibleGlobals, spotlight]
  );

  const globalUpcoming = useMemo(
    () => visibleGlobals.filter((t) => t.templateStatus === 'upcoming'),
    [visibleGlobals]
  );

  const globalCompleted = useMemo(
    () => visibleGlobals.filter((t) => t.templateStatus === 'completed'),
    [visibleGlobals]
  );

  const teamActive = useMemo(
    () => visibleTeams.filter((t) => t.templateStatus === 'active'),
    [visibleTeams]
  );

  const teamUpcoming = useMemo(
    () => visibleTeams.filter((t) => t.templateStatus === 'upcoming'),
    [visibleTeams]
  );

  if (loading) {
    return (
      <div className="min-h-full bg-gray-50 dark:bg-background flex items-center justify-center p-12 text-sm text-muted-foreground">
        Loading challenges…
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 dark:bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Challenges</h1>
          <p className="text-muted-foreground max-w-2xl">
            Compete, track progress, and climb the leaderboard.
          </p>
          {loadError ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">{loadError}</p>
          ) : null}
        </header>

        <Tabs defaultValue="global" className="w-full">
          <TabsList
            className={cn('grid w-full max-w-md', isTeamWorkspace ? 'grid-cols-2' : 'grid-cols-1')}
          >
            <TabsTrigger value="global">Global Challenges</TabsTrigger>
            {isTeamWorkspace ? <TabsTrigger value="team">Team Challenges</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="global" className="mt-8 space-y-10">
            {visibleGlobals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No global challenges yet. Run the latest database migration to seed &quot;Your First 30 Days on
                WolfGrid&quot;.
              </p>
            ) : null}

            {spotlight ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Active challenge spotlight
                </h2>
                <ChallengeCard
                  template={spotlight}
                  viewerInstance={spotlight.viewerInstance}
                  viewerSummaryLine={spotlight.viewerSummaryLine}
                  className="border-primary/15 shadow-md"
                />
              </section>
            ) : null}

            {globalActive.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Active challenges
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {globalActive.map((t) => (
                    <ChallengeCard
                      key={t.id}
                      template={t}
                      viewerInstance={t.viewerInstance}
                      viewerSummaryLine={t.viewerSummaryLine}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {globalUpcoming.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Upcoming
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {globalUpcoming.map((t) => (
                    <ChallengeCard
                      key={t.id}
                      template={t}
                      viewerInstance={t.viewerInstance}
                      viewerSummaryLine={t.viewerSummaryLine}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {globalCompleted.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Completed challenges
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {globalCompleted.map((t) => (
                    <ChallengeCard
                      key={t.id}
                      template={t}
                      viewerInstance={t.viewerInstance}
                      viewerSummaryLine={t.viewerSummaryLine}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </TabsContent>

          {isTeamWorkspace ? (
            <TabsContent value="team" className="mt-8 space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground max-w-xl">
                  Internal competitions for your workspace. Only members of this team can see these challenges.
                </p>
                {canCreateTeamChallenge ? (
                  <Button type="button" variant="outline" disabled title="Team challenge creation is not available yet">
                    Create challenge
                  </Button>
                ) : null}
              </div>

              {visibleTeams.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-card/50 px-6 py-14 text-center space-y-3">
                  <h3 className="text-lg font-semibold text-foreground">No team challenges yet</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Team challenges will appear here when your workspace creates them.
                  </p>
                </div>
              ) : (
                <>
                  {teamActive.length > 0 ? (
                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Active
                      </h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        {teamActive.map((t) => (
                          <ChallengeCard
                            key={t.id}
                            template={t}
                            viewerInstance={t.viewerInstance}
                            viewerSummaryLine={t.viewerSummaryLine}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {teamUpcoming.length > 0 ? (
                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Upcoming
                      </h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        {teamUpcoming.map((t) => (
                          <ChallengeCard
                            key={t.id}
                            template={t}
                            viewerInstance={t.viewerInstance}
                            viewerSummaryLine={t.viewerSummaryLine}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

    </div>
  );
}
