'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { PaywallOverlay } from './PaywallOverlay';

const REDIRECT_PATHS = ['/login', '/onboarding'];
function shouldRedirect(path: string): boolean {
  if (REDIRECT_PATHS.includes(path)) return true;
  return false;
}

function isSubscribe(path: string): boolean {
  return path === '/subscribe' || path.startsWith('/subscribe');
}

export function MainRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [showPaywallOverlay, setShowPaywallOverlay] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    fetch('/api/access/redirect', { credentials: 'include' })
      .then((res) => {
        if (!cancelled) {
          if (res.status === 401) {
            setAllowed(false);
            router.replace('/login');
            setChecking(false);
            return;
          }
          return res.json();
        }
      })
      .then((data) => {
        if (cancelled || !data) return;
        const path = (data.path as string) ?? '/home';
        if (shouldRedirect(path)) {
          router.replace(path);
          setAllowed(false);
        } else if (isSubscribe(path)) {
          setAllowed(true);
          setShowPaywallOverlay(true);
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAllowed(true);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, router]);

  if (!mounted || checking) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 dark:bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return (
    <>
      {children}
      {showPaywallOverlay && <PaywallOverlay />}
    </>
  );
}
