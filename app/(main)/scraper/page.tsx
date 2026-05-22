import Link from 'next/link';
import { MapPinned, Search, Upload } from 'lucide-react';

const scraperActions = [
  {
    href: '/campaigns/create',
    icon: MapPinned,
    title: 'Map Territory',
    description: 'Draw a territory and generate the address list.',
  },
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Search className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Scraper</h1>
          </div>
        </div>
      </header>
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-3 md:grid-cols-2">
          {scraperActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="rounded-md border border-border bg-white p-4 transition-colors hover:bg-muted/50 dark:bg-card"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground">{action.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                    <span className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                      Open
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
