'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Search, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getClientAsync } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';

type AssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

type RouteAssignmentListRow = {
  id: string;
  status: AssignmentStatus;
  route_plan: {
    id: string;
    name: string;
    total_stops: number;
    est_minutes: number | null;
    campaign_id?: string | null;
  } | null;
};

type StatusTab = 'active' | 'completed';

const ACTIVE_STATUSES: AssignmentStatus[] = ['assigned', 'accepted', 'in_progress'];

/** Sidebar: show the first segment before " — " so auto-suffixed dates / splits stay out of the list. */
function routeSidebarDisplayName(fullName: string): string {
  const t = fullName.trim();
  const i = t.indexOf(' — ');
  if (i > 0) {
    const head = t.slice(0, i).trim();
    if (head.length > 0) return head;
  }
  return t || 'Route';
}

interface RouteListSidebarProps {
  /** App path prefix for links and active state, e.g. `/routes` */
  basePath: string;
  onNewRoute?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
}

export function RouteListSidebar({
  basePath,
  onNewRoute,
  collapsed = false,
  onToggleCollapse,
  width = 280,
}: RouteListSidebarProps) {
  const pathname = usePathname();
  const { currentWorkspaceId } = useWorkspace();
  const [assignments, setAssignments] = useState<RouteAssignmentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  const loadAssignments = useCallback(async () => {
    if (!currentWorkspaceId) {
      setAssignments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/routes/assignments?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
        { credentials: 'include' }
      );
      const payload = (await response.json().catch(() => null)) as
        | { assignments?: RouteAssignmentListRow[] }
        | null;
      const rows = Array.isArray(payload?.assignments) ? payload.assignments : [];
      setAssignments(rows);
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = await getClientAsync();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setUserId(session?.user?.id ?? null);
      } catch {
        setUserId(null);
      }
    };
    void run();
  }, []);

  const byStatus = useMemo(() => {
    const active = assignments.filter((a) => ACTIVE_STATUSES.includes(a.status));
    const completed = assignments.filter((a) => a.status === 'completed');
    return { active, completed };
  }, [assignments]);

  const filtered = useMemo(() => {
    const list = statusTab === 'active' ? byStatus.active : byStatus.completed;
    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter((a) => (a.route_plan?.name ?? '').toLowerCase().includes(q));
  }, [byStatus.active, byStatus.completed, statusTab, search]);

  const listPrefix = `${basePath.replace(/\/$/, '')}/`;
  const activeId = pathname?.startsWith(listPrefix) ? pathname.slice(listPrefix.length).split('/')[0] || null : null;

  if (collapsed) {
    return (
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-12 items-center justify-center border-b border-border -mt-px">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-transparent hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="Show route list"
          title="Show route list"
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
            aria-label="Hide route list"
            title="Hide route list"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search routes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-background border-border"
            />
          </div>
          <Button
            size="icon"
            className="h-8 w-8 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
            onClick={onNewRoute}
            aria-label="Open campaigns to assign routes"
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
          <TabsContent
            value="active"
            className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
          >
            <RouteAssignmentList
              basePath={basePath}
              assignments={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              emptyMessage={byStatus.active.length === 0 ? 'No active routes' : 'No matches'}
            />
          </TabsContent>
          <TabsContent
            value="completed"
            className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
          >
            <RouteAssignmentList
              basePath={basePath}
              assignments={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              emptyMessage={byStatus.completed.length === 0 ? 'No completed routes' : 'No matches'}
            />
          </TabsContent>
        </Tabs>
      </div>
    </aside>
  );
}

function RouteAssignmentList({
  basePath,
  assignments,
  activeId,
  loading,
  userId,
  emptyMessage,
}: {
  basePath: string;
  assignments: RouteAssignmentListRow[];
  activeId: string | null;
  loading: boolean;
  userId: string | null;
  emptyMessage: string;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => handleWheelScrollContainer(e, el);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div ref={scrollContainerRef} className="overflow-y-auto min-h-0 flex-1 pt-0 -mx-3 px-3 overscroll-contain">
      {loading ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Loading...</div>
      ) : !userId ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">Sign in to view routes</div>
      ) : (
        <ul className="pb-2">
          {assignments.map((assignment) => {
            const isActive = activeId === assignment.id;
            return (
              <li key={assignment.id} className="group">
                <div
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 text-sm border-l-2 -ml-px transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 dark:bg-primary/15 text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 dark:hover:bg-muted/30'
                  )}
                >
                  <Link href={`${basePath.replace(/\/$/, '')}/${assignment.id}`} className="truncate min-w-0 flex-1">
                    {routeSidebarDisplayName(assignment.route_plan?.name ?? 'Route')}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && userId && assignments.length === 0 && (
        <div className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
      )}
    </div>
  );
}
