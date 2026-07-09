'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadsTableView } from './LeadsTableView';
import { CreateContactDialog } from './CreateContactDialog';
import { ImportContactsDialog } from './ImportContactsDialog';
import { SmartListSidebar } from './SmartListSidebar';
import {
  buildCustomSmartListOption,
  filterContactsBySmartList,
  matchesSmartList,
  type SmartListOption,
} from './smart-list-utils';
import { ContactsService } from '@/lib/services/ContactsService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { FarmService } from '@/lib/services/FarmService';
import { SmartListsService } from '@/lib/services/SmartListsService';
import { StatsService, type DialerCallListStats } from '@/lib/services/StatsService';
import type { CampaignV2, Contact, Farm } from '@/types/database';
import type { SmartListCriteria, WorkspaceSmartList } from '@/types/smart-lists';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { getIndustryCopy, type IndustryCopy } from '@/lib/industry-copy';

type TeamMemberOption = {
  user_id: string;
  display_name: string;
};

type TeamRosterResponse = {
  members?: TeamMemberOption[];
};

const LEAD_RECORD_NAV_STORAGE_KEY = 'flyr:leads:record-contact-ids';
const LEAD_LIST_SIDEBAR_COLLAPSED_KEY = 'flyr-lead-list-sidebar-collapsed';
const LIST_SIDEBAR_WIDTH = 280;
const ALL_LEADS_LIST_ID = 'all';
const inFlightLeadWorkspaceIds = new Set<string>();
const EMPTY_DIALER_CALL_STATS: DialerCallListStats = {
  totalCalls: 0,
  newCallsThisWeek: 0,
  connectedCalls: 0,
  connectedCallsThisWeek: 0,
  lastStatusByContactId: {},
};

function isWorkedContact(contact: Contact): boolean {
  return Boolean(contact.last_contacted) || contact.status !== 'new';
}

function buildListCriteria(baseKind: SmartListCriteria['baseKind'], overrides?: Partial<SmartListCriteria>): SmartListCriteria {
  return {
    baseKind,
    source: '',
    tags: [],
    campaignIds: [],
    farmIds: [],
    contactIds: [],
    ...overrides,
  };
}

function campaignListId(campaignId: string): string {
  return `campaign:${campaignId}`;
}

function farmListId(farmId: string): string {
  return `farm:${farmId}`;
}

function buildAllLeadsList(copy: IndustryCopy): SmartListOption {
  return {
    id: ALL_LEADS_LIST_ID,
    name: copy.leads.allListName,
    kind: 'all',
    description: copy.leads.allListDescription,
  };
}

function buildCampaignListOption(campaign: CampaignV2, copy: IndustryCopy): SmartListOption {
  return {
    id: campaignListId(campaign.id),
    name: campaign.name?.trim() || 'Untitled Campaign',
    kind: 'campaign',
    description: copy.leads.campaignListDescription,
    isCustom: true,
    criteria: buildListCriteria('campaign', { campaignIds: [campaign.id] }),
  };
}

function buildFarmListOption(farm: Farm, copy: IndustryCopy): SmartListOption {
  return {
    id: farmListId(farm.id),
    name: farm.name?.trim() || 'Untitled Farm',
    kind: 'farm',
    description: copy.leads.farmListDescription,
    isCustom: true,
    criteria: buildListCriteria('farm', { farmIds: [farm.id] }),
  };
}

