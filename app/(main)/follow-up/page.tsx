'use client';

import { ActivityPageView } from '@/components/activity/ActivityPageView';

export default function FollowUpPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-foreground">Follow Up</h1>
          <p className="mt-1 text-muted-foreground">Follow-up items synced from iOS contact activity</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ActivityPageView
          forcedTypeFilter="followup"
          hideTypeFilters
          defaultRangePreset="year"
          emptyMessage="No follow-ups pending."
        />
      </main>
    </div>
  );
}
