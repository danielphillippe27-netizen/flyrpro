'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

function farmLabelFromPath(pathname: string | null): string | null {
  if (!pathname?.startsWith('/farms/')) return null;
  const segment = pathname.slice('/farms/'.length).split('/')[0];
  if (!segment || segment === 'create') return null;
  return segment;
}

export default function FarmsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const farmLabel = farmLabelFromPath(usePathname());

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="mb-6 space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-destructive">Farm error</p>
          <h1 className="text-2xl font-semibold tracking-tight">This farm could not be loaded.</h1>
          {farmLabel ? <p className="text-sm text-muted-foreground">Farm: {farmLabel}</p> : null}
          <p className="text-sm leading-6 text-muted-foreground">
            Please try again. If the problem persists, return to the farm list.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/farms">All farms</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