export function ContactsHubView() {
  const router = useRouter();
  const { currentWorkspace, currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [workspaceSmartLists, setWorkspaceSmartLists] = useState<WorkspaceSmartList[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [dialerCallStats, setDialerCallStats] = useState<DialerCallListStats>(EMPTY_DIALER_CALL_STATS);
  const [dialerCallStatsLoading, setDialerCallStatsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [selectedListId, setSelectedListId] = useState<string>(ALL_LEADS_LIST_ID);
  const [listSidebarCollapsed, setListSidebarCollapsed] = useState(false);
  const selectedUrlListIdRef = useRef<string | null>(null);
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canFilterByMembers = currentRole === 'owner' || currentRole === 'admin';

  const loadLeadData = useCallback(async (currentUserId: string) => {
    const loadKey = currentWorkspaceId ?? `user:${currentUserId}`;
    if (inFlightLeadWorkspaceIds.has(loadKey)) return;
    inFlightLeadWorkspaceIds.add(loadKey);

    const loadTeamMembers = async (): Promise<TeamMemberOption[]> => {
      if (!canFilterByMembers || !currentWorkspaceId) return [];

      try {
        const response = await fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`);
        if (!response.ok) return [];
        const data = (await response.json()) as TeamRosterResponse;
        return Array.isArray(data.members) ? data.members : [];
      } catch (error) {
        console.error('Error loading team roster:', error);
        return [];
      }
    };

    try {
      setLoading(true);
      setLoadError(false);
      const [contactsData, members, campaignsData, farmsData, smartListsData] = await Promise.all([
        ContactsService.fetchContacts(currentUserId, currentWorkspaceId),
        loadTeamMembers(),
        CampaignsService.fetchCampaignsV2(currentUserId, currentWorkspaceId).catch((error) => {
          console.error('Error loading campaigns:', error);
          return [] as CampaignV2[];
        }),
        FarmService.fetchFarms(currentUserId, currentWorkspaceId).catch((error) => {
          console.error('Error loading farms:', error);
          return [] as Farm[];
        }),
        currentWorkspaceId
          ? SmartListsService.fetchUserWorkspaceSmartLists(currentWorkspaceId, currentUserId)
              .catch(() => [] as WorkspaceSmartList[])
          : Promise.resolve([] as WorkspaceSmartList[]),
      ]);

      setContacts(contactsData);
      setCampaigns(campaignsData);
      setFarms(farmsData);
      setWorkspaceSmartLists(smartListsData);
      setTeamMembers(members);
      setLoadError(false);
    } catch (error) {
      console.error('Error loading contacts or stats:', error);
      setLoadError(true);
      setContacts([]);
      setCampaigns([]);
      setFarms([]);
      setWorkspaceSmartLists([]);
      setTeamMembers([]);
    } finally {
      inFlightLeadWorkspaceIds.delete(loadKey);
      setLoading(false);
    }
  }, [canFilterByMembers, currentWorkspaceId]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
      if (user?.id) {
        void loadLeadData(user.id);
      } else {
        setLoading(false);
      }
    });
  }, [loadLeadData]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LEAD_LIST_SIDEBAR_COLLAPSED_KEY);
      if (stored !== null) setListSidebarCollapsed(stored === 'true');
    } catch {}
  }, []);

  const setListSidebarCollapsedPersisted = useCallback((value: boolean) => {
    setListSidebarCollapsed(value);
    try {
      localStorage.setItem(LEAD_LIST_SIDEBAR_COLLAPSED_KEY, String(value));
    } catch {}
  }, []);

  const handleCreateContact = () => {
    setCreateDialogOpen(true);
  };

  const handleContactCreated = () => {
    if (userId) {
      void loadLeadData(userId);
    }
  };

  useEffect(() => {
    if (selectedMemberId === 'all') return;
    if (teamMembers.some((member) => member.user_id === selectedMemberId)) return;
    setSelectedMemberId('all');
  }, [teamMembers, selectedMemberId]);

  const memberScopedContacts = useMemo(() => {
    if (selectedMemberId === 'all') return contacts;
    return contacts.filter((contact) => contact.user_id === selectedMemberId);
  }, [contacts, selectedMemberId]);

  const workedContacts = useMemo(
    () => memberScopedContacts.filter(isWorkedContact),
    [memberScopedContacts]
  );

  const allLeadsList = useMemo(() => buildAllLeadsList(copy), [copy]);

  const campaignLists = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((campaign) => buildCampaignListOption(campaign, copy)),
    [campaigns, copy]
  );

  const farmLists = useMemo(
    () =>
      [...farms]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((farm) => buildFarmListOption(farm, copy)),
    [copy, farms]
  );

  const customLists = useMemo(
    () => workspaceSmartLists.map((list) => buildCustomSmartListOption(list)),
    [workspaceSmartLists]
  );

  useEffect(() => {
    if (selectedUrlListIdRef.current === null) {
      selectedUrlListIdRef.current = new URLSearchParams(window.location.search).get('listId') || '';
    }

    const requestedListId = selectedUrlListIdRef.current;
    if (!requestedListId || selectedListId === requestedListId) return;
    const availableIds = new Set(customLists.map((list) => list.id));
    if (availableIds.has(requestedListId)) {
      setSelectedListId(requestedListId);
    }
  }, [customLists, selectedListId]);

  const builtInLists = useMemo(
    () => [allLeadsList, ...campaignLists, ...farmLists],
    [allLeadsList, campaignLists, farmLists]
  );

  const selectedList = useMemo(() => {
    const availableLists = [...builtInLists, ...customLists];
    return availableLists.find((list) => list.id === selectedListId) ?? allLeadsList;
  }, [allLeadsList, builtInLists, customLists, selectedListId]);

  useEffect(() => {
    const availableIds = new Set([...builtInLists, ...customLists].map((list) => list.id));
    if (availableIds.has(selectedListId) || selectedListId === ALL_LEADS_LIST_ID) return;
    setSelectedListId(ALL_LEADS_LIST_ID);
  }, [builtInLists, customLists, selectedListId]);

  const visibleContacts = useMemo(() => {
    if (selectedList.id === ALL_LEADS_LIST_ID) return workedContacts;
    return filterContactsBySmartList(memberScopedContacts, selectedList);
  }, [memberScopedContacts, selectedList, workedContacts]);

  useEffect(() => {
    let cancelled = false;
    const contactIds = visibleContacts.map((contact) => contact.id);

    if (!currentWorkspaceId || contactIds.length === 0) {
      setDialerCallStats(EMPTY_DIALER_CALL_STATS);
      setDialerCallStatsLoading(false);
      return;
    }

    setDialerCallStatsLoading(true);
    StatsService.fetchDialerCallStatsForContacts(currentWorkspaceId, contactIds)
      .then((stats) => {
        if (!cancelled) setDialerCallStats(stats);
      })
      .catch((error) => {
        console.error('Error loading dialer call stats:', error);
        if (!cancelled) setDialerCallStats(EMPTY_DIALER_CALL_STATS);
      })
      .finally(() => {
        if (!cancelled) setDialerCallStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, visibleContacts]);

  const builtInListItems = useMemo(
    () =>
      builtInLists.map((list) => ({
        ...list,
        count: list.id === ALL_LEADS_LIST_ID ? workedContacts.length : filterContactsBySmartList(memberScopedContacts, list).length,
      })),
    [builtInLists, memberScopedContacts, workedContacts]
  );

  const customListItems = useMemo(
    () =>
      customLists.map((list) => ({
        ...list,
        count: filterContactsBySmartList(memberScopedContacts, list).length,
      })),
    [customLists, memberScopedContacts]
  );

  const contactListLabelsById = useMemo(() => {
    const relevantLists = [...campaignLists, ...farmLists, ...customLists];
    return visibleContacts.reduce<Record<string, string[]>>((acc, contact) => {
      acc[contact.id] = relevantLists
        .filter((list) => matchesSmartList(contact, list))
        .map((list) => list.name);
      return acc;
    }, {});
  }, [campaignLists, customLists, farmLists, visibleContacts]);

  const selectedVisibleCount = useMemo(
    () => visibleContacts.filter((contact) => selectedContactIds.includes(contact.id)).length,
    [selectedContactIds, visibleContacts]
  );

  useEffect(() => {
    const visibleIds = new Set(visibleContacts.map((contact) => contact.id));
    setSelectedContactIds((current) => current.filter((id) => visibleIds.has(id)));
  }, [visibleContacts]);

  const handleToggleContactSelection = (contactId: string, checked: boolean) => {
    setSelectedContactIds((current) => {
      if (checked) {
        return current.includes(contactId) ? current : [...current, contactId];
      }
      return current.filter((id) => id !== contactId);
    });
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setSelectedContactIds(checked ? visibleContacts.map((contact) => contact.id) : []);
  };

  const handleOpenContact = (contact: Contact) => {
    window.sessionStorage.setItem(
      LEAD_RECORD_NAV_STORAGE_KEY,
      JSON.stringify(visibleContacts.map((item) => item.id))
    );
    router.push(`/leads/${contact.id}`);
  };

  const handleCreateSavedList = async (list: { name: string; criteria: SmartListCriteria }): Promise<boolean> => {
    if (!currentWorkspaceId || !userId) return false;

    try {
      const created = await SmartListsService.createWorkspaceSmartList({
        workspaceId: currentWorkspaceId,
        createdByUserId: userId,
        name: list.name,
        criteria: list.criteria,
      });
      setWorkspaceSmartLists((current) => [created, ...current]);
      setSelectedListId(created.id);
      return true;
    } catch (error) {
      console.error('Error creating list:', error);
      return false;
    }
  };

  const handleDeleteList = async (listId: string) => {
    try {
      await SmartListsService.deleteWorkspaceSmartList(listId, currentWorkspaceId ?? undefined);
      setWorkspaceSmartLists((current) => current.filter((list) => list.id !== listId));
      if (selectedListId === listId) {
        setSelectedListId(ALL_LEADS_LIST_ID);
      }
    } catch (error) {
      console.error('Error deleting list:', error);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <SmartListSidebar
        builtInLists={builtInListItems}
        customLists={customListItems}
        selectedListId={selectedList.id}
        onSelectList={setSelectedListId}
        onCreateList={handleCreateSavedList}
        onDeleteList={handleDeleteList}
        canManageCustomLists={false}
        busy={loading}
        copy={copy}
        collapsed={listSidebarCollapsed}
        onToggleCollapse={() => setListSidebarCollapsedPersisted(!listSidebarCollapsed)}
        width={LIST_SIDEBAR_WIDTH}
      />

      <div className="min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-foreground">{selectedList.name}</h2>
                <Badge variant="secondary" className="rounded-full">
                  {visibleContacts.length} {visibleContacts.length === 1 ? copy.nouns.lead : copy.nouns.leadPlural}
                </Badge>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {selectedList.id === ALL_LEADS_LIST_ID
                  ? copy.leads.selectedAllDescription
                  : copy.leads.selectedListDescription(selectedList.name)}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
              {canFilterByMembers && teamMembers.length > 0 && (
                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="All members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    {teamMembers.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>
                        {member.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                {copy.actions.importLeads}
              </Button>
              <Button onClick={handleCreateContact} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                {copy.actions.addContact}
              </Button>
            </div>
          </div>
        </section>

        {loadError && contacts.length === 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-destructive">Could not load contacts.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (userId) void loadLeadData(userId);
                }}
                disabled={!userId || loading}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        <LeadsTableView
          contacts={visibleContacts}
          callStats={dialerCallStats}
          loading={loading || dialerCallStatsLoading}
          onContactSelect={handleOpenContact}
          contactListLabelsById={contactListLabelsById}
          selectedContactIds={selectedContactIds}
          allVisibleSelected={visibleContacts.length > 0 && selectedVisibleCount === visibleContacts.length}
          onToggleContactSelection={handleToggleContactSelection}
          onToggleSelectAll={handleToggleSelectAll}
          hasActiveFilter={selectedMemberId !== 'all' || selectedList.id !== ALL_LEADS_LIST_ID}
          copy={copy}
        />
      </div>

      {userId && (
        <CreateContactDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSuccess={handleContactCreated}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
          copy={copy}
        />
      )}

      <ImportContactsDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onSuccess={(result) => {
          if (userId) {
            void loadLeadData(userId).then(() => {
              if (result?.createdListId) {
                setSelectedListId(result.createdListId);
              }
            });
          }
        }}
        workspaceId={currentWorkspaceId ?? undefined}
        copy={copy}
      />
    </div>
  );
}
