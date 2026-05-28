'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import AppTopHeader from '@/components/layout/AppTopHeader';
import { MainLayoutNavProvider, useMainLayoutNav } from '@/components/layout/MainLayoutNavContext';
import { MainRouteGuard } from '@/components/guard/MainRouteGuard';
import { Home, Trophy, Users, Settings, Target, Gauge, Plug, MessageCircle, Activity, CalendarCheck, CornerDownRight, Plus, Link2, UserRoundPlus, BriefcaseBusiness, PhoneCall, ListChecks, Search, Handshake } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getIndustryCopy } from '@/lib/industry-copy';

const SIDEBAR_COLLAPSED_W = 48;   // 3rem – icons only
const SIDEBAR_EXPANDED_W = 160;   // 10rem – icons + labels

const baseTabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/campaigns', icon: Target, label: 'Campaign' },
  { href: '/activity', icon: Activity, label: 'Activity' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/follow-up', icon: CornerDownRight, label: 'Follow Up' },
  { href: '/appointments', icon: CalendarCheck, label: 'Appointments' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/stats', icon: Gauge, label: 'Performance' },
  { href: '/settings/integrations', icon: Plug, label: 'Integrations' },
];

const supportTab = { href: '/support', icon: MessageCircle, label: 'Support' };
const offersTab = { href: '/offers', icon: Link2, label: 'Offers' };
const ambassadorsTab = { href: '/ambassadors', icon: UserRoundPlus, label: 'Ambassadors' };
const ambassadorPortalTab = { href: '/ambassador-dashboard', icon: Handshake, label: 'Ambassador' };
const salespeopleTab = { href: '/salespeople', icon: BriefcaseBusiness, label: 'Salespeople' };
const settingsTab = { href: '/settings', icon: Settings, label: 'Settings' };
const salespersonWorkspaceTabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/dialer', icon: PhoneCall, label: 'Dialer' },
  { href: '/list', icon: ListChecks, label: 'List' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/stats', icon: Gauge, label: 'Performance' },
  { href: '/scraper', icon: Search, label: 'Scraper' },
  settingsTab,
];
const founderTabs = [
  ...baseTabs.filter((tab) => ['/home'].includes(tab.href)),
  ambassadorsTab,
  salespeopleTab,
  ...baseTabs.filter((tab) => ['/activity', '/leads', '/follow-up', '/appointments'].includes(tab.href)),
  settingsTab,
  supportTab,
];
const memberTabs = baseTabs.filter((tab) =>
  [
    '/home',
    '/campaigns',
    '/leads',
    '/activity',
    '/appointments',
    '/follow-up',
    '/leaderboard',
    '/stats',
    '/settings/integrations',
  ].includes(tab.href)
);

type TabDef = { href: string; icon: LucideIcon; label: string };

function tabIsActive(tab: TabDef, pathname: string | null): boolean {
  const isIntegrations = tab.href === '/settings/integrations';
  const isSettings = tab.href === '/settings';
  const onIntegrations = pathname?.startsWith('/settings/integrations');
  if (isIntegrations) return pathname === '/settings/integrations';
  if (isSettings) {
    return pathname === '/settings' || (!!pathname?.startsWith('/settings/') && !onIntegrations);
  }
  return pathname === tab.href || !!pathname?.startsWith(tab.href + '/');
}

function MainNavItems({
  tabs,
  pathname,
  accessLevel,
  variant,
  sidebarExpanded,
  onNavigate,
}: {
  tabs: TabDef[];
  pathname: string | null;
  accessLevel: DashboardAccessLevel | null;
  variant: 'rail' | 'drawer';
  sidebarExpanded?: boolean;
  onNavigate?: () => void;
}) {
  const showLabels = variant === 'drawer' || sidebarExpanded;
  const { currentWorkspace } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);
  const createCampaignLabel = copy.actions.createCampaign;

  return (
    <>
      <Link
        href="/campaigns/create"
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-2 py-2.5 rounded-md w-full transition-opacity hover:opacity-90 min-h-[42px]',
          variant === 'drawer' ? 'px-3 justify-start' : sidebarExpanded ? 'px-2.5 justify-start' : 'justify-center px-0'
        )}
        title={createCampaignLabel}
        aria-label={createCampaignLabel}
      >
        <span className="flex items-center justify-center w-8 h-8 rounded-md bg-red-500 text-white shrink-0">
          <Plus className="w-4 h-4" strokeWidth={2.5} />
        </span>
        <span
          className={cn(
            'text-[13px] font-medium text-red-500 whitespace-nowrap overflow-hidden',
            showLabels ? 'opacity-100' : 'opacity-0 w-0 sr-only'
          )}
        >
          Create
        </span>
      </Link>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const label = copy.navLabels[tab.href] ?? tab.label;
        const isSettings = tab.href === '/settings';
        const pinMemberSettingsToBottom = accessLevel === 'member' && isSettings;
        const isActive = tabIsActive(tab, pathname);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2 py-2.5 rounded-md w-full transition-colors min-h-[42px]',
              variant === 'drawer' ? 'px-3 justify-start' : sidebarExpanded ? 'px-2.5 justify-start' : 'justify-center px-0',
              pinMemberSettingsToBottom && 'mt-auto',
              isActive
                ? 'text-primary bg-primary/10'
                : 'text-gray-500 hover:text-gray-700 dark:text-sidebar-foreground/80 dark:hover:text-sidebar-foreground hover:bg-muted/50'
            )}
            title={label}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span
              className={cn(
                'text-[13px] font-medium whitespace-nowrap overflow-hidden',
                showLabels ? 'opacity-100' : 'opacity-0 w-0 sr-only'
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </>
  );
}

