'use client';

import { LeaderboardContentView } from '@/components/stats/LeaderboardContentView';

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl pl-0 pr-4 sm:pr-6 lg:pr-8 py-4">
          <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
          <p className="text-muted-foreground mt-1">See how you rank against your team</p>
        </div>
      </header>
      <main className="max-w-7xl pl-0 pr-4 sm:pr-6 lg:pr-8 py-6">
        <LeaderboardContentView />
      </main>
    </div>
  );
}






