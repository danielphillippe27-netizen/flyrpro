'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Search, ChevronsLeft, ChevronsRight, Trash2, ChevronDown } from 'lucide-react';
import { CampaignsService } from '@/lib/services/CampaignsService';
import type { CampaignV2 } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getClientAsync } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
import { getIndustryCopy } from '@/lib/industry-copy';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type StatusTab = 'active' | 'completed';

type CampaignMember = {
  user_id: string;
  display_name: string;
  color?: string;
};

const ACTIVE_STATUSES: CampaignV2['status'][] = ['draft', 'active', 'paused'];

type CampaignAssignmentListRow = {
  campaign_id: string;
  mode: 'zone_split' | 'whole_team';
  zone_index: number | null;
  updated_at?: string | null;
  campaign?: {
    name?: string | null;
    status?: string | null;
  } | null;
};

type CampaignAssignmentListLabel = {
  label: string;
  title: string;
};

const CAMPAIGN_STATUS_VALUES = new Set<CampaignV2['status']>(['draft', 'active', 'completed', 'paused']);

function normalizeCampaignStatus(value: string | null | undefined): CampaignV2['status'] {
  return CAMPAIGN_STATUS_VALUES.has(value as CampaignV2['status'])
    ? (value as CampaignV2['status'])
    : 'draft';
}

