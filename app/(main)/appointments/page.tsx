'use client';

import { Suspense } from 'react';
import { RoofingAppointments } from '@/components/appointments/RoofingAppointments';
import { useWorkspace } from '@/lib/workspace-context';
import { ActivityPageView } from '@/components/activity/ActivityPageView';

export default function AppointmentsPage() {
  const { currentWorkspaceId } = useWorkspace();
  const legacy = <ActivityPageView forcedTypeFilter="appointment" hideTypeFilters
    defaultRangePreset="year" emptyMessage="No appointments found." />;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {currentWorkspaceId ? <Suspense fallback={<p>Loading appointments…</p>}>
          <RoofingAppointments key={currentWorkspaceId} workspace={currentWorkspaceId} legacy={legacy} />
        </Suspense> : legacy}
      </main>
    </div>
  );
}
