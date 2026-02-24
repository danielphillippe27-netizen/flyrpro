'use client';

import { AppointmentsCalendarView } from '@/components/appointments/AppointmentsCalendarView';

export default function AppointmentsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
          <p className="mt-1 text-muted-foreground">Calendar view of appointments logged from FLYR iOS activity</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <AppointmentsCalendarView />
      </main>
    </div>
  );
}

