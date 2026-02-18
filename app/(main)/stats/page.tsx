'use client';

import { StatsPageView } from '@/components/stats/StatsPageView';

export default function StatsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <main className="max-w-7xl pl-0 pr-4 sm:pr-6 lg:pr-8 py-6">
        <StatsPageView />
      </main>
    </div>
  );
}