function campaignFromAssignment(assignment: CampaignAssignmentListRow, workspaceId?: string | null): CampaignV2 {
  const createdAt = assignment.updated_at || new Date(0).toISOString();
  return {
    id: assignment.campaign_id,
    owner_id: '',
    workspace_id: workspaceId ?? null,
    name: assignment.campaign?.name || 'Campaign',
    type: 'flyer',
    address_source: 'map',
    total_flyers: 0,
    scans: 0,
    conversions: 0,
    created_at: createdAt,
    status: normalizeCampaignStatus(assignment.campaign?.status),
    progress: 0,
    progress_pct: 0,
  };
}

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
  const { currentWorkspace, currentWorkspaceId } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [assignmentLabelsByCampaignId, setAssignmentLabelsByCampaignId] = useState<Record<string, CampaignAssignmentListLabel>>({});
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [members, setMembers] = useState<CampaignMember[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);

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

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const supabase = await getClientAsync();
      const { data: { session } } = await supabase.auth.getSession();
      const id = session?.user?.id ?? null;
      setUserId(id);
      if (!id) {
        setLoading(false);
        return;
      }
      const [data, assignmentsPayload] = await Promise.all([
        CampaignsService.fetchCampaignsV2(id, currentWorkspaceId),
        currentWorkspaceId
          ? fetch(`/api/campaign-assignments?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
              credentials: 'include',
            })
              .then((response) => response.ok ? response.json() : null)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      const assignmentRows = Array.isArray(assignmentsPayload?.assignments)
        ? (assignmentsPayload.assignments as CampaignAssignmentListRow[])
        : [];
      const campaignById = new Map(data.map((campaign) => [campaign.id, campaign]));
      for (const assignment of assignmentRows) {
        if (!assignment.campaign_id || campaignById.has(assignment.campaign_id)) continue;
        campaignById.set(assignment.campaign_id, campaignFromAssignment(assignment, currentWorkspaceId));
      }
      setCampaigns(Array.from(campaignById.values()));
      const role = typeof assignmentsPayload?.role === 'string' ? assignmentsPayload.role : null;
      setWorkspaceRole(role);
      if (role === 'owner' && currentWorkspaceId) {
        const rosterPayload = await fetch(
          `/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
          { credentials: 'include' }
        )
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
        setMembers(Array.isArray(rosterPayload?.members) ? rosterPayload.members : []);
      } else {
        setMembers([]);
        setMemberIds([]);
      }
      const canManageAssignments = role === 'owner' || role === 'admin';
      const groupedAssignments = assignmentRows.reduce((map, assignment) => {
        const list = map.get(assignment.campaign_id) ?? [];
        list.push(assignment);
        map.set(assignment.campaign_id, list);
        return map;
      }, new Map<string, CampaignAssignmentListRow[]>());
      const nextLabels: Record<string, CampaignAssignmentListLabel> = {};
      groupedAssignments.forEach((rows, campaignId) => {
        const firstZone = rows.find((assignment) => assignment.mode === 'zone_split');
        if (canManageAssignments) {
          nextLabels[campaignId] = {
            label: 'Assigned',
            title: `${rows.length} active assignee${rows.length === 1 ? '' : 's'}`,
          };
          return;
        }
        nextLabels[campaignId] = {
          label:
            firstZone?.mode === 'zone_split'
              ? firstZone.zone_index ? `Zone ${firstZone.zone_index}` : 'Zone'
              : 'Assigned',
          title:
            firstZone?.mode === 'zone_split'
              ? 'Your assigned campaign zone'
              : 'Assigned to you',
        };
      });
      setAssignmentLabelsByCampaignId(nextLabels);
    } catch (e) {
      console.error('CampaignListSidebar load:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    setMemberIds([]);
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadCampaigns();
    window.addEventListener('flyr-campaigns-refresh', loadCampaigns);
    return () => {
      window.removeEventListener('flyr-campaigns-refresh', loadCampaigns);
    };
  }, [loadCampaigns]);

  const memberFilteredCampaigns = useMemo(() => {
    if (memberIds.length === 0) return campaigns;
    return campaigns.filter((campaign) => memberIds.includes(campaign.owner_id));
  }, [campaigns, memberIds]);

  const byStatus = useMemo(() => {
    const active = memberFilteredCampaigns.filter((c) => ACTIVE_STATUSES.includes(c.status));
    const completed = memberFilteredCampaigns.filter((c) => c.status === 'completed');
    return { active, completed };
  }, [memberFilteredCampaigns]);

  const toggleMember = useCallback((memberId: string) => {
    setMemberIds((current) => {
      if (current.length === 0) return [memberId];
      if (current.includes(memberId)) {
        const next = current.filter((id) => id !== memberId);
        return next.length === 0 ? [] : next;
      }
      return [...current, memberId];
    });
  }, []);

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
      <aside className="shrink-0 flex flex-col bg-white dark:bg-[#0f0f10] w-9 h-[49px] items-center justify-center border-r border-b border-border">
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
      <div className="relative p-3 border-b border-border">
        <button
          onClick={onToggleCollapse}
          className="absolute right-3 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          aria-label="Hide campaign list"
          title="Hide campaign list"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
        {workspaceRole === 'owner' && members.length > 0 ? (
          <div className="mb-2 flex items-center gap-2 pr-[38px]">
            <span className="text-xs text-muted-foreground">Members:</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 min-w-20 flex-1 justify-between gap-1 px-2.5 text-xs">
                  {memberIds.length === 0 ? 'All' : `${memberIds.length} selected`}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuCheckboxItem
                  checked={memberIds.length === 0}
                  onCheckedChange={() => setMemberIds([])}
                >
                  All
                </DropdownMenuCheckboxItem>
                {members.map((member) => (
                  <DropdownMenuCheckboxItem
                    key={member.user_id}
                    checked={memberIds.length === 0 || memberIds.includes(member.user_id)}
                    onCheckedChange={() => toggleMember(member.user_id)}
                  >
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: member.color ?? '#3B82F6' }}
                      aria-hidden
                    />
                    {member.display_name || 'Member'}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        <div className="flex gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={copy.campaigns.searchPlaceholder}
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
        {loadError && !loading && campaigns.length === 0 ? (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <div className="flex items-center justify-between gap-2">
              <span>Could not load campaigns.</span>
              <Button size="sm" variant="outline" onClick={() => void loadCampaigns()}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-3 pt-2">
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
            <CampaignList
              campaigns={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              assignmentLabelsByCampaignId={assignmentLabelsByCampaignId}
              emptyMessage={byStatus.active.length === 0 ? copy.campaigns.noActive : 'No matches'}
              copy={copy}
              onDeleteCampaign={handleDeleteCampaign}
            />
          </TabsContent>
          <TabsContent
            value="completed"
            className="mt-0 flex flex-1 min-h-0 flex-col overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
          >
            <CampaignList
              campaigns={filtered}
              activeId={activeId}
              loading={loading}
              userId={userId}
              assignmentLabelsByCampaignId={assignmentLabelsByCampaignId}
              emptyMessage={byStatus.completed.length === 0 ? copy.campaigns.noCompleted : 'No matches'}
              copy={copy}
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
  assignmentLabelsByCampaignId,
  emptyMessage,
  copy,
  onDeleteCampaign,
}: {
  campaigns: CampaignV2[];
  activeId: string | null;
  loading: boolean;
  userId: string | null;
  assignmentLabelsByCampaignId: Record<string, CampaignAssignmentListLabel>;
  emptyMessage: string;
  copy: ReturnType<typeof getIndustryCopy>;
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
        <div className="px-3 py-4 text-sm text-muted-foreground">{copy.campaigns.signIn}</div>
      ) : (
        <ul className="pb-2">
          {campaigns.map((campaign) => {
            const isActive = activeId === campaign.id;
            const assignmentLabel = assignmentLabelsByCampaignId[campaign.id];
            const canDeleteCampaign = Boolean(userId && campaign.owner_id === userId);
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
                    {campaign.name || copy.campaigns.unnamed}
                  </Link>
                  {assignmentLabel ? (
                    <Badge
                      variant="secondary"
                      className="h-5 px-1.5 text-[10px]"
                      title={assignmentLabel.title}
                    >
                      {assignmentLabel.label}
                    </Badge>
                  ) : null}
                  {canDeleteCampaign ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.preventDefault();
                        setDeleteTarget(campaign);
                      }}
                      aria-label={`Delete ${campaign.name || copy.nouns.campaign}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  ) : null}
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
            <DialogTitle>{copy.campaigns.deleteTitle}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name || copy.campaigns.deleteDescriptionFallback}&quot;? This cannot be undone.
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
