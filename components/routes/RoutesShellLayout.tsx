'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RouteListSidebar } from '@/components/routes/RouteListSidebar';
import { CampaignsPageHeader } from '@/components/campaigns/CampaignsPageHeader';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

const SIDEBAR_WIDTH = 280;

function useRoutesShellHeaderTitle(basePath: string, indexTitle: string) {
  const pathname = usePathname();
  const [routeName, setRouteName] = useState<string | null>(null);
  const prefix = `${basePath}/`;

  const assignmentId = (() => {
    if (!pathname?.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    const segment = rest.split('/')[0];
    return segment || null;
  })();

  useEffect(() => {
    if (!assignmentId) {
      setRouteName(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/routes/assignments/${assignmentId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { route_plan?: { name?: string } } | null) => {
        if (!cancelled && data?.route_plan?.name) setRouteName(data.route_plan.name);
        else if (!cancelled) setRouteName(null);
      })
      .catch(() => {
        if (!cancelled) setRouteName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId]);

  if (assignmentId && routeName) return routeName;
  if (assignmentId) return 'Route';
  return indexTitle;
}

function isAssignmentDetailPath(pathname: string | null, basePath: string): boolean {
  const prefix = `${basePath}/`;
  if (!pathname?.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  const segments = rest.split('/').filter(Boolean);
  return segments.length === 1 && segments[0].length > 0;
}

export type RoutesShellLayoutProps = {
  children: React.ReactNode;
  /** URL prefix for this shell, e.g. `/members` */
  basePath: string;
  localStorageCollapsedKey: string;
  /** Centered header title on the index route (e.g. `Members`) */
  indexTitle: string;
};

export function RoutesShellLayout({
  children,
  basePath,
  localStorageCollapsedKey,
  indexTitle,
}: RoutesShellLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const headerTitle = useRoutesShellHeaderTitle(basePath, indexTitle);
  const hideTopHeader = isAssignmentDetailPath(pathname, basePath);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(localStorageCollapsedKey);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {}
  }, [localStorageCollapsedKey]);

  const setCollapsedPersisted = useCallback(
    (value: boolean) => {
      setCollapsed(value);
      try {
        localStorage.setItem(localStorageCollapsedKey, String(value));
      } catch {}
    },
    [localStorageCollapsedKey]
  );

  const mainContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainContentRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div className="flex flex-1 h-full min-h-0 w-full overflow-hidden">
      <RouteListSidebar
        basePath={basePath}
        onNewRoute={() => router.push('/campaigns')}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
        width={SIDEBAR_WIDTH}
      />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
        {!hideTopHeader ? <CampaignsPageHeader title={headerTitle} /> : null}
        <div
          ref={mainContentRef}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain h-full"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
