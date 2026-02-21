'use client';

import type { CSSProperties } from 'react';
import { ContactsHubView } from '@/components/crm/ContactsHubView';

export default function LeadsPage() {
  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-background"
      style={{ '--page-sticky-offset': '72px' } as CSSProperties}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 text-center">
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <ContactsHubView view="leads" />
      </main>
    </div>
  );
}
