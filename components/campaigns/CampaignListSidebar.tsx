'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Search, PanelLeftClose, PanelLeft } from 'lucide-react';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignV2 } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getClientAsync } from '@/lib/supabase/client';

type StatusTab = 'active' | 'completed';

const ACTIVE_STATUSES: CampaignV2['status'][] = ['draft', 'active', 'paused'];

interface CampaignListSidebarProps {
  onNewCampaign?: () => void;
  collapsed?: boolean;
  hoverExpanded?: boolean;
  onToggleCollapse?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  width?: number;
  stripWidth?: number;
}

export function CampaignListSidebar({
  onNewCampaign,
  collapsed = false,
  hoverExpanded = false,
  onToggleCollapse,
  onMouseEnter,
  onMouseLeave,
  width = 280,
  stripWidth = 52,
}: CampaignListSidebarProps) {
  const pathname = usePathname();
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = await getClientAsync();
        const { data: { session } } = await supabase.auth.getSession();
        const id = session?.user?.id ?? null;
        setUserId(id);
        if (!id) {
          setLoading(false);
          return;
        }
        const data = await CampaignsService.fetchCampaignsV2(id);
        setCampaigns(data);
      } catch (e) {
        console.error('CampaignListSidebar load:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const byStatus = useMemo(() => {
    const active = campaigns.filter((c) => ACTIVE_STATUSES.includes(c.status));
    const completed = campaigns.filter((c) => c.status === 'completed');
    return { active, completed };
  }, [campaigns]);

  const filtered = useMemo(() => {
    const list = statusTab === 'active' ? byStatus.active : byStatus.completed;
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.type || '').toLowerCase().includes(q)
    );
  }, [byStatus.active, byStatus.completed, statusTab, search]);

  const activeId = pathname?.startsWith('/campaigns/')
    ? pathname.split('/')[2]
    : null;

  const isStripOnly = collapsed && !hoverExpanded;
  const showFullContent = !isStripOnly;

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col border-r border-border bg-muted/30 dark:bg-sidebar/50 transition-[width] duration-200 ease-out overflow-hidden',
      )}
      style={{ width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isStripOnly ? (
        <div className="flex flex-col items-center justify-center py-4 h-full gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Show campaign list"
            title="Show campaign list"
          >
            <PanelLeft className="w-5 h-5" />
          </Button>
          <span
            className="text-[10px] font-medium text-muted-foreground select-none"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            Campaigns
          </span>
        </div>
      ) : (
        <>
          {/* Title + collapse button */}
          <div className="p-4 pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-bold text-foreground truncate min-w-0">Campaigns</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onToggleCollapse}
                aria-label="Hide campaign list"
                title="Hide campaign list"
              >
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search campaigns..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm bg-background border-border"
                />
              </div>
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
                onClick={onNewCampaign}
                aria-label="Add campaign"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Active / Completed tabs – no gap before list */}
          <div className="flex-1 flex flex-col min-h-0 px-3 pt-3">
            <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)} className="flex flex-col flex-1 min-h-0 w-full">
              <TabsList className="w-full grid grid-cols-2 h-9 bg-muted/50 dark:bg-muted/30 p-0.5 rounded-lg">
                <TabsTrigger value="active" className="text-xs font-medium rounded-md">
                  Active ({byStatus.active.length})
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs font-medium rounded-md">
                  Completed ({byStatus.completed.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="mt-0 flex-1 min-h-0 focus-visible:outline-none data-[state=inactive]:hidden">
                <CampaignList
                  campaigns={filtered}
                  activeId={activeId}
                  loading={loading}
                  userId={userId}
                  emptyMessage={byStatus.active.length === 0 ? 'No active campaigns' : 'No matches'}
                />
              </TabsContent>
              <TabsContent value="completed" className="mt-0 flex-1 min-h-0 focus-visible:outline-none data-[state=inactive]:hidden">
                <CampaignList
                  campaigns={filtered}
                  activeId={activeId}
                  loading={loading}
                  userId={userId}
                  emptyMessage={byStatus.completed.length === 0 ? 'No completed campaigns' : 'No matches'}
                />
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </aside>
  );
}

function CampaignList({
  campaigns,
  activeId,
  loading,
  userId,
  emptyMessage,
}: {
  campaigns: CampaignV2[];
  activeId: string | null;
  loading: boolean;
  userId: string | null;
  emptyMessage: string;
}) {
  return (
    <div className="overflow-auto min-h-0 pt-0 -mx-3 px-3">
      {loading ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
      ) : !userId ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Sign in to view campaigns</div>
      ) : (
        <ul className="pb-2">
          {campaigns.map((campaign) => {
            const isActive = activeId === campaign.id;
            return (
              <li key={campaign.id}>
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className={cn(
                    'flex items-center px-3 py-2 text-sm border-l-2 -ml-px transition-colors truncate',
                    isActive
                      ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                  )}
                >
                  <span className="truncate min-w-0">
                    {campaign.name || 'Unnamed Campaign'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && userId && campaigns.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
      )}
    </div>
  );
}
