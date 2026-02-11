'use client';

import { StatsPageView } from '@/components/stats/StatsPageView';

export default function StatsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <main className="max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <StatsPageView />
      </main>
    </div>
  );
}

