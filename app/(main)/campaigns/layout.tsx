'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { CampaignListSidebar } from '@/components/campaigns/CampaignListSidebar';
import { CampaignsPageHeader } from '@/components/campaigns/CampaignsPageHeader';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

const CAMPAIGN_SIDEBAR_COLLAPSED_KEY = 'flyr-campaign-sidebar-collapsed';
const SIDEBAR_WIDTH = 280;

function useCampaignHeaderTitle() {
  const pathname = usePathname();
  const [campaignName, setCampaignName] = useState<string | null>(null);

  const campaignId = (() => {
    if (!pathname?.startsWith('/campaigns/')) return null;
    const rest = pathname.slice('/campaigns/'.length);
    const segment = rest.split('/')[0];
    return segment && segment !== 'create' ? segment : null;
  })();

  useEffect(() => {
    if (!campaignId) {
      setCampaignName(null);
      return;
    }
    let cancelled = false;
    CampaignsService.fetchCampaign(campaignId)
      .then((c) => {
        if (!cancelled && c) setCampaignName(c.name || 'Unnamed Campaign');
      })
      .catch(() => {
        if (!cancelled) setCampaignName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (pathname === '/campaigns/create') return 'New Campaign';
  if (campaignId && campaignName) return campaignName;
  if (campaignId) return 'Campaign';
  return 'Campaigns';
}

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const headerTitle = useCampaignHeaderTitle();
  const isCreatePage = pathname === '/campaigns/create';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CAMPAIGN_SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setCollapsed(stored === 'true');
    } catch {}
  }, []);

  const setCollapsedPersisted = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(CAMPAIGN_SIDEBAR_COLLAPSED_KEY, String(value));
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
      <CampaignListSidebar
        onNewCampaign={() => router.push('/campaigns/create')}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
        width={SIDEBAR_WIDTH}
      />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
        {!isCreatePage && <CampaignsPageHeader title={headerTitle} />}
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
