'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CampaignListSidebar } from '@/components/campaigns/CampaignListSidebar';
import { FarmsPageHeader } from '@/components/farms/FarmsPageHeader';
import { FarmService } from '@/lib/services/FarmService';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

const FARM_SIDEBAR_COLLAPSED_KEY = 'flyr-campaign-sidebar-collapsed';
const SIDEBAR_WIDTH = 280;

function useFarmHeaderTitle() {
  const pathname = usePathname();
  const [farmName, setFarmName] = useState<string | null>(null);

  const farmId = (() => {
    if (!pathname?.startsWith('/farms/')) return null;
    const rest = pathname.slice('/farms/'.length);
    const segment = rest.split('/')[0];
    return segment && segment !== 'create' ? segment : null;
  })();

  useEffect(() => {
    if (!farmId) {
      setFarmName(null);
      return;
    }
    let cancelled = false;
    FarmService.fetchFarm(farmId)
      .then((farm) => {
        if (!cancelled && farm) setFarmName(farm.name || 'Unnamed Farm');
      })
      .catch(() => {
        if (!cancelled) setFarmName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId]);

  if (pathname === '/farms/create') return 'Create';
  if (farmId && farmName) return farmName;
  if (farmId) return 'Farm';
  return 'Farm';
}

export function FarmsLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const headerTitle = useFarmHeaderTitle();
  const isCreatePage = pathname === '/farms/create';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FARM_SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {}
  }, []);

  const setCollapsedPersisted = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(FARM_SIDEBAR_COLLAPSED_KEY, String(value));
    } catch {}
  }, []);

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
      <div className={pathname === '/farms' ? 'flex shrink-0 max-md:w-full max-md:[&>aside]:!w-full' : 'hidden shrink-0 md:flex'}>
      <CampaignListSidebar
        onNewCampaign={() => router.push('/campaigns/create')}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
        width={SIDEBAR_WIDTH}
      />
      </div>
      <div className={`flex-1 min-w-0 flex-col overflow-hidden bg-background ${pathname === '/farms' ? 'hidden md:flex' : 'flex'}`}>
        <div className="border-b border-border px-4 py-2 text-sm md:hidden"><Link href="/campaigns">← All campaigns</Link></div>
        {!isCreatePage && <FarmsPageHeader title={headerTitle} />}
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
