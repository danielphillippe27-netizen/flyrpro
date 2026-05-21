'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const refreshPage = () => {
    reset();
    window.location.reload();
  };

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="mb-6 space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-destructive">FLYR</p>
              <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                An unexpected error occurred. Please refresh the page or contact support if the
                problem persists.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button onClick={refreshPage}>Refresh page</Button>
              <Button variant="outline" asChild>
                <Link href="/">Go to dashboard</Link>
              </Button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
