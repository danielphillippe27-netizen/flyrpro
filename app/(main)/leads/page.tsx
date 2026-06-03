'use client';

import { ContactsHubView } from '@/components/crm/ContactsHubView';
import { getIndustryCopy } from '@/lib/industry-copy';
import { useWorkspace } from '@/lib/workspace-context';

export default function LeadsPage() {
  const { currentWorkspace } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-background">
      <header className="shrink-0 bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{copy.leads.pageTitle}</h1>
              <p className="text-sm text-muted-foreground">{copy.leads.pageDescription}</p>
            </div>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <ContactsHubView />
      </main>
    </div>
  );
}
