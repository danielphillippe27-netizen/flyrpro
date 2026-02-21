'use client';

import type { CSSProperties } from 'react';
import { LeaderboardContentView } from '@/components/stats/LeaderboardContentView';

export default function LeaderboardPage() {
  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-background"
      style={{ '--page-sticky-offset': '88px' } as CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 text-center">
          <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
          <p className="text-muted-foreground mt-1">See how you rank against your team</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <LeaderboardContentView />
      </main>
    </div>
  );
}




