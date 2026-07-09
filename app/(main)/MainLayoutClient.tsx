'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import AppTopHeader from '@/components/layout/AppTopHeader';
import { MainLayoutNavProvider, useMainLayoutNav } from '@/components/layout/MainLayoutNavContext';
import { MainRouteGuard } from '@/components/guard/MainRouteGuard';
import { DialerRuntimeProvider } from '@/components/dialer/DialerRuntimeProvider';
import { Home, Trophy, Users, Settings, Target, Gauge, Plug, MessageCircle, Activity, Clock, CalendarDays, CornerDownRight, Plus, UserRoundPlus, BriefcaseBusiness, PhoneCall, Handshake, FileText, PlayCircle, Inbox, KanbanSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getIndustryCopy } from '@/lib/industry-copy';

const SIDEBAR_COLLAPSED_W = 48;   // 3rem – icons only
const SIDEBAR_EXPANDED_W = 160;   // 10rem – icons + labels
const DEMO_FLOW_LOCK_MESSAGE = 'follow the 5 simple steps to unlock the rest of the dashboard';
const DEMO_FLOW_INTERACTIVE_SELECTOR =
  'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [data-demo-lockable]';

const scriptsTab = { href: '/scripts', icon: FileText, label: 'Scripts' };

const baseTabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/campaigns', icon: Target, label: 'Campaign' },
  { href: '/activity', icon: Activity, label: 'Activity' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/follow-up', icon: CornerDownRight, label: 'Follow Up' },
  { href: '/appointments', icon: Clock, label: 'Appointments' },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/stats', icon: Gauge, label: 'Performance' },
  { href: '/settings/integrations', icon: Plug, label: 'Integrations' },
];

const supportTab = { href: '/support', icon: MessageCircle, label: 'Support' };
const ambassadorsTab = { href: '/ambassadors', icon: UserRoundPlus, label: 'Ambassadors' };
const ambassadorPortalTab = { href: '/ambassador-dashboard', icon: Handshake, label: 'Ambassador' };
const salespeopleTab = { href: '/salespeople', icon: BriefcaseBusiness, label: 'Salespeople' };
const salesLeaderboardTab = { href: '/sales-leaderboard', icon: Trophy, label: 'Sales Board' };
const diallerTab = { href: '/dialer', icon: PhoneCall, label: 'Dialler' };
const demoTab = { href: '/demo-center', icon: PlayCircle, label: 'Demo' };
const inboxTab = { href: '/inbox', icon: Inbox, label: 'Inbox' };
const salesPipelineTab = { href: '/sales/pipeline', icon: KanbanSquare, label: 'Pipeline' };
const settingsTab = { href: '/settings', icon: Settings, label: 'Settings' };
const salespersonWorkspaceTabs = [
  { href: '/home', icon: Home, label: 'Home' },
  inboxTab,
  salesPipelineTab,
  diallerTab,
  scriptsTab,
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/scraper', icon: Plus, label: 'Add Leads' },
  demoTab,
  { href: '/stats', icon: Gauge, label: 'Performance' },
  settingsTab,
];
const founderTabs = [
  ...baseTabs.filter((tab) => ['/home'].includes(tab.href)),
  inboxTab,
  salesPipelineTab,
  ambassadorsTab,
  salespeopleTab,
  salesLeaderboardTab,
  ...baseTabs.filter((tab) => ['/activity', '/leads'].includes(tab.href)),
  diallerTab,
  ...baseTabs.filter((tab) => ['/follow-up', '/appointments', '/calendar'].includes(tab.href)),
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
    '/calendar',
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
  const showCreate = accessLevel !== 'salesperson';

  return (
    <>
      {showCreate ? (
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
      ) : null}
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
  children: ReactNode;
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

function DemoFlowClickGuard({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [messagePosition, setMessagePosition] = useState<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    if (!messagePosition) return undefined;
    const timer = window.setTimeout(() => setMessagePosition(null), 2400);
    return () => window.clearTimeout(timer);
  }, [messagePosition]);

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!active) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[data-self-serve-demo-flow="true"]')) return;

    const interactiveTarget = target.closest(DEMO_FLOW_INTERACTIVE_SELECTOR);
    if (!interactiveTarget) return;

    event.preventDefault();
    event.stopPropagation();

    const bubbleWidth = 304;
    const bubbleHeight = 72;
    const maxX = Math.max(12, window.innerWidth - bubbleWidth - 12);
    const maxY = Math.max(12, window.innerHeight - bubbleHeight - 12);
    const nextX = Math.min(Math.max(event.clientX + 14, 12), maxX);
    const nextY = Math.min(Math.max(event.clientY + 14, 12), maxY);
    setMessagePosition({ x: nextX, y: nextY, id: Date.now() });
  };

  return (
    <div className="contents" onClickCapture={handleClickCapture}>
      {children}
      {messagePosition ? (
        <div
          key={messagePosition.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed z-[10000] max-w-[19rem] rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-950 shadow-2xl ring-1 ring-black/5 dark:border-red-900/50 dark:bg-slate-950 dark:text-white"
          style={{ left: messagePosition.x, top: messagePosition.y }}
        >
          {DEMO_FLOW_LOCK_MESSAGE}
        </div>
      ) : null}
    </div>
  );
}

export default function MainLayoutClient({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <MainLayoutContent>{children}</MainLayoutContent>
      </Suspense>
    </WorkspaceProvider>
  );
}

function MainLayoutContent({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { accessLevel, isAmbassador } = useWorkspace();
  const isSelfServeDemoFlow = searchParams.get('source') === 'self-serve-demo';
  const isSelfServeCampaignCreate =
    pathname === '/campaigns/create' && isSelfServeDemoFlow;

  const tabs: TabDef[] = (() => {
    const withAmbassadorPortal = (items: TabDef[]) => {
      if (!isAmbassador) return items;
      if (items.some((tab) => tab.href === ambassadorPortalTab.href)) return items;
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

  if (isSelfServeCampaignCreate) {
    return (
      <DialerRuntimeProvider>
        <div className="h-screen min-h-screen overflow-hidden bg-background">
          {children}
        </div>
      </DialerRuntimeProvider>
    );
  }

  return (
    <DialerRuntimeProvider>
      <MainRouteGuard>
        <MainLayoutNavProvider>
          <DemoFlowClickGuard active={isSelfServeDemoFlow}>
            <MainLayoutShell tabs={tabs} pathname={pathname} accessLevel={accessLevel}>
              {children}
            </MainLayoutShell>
          </DemoFlowClickGuard>
        </MainLayoutNavProvider>
      </MainRouteGuard>
    </DialerRuntimeProvider>
  );
}
