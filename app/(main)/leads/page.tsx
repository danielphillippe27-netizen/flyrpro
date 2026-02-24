'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function LeadsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 text-center">
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <ContactsHubView />
      </main>
    </div>
  );
}
