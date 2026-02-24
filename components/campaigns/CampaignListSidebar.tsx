'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Search, ChevronsLeft, ChevronsRight, Trash2 } from 'lucide-react';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignV2 } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getClientAsync } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type StatusTab = 'active' | 'completed';

const ACTIVE_STATUSES: CampaignV2['status'][] = ['draft', 'active', 'paused'];

interface CampaignListSidebarProps {
  onNewCampaign?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
}

export function CampaignListSidebar({
  onNewCampaign,
  collapsed = false,
  onToggleCollapse,
  width = 280,
}: CampaignListSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  const handleDeleteCampaign = useCallback(
    async (id: string) => {
      try {
        await CampaignsService.deleteCampaign(id);
        setCampaigns((prev) => prev.filter((c) => c.id !== id));
        if (pathname?.startsWith(`/campaigns/${id}`)) {
          router.push('/campaigns');
        }
      } catch (e) {
        console.error('Delete campaign failed:', e);
      }
    },
    [pathname, router]
  );

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
        const data = await CampaignsService.fetchCampaignsV2(id, currentWorkspaceId);
        setCampaigns(data);
      } catch (e) {
        console.error('CampaignListSidebar load:', e);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [currentWorkspaceId]);

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

  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-12 items-center justify-center border-b border-border -mt-px">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Show campaign list"
          title="Show campaign list"
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="shrink-0 flex flex-col border-r border-border bg-white dark:bg-sidebar transition-[width] duration-200 ease-out overflow-hidden"
      style={{ width }}
    >
      <div className="p-3 pb-3 border-b border-border">
        <div className="flex items-center justify-end gap-2 mb-2">
          <button
            onClick={onToggleCollapse}
            className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0 ml-auto"
            aria-label="Hide campaign list"
            title="Hide campaign list"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search campaigns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background border-border"
            />
          </div>
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
            onClick={onNewCampaign}
            aria-label="Add campaign"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-2 pt-2">
        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)} className="flex flex-col flex-1 min-h-0 w-full">
          <TabsList className="w-full grid grid-cols-2 h-8 bg-muted/50 dark:bg-muted/30 p-0.5 rounded-lg">
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
              onDeleteCampaign={handleDeleteCampaign}
            />
          </TabsContent>
          <TabsContent value="completed" className="mt-0 flex-1 min-h-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <CampaignList
              campaigns={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              emptyMessage={byStatus.completed.length === 0 ? 'No completed campaigns' : 'No matches'}
              onDeleteCampaign={handleDeleteCampaign}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function CampaignList({
  campaigns,
  activeId,
  loading,
  userId,
  emptyMessage,
  onDeleteCampaign,
}: {
  campaigns: CampaignV2[];
  activeId: string | null;
  loading: boolean;
  userId: string | null;
  emptyMessage: string;
  onDeleteCampaign: (id: string) => Promise<void>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<CampaignV2 | null>(null);
  const [deleting, setDeleting] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteCampaign(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      className="overflow-y-auto min-h-0 flex-1 pt-0 -mx-3 px-3 overscroll-contain"
    >
      {loading ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
      ) : !userId ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Sign in to view campaigns</div>
      ) : (
        <ul className="pb-2">
          {campaigns.map((campaign) => {
            const isActive = activeId === campaign.id;
            return (
              <li key={campaign.id} className="group">
                <div
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 text-sm border-l-2 -ml-px transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                  )}
                >
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="truncate min-w-0 flex-1"
                  >
                    {campaign.name || 'Unnamed Campaign'}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleteTarget(campaign);
                    }}
                    aria-label={`Delete ${campaign.name || 'campaign'}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && userId && campaigns.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete campaign</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name || 'Unnamed Campaign'}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
