'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CampaignListSidebar } from '@/components/campaigns/CampaignListSidebar';

const CAMPAIGN_SIDEBAR_COLLAPSED_KEY = 'flyr-campaign-sidebar-collapsed';
const SIDEBAR_WIDTH = 280;
const SIDEBAR_STRIP_WIDTH = 52;

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);

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

  const sidebarWidth = collapsed && !hoverExpanded ? SIDEBAR_STRIP_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="flex flex-1 h-full min-h-0 w-full overflow-hidden">
      <CampaignListSidebar
        onNewCampaign={() => router.push('/campaigns/create')}
        collapsed={collapsed}
        hoverExpanded={hoverExpanded}
        onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
        onMouseEnter={() => setHoverExpanded(true)}
        onMouseLeave={() => setHoverExpanded(false)}
        width={sidebarWidth}
        stripWidth={SIDEBAR_STRIP_WIDTH}
      />
      <div className="flex-1 min-w-0 overflow-auto bg-background">
        {children}
      </div>
    </div>
  );
}
