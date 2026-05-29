'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { PaywallOverlay } from './PaywallOverlay';
import { useWorkspace } from '@/lib/workspace-context';

function isSubscribe(path: string): boolean {
  return path === '/subscribe' || path.startsWith('/subscribe');
}

export function MainRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { isLoading, redirectPath } = useWorkspace();
  const showPaywallOverlay = !!redirectPath && isSubscribe(redirectPath);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || isLoading || !redirectPath || isSubscribe(redirectPath)) return;
    router.replace(redirectPath);
  }, [isLoading, mounted, redirectPath, router]);

  if (!mounted || isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 dark:bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (redirectPath && !showPaywallOverlay) {
    return null;
  }

  return (
    <>
      {children}
      {showPaywallOverlay && <PaywallOverlay />}
    </>
  );
}
