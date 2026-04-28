'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function LeadsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Leads</h1>
              <p className="text-sm text-muted-foreground">Manage leads with lists from imports, campaigns, and farms, then send the right group to the dialer.</p>
            </div>
          </div>
        </div>
      </header>
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <ContactsHubView />
      </main>
    </div>
  );
}
