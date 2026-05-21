'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  Gauge,
  Home,
  Settings,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { FarmIcon } from '@/components/icons/FarmIcon';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/campaigns', label: 'Campaign', icon: Target },
  { href: '/farms', label: 'Farm', icon: FarmIcon },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/appointments', label: 'Appointments', icon: CalendarCheck },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/stats', label: 'Performance', icon: Gauge },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-16 shrink-0 border-r border-border bg-sidebar px-2 py-3 md:flex md:flex-col md:items-center md:gap-3">
        <Link
          href="/home"
          aria-label="FLYR dashboard"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-red-500 text-sm font-bold text-white"
        >
          F
        </Link>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              title={item.label}
              className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-muted/50 hover:text-sidebar-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </Link>
          );
        })}
      </aside>
      <main className="flex min-h-screen flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="mb-6 space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-destructive">FLYR</p>
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              An unexpected error occurred. Please try again or return to your dashboard.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" asChild>
              <Link href="/">Go to dashboard</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
