'use client';

import { ActivityPageView } from '@/components/activity/ActivityPageView';

export default function ActivityPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-foreground">Activity</h1>
          <p className="text-muted-foreground mt-1">Your sessions, knocks, follow-ups, and appointments</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <ActivityPageView />
      </main>
    </div>
  );
}
