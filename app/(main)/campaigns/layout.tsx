'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsRight } from 'lucide-react';
import { CampaignListSidebar } from '@/components/campaigns/CampaignListSidebar';

const CAMPAIGN_SIDEBAR_COLLAPSED_KEY = 'flyr-campaign-sidebar-collapsed';
const SIDEBAR_WIDTH = 280;

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <div className="flex flex-1 h-full min-h-0 w-full overflow-hidden relative">
      {/* Campaign list sidebar – zero width when collapsed so no black strip */}
      <div
        className="absolute top-0 bottom-0 z-10 flex flex-col overflow-hidden transition-[width] duration-200 ease-out"
        style={{ left: 0, width: collapsed ? 0 : SIDEBAR_WIDTH }}
      >
        <CampaignListSidebar
          onNewCampaign={() => router.push('/campaigns/create')}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsedPersisted(!collapsed)}
          width={SIDEBAR_WIDTH}
        />
      </div>
      {collapsed && (
        <button
          onClick={() => setCollapsedPersisted(false)}
          className="absolute left-0 z-20 flex items-center justify-center w-10 h-10 rounded-r-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-l-0 border-border shadow-md transition-colors cursor-pointer"
          style={{ top: '4.75rem' }}
          aria-label="Show campaign list"
          title="Show campaign list"
        >
          <ChevronsRight className="w-5 h-5" />
        </button>
      )}
      <div
        className="flex-1 min-w-0 overflow-auto bg-background transition-[margin-left] duration-200 ease-out"
        style={{ marginLeft: collapsed ? 0 : SIDEBAR_WIDTH }}
      >
        {children}
      </div>
    </div>
  );
}
