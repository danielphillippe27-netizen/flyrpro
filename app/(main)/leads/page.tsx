'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function LeadsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-background">
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <ContactsHubView />
      </main>
    </div>
  );
}
