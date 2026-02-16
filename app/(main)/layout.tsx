'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getClientAsync } from '@/lib/supabase/client';
import { Home, Map, Trophy, Users, Settings, Target, Hexagon, Gauge, Plug, CircleDollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from 'next/image';

const SIDEBAR_COLLAPSED_W = 48;   // 3rem – icons only
const SIDEBAR_EXPANDED_W = 160;   // 10rem – icons + labels

const tabs = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/campaigns', icon: Target, label: 'Campaigns' },
  { href: '/farms', icon: Hexagon, label: 'Territories' },
  { href: '/map', icon: Map, label: 'Map' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/stats', icon: Gauge, label: 'Performance' },
  { href: '/pricing', icon: CircleDollarSign, label: 'Pricing' },
  { href: '/settings/integrations', icon: Plug, label: 'Integrations' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    getClientAsync()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        if (session) console.log("SESSION DEBUG (Layout):", session);
      })
      .catch((err) => console.warn("Layout session check:", err));
  }, []);

  return (
    <div className="flex flex-row h-screen">
      {/* Left Sidebar – FLYR logo at top, spaced nav below */}
      <nav
        className="fixed left-0 top-0 bottom-0 bg-white dark:bg-sidebar z-50 flex flex-col py-4 pl-0 pr-0 transition-[width] duration-200 ease-out"
        style={{ width: sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W }}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        {/* FLYR logo at top of sidebar – no right padding so content meets main area */}
        <div className={cn('flex items-center shrink-0 mb-6 w-full', sidebarExpanded ? 'px-3 justify-start' : 'justify-center px-0')}>
          <Link href="/home" className="flex items-center gap-2 min-h-[40px] rounded-lg w-full px-2 hover:opacity-90 transition-opacity">
            <Image
              src="/flyr-logo-black.svg"
              alt="FLYR"
              width={32}
              height={32}
              className="h-8 w-8 dark:hidden shrink-0"
            />
            <Image
              src="/flyr-logo-white.svg"
              alt="FLYR"
              width={32}
              height={32}
              className="h-8 w-8 hidden dark:block shrink-0"
            />
            <span
              className={cn(
                'font-semibold text-foreground text-sm whitespace-nowrap overflow-hidden transition-opacity duration-200',
                sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 sr-only'
              )}
            >
              FLYR
            </span>
          </Link>
        </div>
        <div className="flex flex-col items-stretch justify-start flex-1 gap-2 overflow-hidden min-h-0 w-full px-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            // Special handling for settings - don't highlight when on integrations
            const isIntegrations = tab.href === '/settings/integrations';
            const isSettings = tab.href === '/settings';
            const onIntegrations = pathname?.startsWith('/settings/integrations');
            
            let isActive;
            if (isIntegrations) {
              isActive = pathname === '/settings/integrations';
            } else if (isSettings) {
              isActive = pathname === '/settings' || (pathname?.startsWith('/settings/') && !onIntegrations);
            } else {
              isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
            }
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-2.5 py-3 rounded-lg w-full transition-colors min-h-[44px]',
                  sidebarExpanded ? 'px-3 justify-start' : 'justify-center px-0',
                  isActive
                    ? 'text-primary bg-primary/10'
                    : 'text-gray-500 hover:text-gray-700 dark:text-sidebar-foreground/80 dark:hover:text-sidebar-foreground hover:bg-muted/50'
                )}
                title={tab.label}
                aria-label={tab.label}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span
                  className={cn(
                    'text-sm font-medium whitespace-nowrap overflow-hidden',
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

      {/* Main content – flush against sidebar, same background as pages */}
      <div
        className="flex flex-1 flex-col min-w-0 min-h-0 p-0 bg-gray-50 dark:bg-background transition-[margin-left] duration-200 ease-out"
        style={{ marginLeft: sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W }}
      >
        {/* Only constrain height on campaigns/territory so their two panels scroll independently; other pages scroll in main */}
        <main className="flex flex-1 flex-col min-h-0 p-0 m-0 overflow-auto">
          <div
            className={cn(
              'flex flex-col min-h-0',
              pathname?.startsWith('/campaigns') || pathname?.startsWith('/farms')
                ? 'flex-1 flex flex-col overflow-hidden min-h-0 [&>*]:flex-1 [&>*]:min-h-0'
                : 'min-h-full'
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

