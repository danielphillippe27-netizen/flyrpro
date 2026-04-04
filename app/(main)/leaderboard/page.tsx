'use client';

import { LeaderboardContentView } from '@/components/stats/LeaderboardContentView';

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <main className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">
        <LeaderboardContentView />
      </main>
    </div>
  );
}
