import Link from 'next/link';
import { Plus, Upload } from 'lucide-react';
import { SalespersonPlacesLeadFinder } from '@/components/scraper/SalespersonPlacesLeadFinder';

const scraperActions = [
  {
    href: '/leads',
    icon: Upload,
    title: 'Import Leads',
    description: 'Upload a CSV and map lead fields.',
  },
];

export default function SalespersonScraperPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="border-b border-border bg-white dark:bg-card">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Add Leads</h1>
                <p className="text-sm text-muted-foreground">Google Places lead finder for sales outreach</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {scraperActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
                  >
                    <Icon className="h-4 w-4" />
                    {action.title}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </header>
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <SalespersonPlacesLeadFinder />
      </main>
    </div>
  );
}
