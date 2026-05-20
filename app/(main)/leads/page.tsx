'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';
import { getIndustryCopy } from '@/lib/industry-copy';
import { useWorkspace } from '@/lib/workspace-context';

export default function LeadsPage() {
  const { currentWorkspace } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{copy.leads.pageTitle}</h1>
              <p className="text-sm text-muted-foreground">{copy.leads.pageDescription}</p>
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
