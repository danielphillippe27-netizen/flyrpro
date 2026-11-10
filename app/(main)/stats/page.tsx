'use client';

import { useFieldSales } from '@/lib/field-sales/client';
import { ProSalesHome } from '@/components/field-sales/ProSalesHome';
import { ProSalesReport } from '@/components/field-sales/ProSalesReport';
import { ProSalesLeaderboard } from '@/components/field-sales/ProSalesLeaderboard';
import { useSearchParams } from 'next/navigation';
import { LeaderboardContentView } from '@/components/stats/LeaderboardContentView';
import { StatsPageView } from '@/components/stats/StatsPageView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StatsPage() {
  const searchParams = useSearchParams();
  const { data: sales } = useFieldSales({}, true);
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab === 'leaderboard' || (sales?.enabled && (requestedTab === 'sales' || requestedTab === 'sales-leaderboard'))
    ? requestedTab : 'stats';

  function selectTab(value: string) {
    const url = new URL(window.location.href);
    if (value !== 'stats') {
      url.searchParams.set('tab', value);
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
          <TabsList aria-label="Performance views" className="h-auto flex-wrap justify-start">
            <TabsTrigger value="stats">Your Stats</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            {sales?.enabled && <TabsTrigger value="sales">Sales Performance</TabsTrigger>}
            {sales?.enabled && <TabsTrigger value="sales-leaderboard">Sales Leaderboard</TabsTrigger>}
          </TabsList>
          <TabsContent value="stats" className="space-y-4">
            {sales?.enabled && <ProSalesHome compact />}
            <StatsPageView />
          </TabsContent>
          <TabsContent value="leaderboard">
            <LeaderboardContentView />
          </TabsContent>
          {sales?.enabled && <>
            <TabsContent value="sales"><ProSalesReport embedded /></TabsContent>
            <TabsContent value="sales-leaderboard"><ProSalesLeaderboard embedded /></TabsContent>
          </>}
        </Tabs>
      </section>
    </div>
  );
}