function MainLayoutShell({
  children,
  tabs,
  pathname,
  accessLevel,
}: {
  children: React.ReactNode;
  tabs: TabDef[];
  pathname: string | null;
  accessLevel: DashboardAccessLevel | null;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const { mobileNavOpen, setMobileNavOpen } = useMainLayoutNav()!;

  const closeDrawer = () => setMobileNavOpen(false);

  return (
    <div className="flex h-screen flex-col">
      <AppTopHeader />

      <div className="flex flex-1 min-h-0">
        {/* Desktop: hover-expand rail */}
        <nav
          className="hidden md:flex shrink-0 bg-white dark:bg-sidebar border-r border-border/50 z-40 flex-col py-3 pl-0 pr-0 transition-[width] duration-200 ease-out"
          style={{ width: sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W }}
          onMouseEnter={() => setSidebarExpanded(true)}
          onMouseLeave={() => setSidebarExpanded(false)}
        >
          <div className="flex flex-col items-stretch justify-start flex-1 gap-3 overflow-hidden min-h-0 w-full px-1.5">
            <MainNavItems
              tabs={tabs}
              pathname={pathname}
              accessLevel={accessLevel}
              variant="rail"
              sidebarExpanded={sidebarExpanded}
            />
          </div>
        </nav>

        {/* Mobile: slide-in navigation */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-[min(100vw,20rem)] p-0 flex flex-col md:hidden">
            <SheetHeader className="border-b border-border px-4 py-3 text-left">
              <SheetTitle className="text-base">Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-2 py-3 min-h-0">
              <MainNavItems
                tabs={tabs}
                pathname={pathname}
                accessLevel={accessLevel}
                variant="drawer"
                onNavigate={closeDrawer}
              />
            </nav>
          </SheetContent>
        </Sheet>

        <div className="flex flex-1 flex-col min-w-0 min-h-0 p-0 bg-gray-50 dark:bg-background">
          <main
            className={cn(
              'flex flex-1 flex-col min-h-0 p-0 m-0',
              pathname?.startsWith('/campaigns') ||
              pathname?.startsWith('/offers') ||
              pathname?.startsWith('/map')
                ? 'overflow-hidden'
                : 'overflow-auto'
            )}
          >
            <div
              className={cn(
                'flex flex-col min-h-0',
                pathname?.startsWith('/campaigns') ||
                pathname?.startsWith('/offers') ||
                pathname?.startsWith('/map')
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
  );
}

export default function MainLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <MainLayoutContent>{children}</MainLayoutContent>
    </WorkspaceProvider>
  );
}

function MainLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { accessLevel } = useWorkspace();
  const [isAmbassador, setIsAmbassador] = useState(false);

  useEffect(() => {
    fetch('/api/access/state', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setIsAmbassador(data?.isAmbassador === true);
      })
      .catch(() => {
        setIsAmbassador(false);
      });
  }, []);

  const tabs: TabDef[] = (() => {
    const withAmbassadorPortal = (items: TabDef[]) => {
      if (!isAmbassador) return items;
      const settingsIndex = items.findIndex((tab) => tab.href === '/settings');
      if (settingsIndex === -1) return [...items, ambassadorPortalTab];
      return [
        ...items.slice(0, settingsIndex),
        ambassadorPortalTab,
        ...items.slice(settingsIndex),
      ];
    };

    if (accessLevel === 'salesperson') return withAmbassadorPortal(salespersonWorkspaceTabs);
    if (accessLevel === 'member') return withAmbassadorPortal([...memberTabs, settingsTab]);
    if (accessLevel === 'founder') {
      return withAmbassadorPortal(founderTabs);
    }
    return withAmbassadorPortal([...baseTabs, settingsTab]);
  })();

  return (
    <MainRouteGuard>
      <MainLayoutNavProvider>
        <MainLayoutShell tabs={tabs} pathname={pathname} accessLevel={accessLevel}>
          {children}
        </MainLayoutShell>
      </MainLayoutNavProvider>
    </MainRouteGuard>
  );
}
