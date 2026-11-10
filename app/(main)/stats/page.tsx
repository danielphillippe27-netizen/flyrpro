'use client';

import { useSearchParams } from 'next/navigation';
import { LeaderboardContentView } from '@/components/stats/LeaderboardContentView';
import { StatsPageView } from '@/components/stats/StatsPageView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StatsPage() {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'leaderboard' ? 'leaderboard' : 'stats';

  function selectTab(value: string) {
    const url = new URL(window.location.href);
    if (value === 'leaderboard') {
      url.searchParams.set('tab', 'leaderboard');
    } else {
      url.searchParams.delete('tab');
    }
    window.history.pushState(null, '', url);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-foreground">Performance</h1>
        <Tabs value={activeTab} onValueChange={selectTab} activationMode="manual" className="gap-6">
          <TabsList aria-label="Performance views">
            <TabsTrigger value="stats">Your Stats</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          </TabsList>
          <TabsContent value="stats">
            <StatsPageView />
          </TabsContent>
          <TabsContent value="leaderboard">
            <LeaderboardContentView />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

