'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function SalespersonListPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-foreground">List</h1>
        </div>
      </header>
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <ContactsHubView />
      </main>
    </div>
  );
}
