'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { WorkspaceProvider } from '@/lib/workspace-context';
import AppTopHeader from '@/components/layout/AppTopHeader';
import { MainRouteGuard } from '@/components/guard/MainRouteGuard';
import { Home, Map, Trophy, Users, Settings, Target, Gauge, Plug, CreditCard, MessageCircle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';

const SIDEBAR_COLLAPSED_W = 48;   // 3rem – icons only
const SIDEBAR_EXPANDED_W = 160;   // 10rem – icons + labels

const baseTabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/campaigns', icon: Target, label: 'Campaigns' },
  { href: '/map', icon: Map, label: 'Map' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/stats', icon: Gauge, label: 'Performance' },
  { href: '/billing', icon: CreditCard, label: 'Billing' },
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/settings/integrations', icon: Plug, label: 'Integrations' },
];

const supportTab = { href: '/support', icon: MessageCircle, label: 'Support' };
const adminTab = { href: '/admin', icon: Shield, label: 'Founder' };
const memberTabs = baseTabs.filter((tab) =>
  ['/home', '/campaigns', '/map', '/leads', '/leaderboard', '/stats'].includes(tab.href)
);

export default function MainLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [accessLevel, setAccessLevel] = useState<DashboardAccessLevel | null>(null);

  useEffect(() => {
    fetch('/api/access/state', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || typeof data.accessLevel !== 'string') {
          setAccessLevel('unassigned');
          return;
        }
        setAccessLevel(data.accessLevel as DashboardAccessLevel);
      })
      .catch(() => setAccessLevel('unassigned'));
  }, []);

  const tabs = (() => {
    if (accessLevel === 'member') return memberTabs;
    if (accessLevel === 'founder') return [...baseTabs, supportTab, adminTab];
    return baseTabs;
  })();

  return (
    <WorkspaceProvider>
      <MainRouteGuard>
      <div className="flex h-screen flex-col">
        <AppTopHeader />

        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar */}
          <nav
            className="shrink-0 bg-white dark:bg-sidebar border-r border-border/50 z-40 flex flex-col py-3 pl-0 pr-0 transition-[width] duration-200 ease-out"
            style={{ width: sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W }}
            onMouseEnter={() => setSidebarExpanded(true)}
            onMouseLeave={() => setSidebarExpanded(false)}
          >
            <div className="flex flex-col items-stretch justify-start flex-1 gap-3 overflow-hidden min-h-0 w-full px-1.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isIntegrations = tab.href === '/settings/integrations';
                const isSettings = tab.href === '/settings';
                const onIntegrations = pathname?.startsWith('/settings/integrations');
                const isBilling = tab.href === '/billing';
                const isAdmin = tab.href === '/admin';

                let isActive;
                if (isIntegrations) {
                  isActive = pathname === '/settings/integrations';
                } else if (isSettings) {
                  isActive = pathname === '/settings' || (pathname?.startsWith('/settings/') && !onIntegrations);
                } else if (isBilling) {
                  isActive = pathname === '/billing' || pathname?.startsWith('/billing/');
                } else if (isAdmin) {
                  isActive = pathname === '/admin' || pathname?.startsWith('/admin/');
                } else {
                  isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
                }
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={cn(
                      'flex items-center gap-2 py-2.5 rounded-md w-full transition-colors min-h-[42px]',
                      sidebarExpanded ? 'px-2.5 justify-start' : 'justify-center px-0',
                      isActive
                        ? 'text-primary bg-primary/10'
                        : 'text-gray-500 hover:text-gray-700 dark:text-sidebar-foreground/80 dark:hover:text-sidebar-foreground hover:bg-muted/50'
                    )}
                    title={tab.label}
                    aria-label={tab.label}
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    <span
                      className={cn(
                        'text-[13px] font-medium whitespace-nowrap overflow-hidden',
                        sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 sr-only'
                      )}
                    >
                      {tab.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Main content – sits under full-width header */}
          <div className="flex flex-1 flex-col min-w-0 min-h-0 p-0 bg-gray-50 dark:bg-background">
            {/* Only constrain height on campaigns/territory so their two panels scroll independently; other pages scroll in main */}
            <main className="flex flex-1 flex-col min-h-0 p-0 m-0 overflow-auto">
              <div
                className={cn(
                  'flex flex-col min-h-0',
                  pathname?.startsWith('/campaigns') || pathname?.startsWith('/map')
                    ? 'flex-1 flex flex-col overflow-hidden min-h-0 [&>*]:flex-1 [&>*]:min-h-0'
                    : 'min-h-full'
                )}
              >
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
      </MainRouteGuard>
    </WorkspaceProvider>
  );
}
