'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function CRMPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold">CRM / Contacts</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <ContactsHubView />
      </main>
    </div>
  );
}

