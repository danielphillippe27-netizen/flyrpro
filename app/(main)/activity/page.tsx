'use client';

import { SessionActivityFeed } from '@/components/activity/ActivityPageView';

export default function ActivityPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-foreground">Activity</h1>
          <p className="text-muted-foreground mt-1">Review field sessions, outcomes, and recorded GPS routes.</p>
        </div>
      </header>
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <SessionActivityFeed />
      </main>
    </div>
  );
}
