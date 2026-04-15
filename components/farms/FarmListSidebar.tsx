'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Search, ChevronsLeft, ChevronsRight, Trash2 } from 'lucide-react';
import { FarmService } from '@/lib/services/FarmService';
import type { Farm } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getClientAsync } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

type StatusTab = 'active' | 'completed';

interface FarmListSidebarProps {
  onNewFarm?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
}

function isActiveFarm(farm: Farm): boolean {
  return farm.is_active !== false;
}

export function FarmListSidebar({
  onNewFarm,
  collapsed = false,
  onToggleCollapse,
  width = 280,
}: FarmListSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  const handleDeleteFarm = useCallback(
    async (id: string) => {
      try {
        await FarmService.deleteFarm(id);
        setFarms((prev) => prev.filter((farm) => farm.id !== id));
        if (pathname?.startsWith(`/farms/${id}`)) {
          router.push('/farms');
        }
      } catch (error) {
        console.error('Delete farm failed:', error);
      }
    },
    [pathname, router]
  );

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = await getClientAsync();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const id = session?.user?.id ?? null;
        setUserId(id);
        if (!id) {
          setLoading(false);
          return;
        }
        const data = await FarmService.fetchFarms(id, currentWorkspaceId);
        setFarms(data);
      } catch (error) {
        console.error('FarmListSidebar load:', error);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [currentWorkspaceId]);

  const byStatus = useMemo(() => {
    const active = farms.filter(isActiveFarm);
    const completed = farms.filter((farm) => !isActiveFarm(farm));
    return { active, completed };
  }, [farms]);

  const filtered = useMemo(() => {
    const list = statusTab === 'active' ? byStatus.active : byStatus.completed;
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter(
      (farm) =>
        farm.name.toLowerCase().includes(q) ||
        (farm.area_label || '').toLowerCase().includes(q) ||
        (farm.description || '').toLowerCase().includes(q)
    );
  }, [byStatus.active, byStatus.completed, search, statusTab]);

  const activeId = pathname?.startsWith('/farms/') ? pathname.split('/')[2] : null;

  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-[49px] items-center justify-center border-r border-b border-border">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Show farm list"
          title="Show farm list"
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
            aria-label="Hide farm list"
            title="Hide farm list"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search farms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background border-border"
            />
          </div>
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
            onClick={onNewFarm}
            aria-label="Add farm"
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
          <TabsContent value="active" className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden">
            <FarmList
              farms={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              emptyMessage={byStatus.active.length === 0 ? 'No active farms' : 'No matches'}
              onDeleteFarm={handleDeleteFarm}
            />
          </TabsContent>
          <TabsContent value="completed" className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden">
            <FarmList
              farms={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              emptyMessage={byStatus.completed.length === 0 ? 'No completed farms' : 'No matches'}
              onDeleteFarm={handleDeleteFarm}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function FarmList({
  farms,
  activeId,
  loading,
  userId,
  emptyMessage,
  onDeleteFarm,
}: {
  farms: Farm[];
  activeId: string | null;
  loading: boolean;
  userId: string | null;
  emptyMessage: string;
  onDeleteFarm: (id: string) => Promise<void>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<Farm | null>(null);
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
      await onDeleteFarm(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={scrollContainerRef} className="overflow-y-auto min-h-0 flex-1 pt-0 -mx-3 px-3 overscroll-contain">
      {loading ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
      ) : !userId ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Sign in to view farms</div>
      ) : (
        <ul className="pb-2">
          {farms.map((farm) => {
            const isActive = activeId === farm.id;
            return (
              <li key={farm.id} className="group">
                <div
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 text-sm border-l-2 -ml-px transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                  )}
                >
                  <Link href={`/farms/${farm.id}`} className="truncate min-w-0 flex-1">
                    {farm.name || 'Unnamed Farm'}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleteTarget(farm);
                    }}
                    aria-label={`Delete ${farm.name || 'farm'}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && userId && farms.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete farm</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name || 'Unnamed Farm'}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
