'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Phone, Plus, Upload } from 'lucide-react';
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
import { StatsService } from '@/lib/services/StatsService';
import type { CampaignV2, Contact, Farm, UserStats } from '@/types/database';
import type { SmartListCriteria, WorkspaceSmartList } from '@/types/smart-lists';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';

type TeamMemberOption = {
  user_id: string;
  display_name: string;
};

type TeamRosterResponse = {
  members?: TeamMemberOption[];
};

const DIALER_SELECTION_STORAGE_KEY = 'flyr:dialer:selected-contact-ids';
const LEAD_RECORD_NAV_STORAGE_KEY = 'flyr:leads:record-contact-ids';
const ALL_LEADS_LIST_ID = 'all';

function escapeCsv(value: string | null | undefined): string {
  const safe = value ?? '';
  if (/[",\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

function buildAllLeadsList(): SmartListOption {
  return {
    id: ALL_LEADS_LIST_ID,
    name: 'All Leads',
    kind: 'all',
    description: 'Everything in your current workspace lead list.',
  };
}

function buildCampaignListOption(campaign: CampaignV2): SmartListOption {
  return {
    id: campaignListId(campaign.id),
    name: campaign.name?.trim() || 'Untitled Campaign',
    kind: 'campaign',
    description: 'Campaign list',
    isCustom: true,
    criteria: buildListCriteria('campaign', { campaignIds: [campaign.id] }),
  };
}

function buildFarmListOption(farm: Farm): SmartListOption {
  return {
    id: farmListId(farm.id),
    name: farm.name?.trim() || 'Untitled Farm',
    kind: 'farm',
    description: 'Farm list',
    isCustom: true,
    criteria: buildListCriteria('farm', { farmIds: [farm.id] }),
  };
}

export function ContactsHubView() {
  const router = useRouter();
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignV2[]>([]);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [workspaceSmartLists, setWorkspaceSmartLists] = useState<WorkspaceSmartList[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [statsByUserId, setStatsByUserId] = useState<Record<string, UserStats>>({});
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [selectedListId, setSelectedListId] = useState<string>(ALL_LEADS_LIST_ID);
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canFilterByMembers = currentRole === 'owner' || currentRole === 'admin';

  const loadLeadData = useCallback(async (currentUserId: string) => {
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
          ? SmartListsService.fetchWorkspaceSmartLists(currentWorkspaceId).catch((error) => {
              console.error('Error loading smart lists:', error);
              return [] as WorkspaceSmartList[];
            })
          : Promise.resolve([] as WorkspaceSmartList[]),
      ]);

      const statsUsers = members.length > 0 ? members.map((member) => member.user_id) : [currentUserId];
      const statsRows =
        statsUsers.length > 1
          ? await StatsService.fetchUserStatsForUsers(statsUsers)
          : [await StatsService.fetchUserStats(statsUsers[0])].filter((value): value is UserStats => Boolean(value));

      setContacts(contactsData);
      setCampaigns(campaignsData);
      setFarms(farmsData);
      setWorkspaceSmartLists(smartListsData);
      setTeamMembers(members);
      setStatsByUserId(
        statsRows.reduce<Record<string, UserStats>>((acc, stat) => {
          acc[stat.user_id] = stat;
          return acc;
        }, {})
      );
    } catch (error) {
      console.error('Error loading contacts or stats:', error);
      setContacts([]);
      setCampaigns([]);
      setFarms([]);
      setWorkspaceSmartLists([]);
      setTeamMembers([]);
      setStatsByUserId({});
    } finally {
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

  const memberNameById = useMemo(
    () =>
      teamMembers.reduce<Record<string, string>>((acc, member) => {
        acc[member.user_id] = member.display_name;
        return acc;
      }, {}),
    [teamMembers]
  );

  const memberScopedContacts = useMemo(() => {
    if (selectedMemberId === 'all') return contacts;
    return contacts.filter((contact) => contact.user_id === selectedMemberId);
  }, [contacts, selectedMemberId]);

  const visibleStats = useMemo(() => {
    if (selectedMemberId === 'all') {
      return StatsService.aggregateUserStats(Object.values(statsByUserId), 'all');
    }
    return statsByUserId[selectedMemberId] ?? null;
  }, [selectedMemberId, statsByUserId]);

  const allLeadsList = useMemo(() => buildAllLeadsList(), []);

  const campaignLists = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((campaign) => buildCampaignListOption(campaign)),
    [campaigns]
  );

  const farmLists = useMemo(
    () =>
      [...farms]
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((farm) => buildFarmListOption(farm)),
    [farms]
  );

  const customLists = useMemo(
    () => workspaceSmartLists.map((list) => buildCustomSmartListOption(list)),
    [workspaceSmartLists]
  );

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
    if (selectedList.id === ALL_LEADS_LIST_ID) return memberScopedContacts;
    return filterContactsBySmartList(memberScopedContacts, selectedList);
  }, [memberScopedContacts, selectedList]);

  const builtInListItems = useMemo(
    () =>
      builtInLists.map((list) => ({
        ...list,
        count: list.id === ALL_LEADS_LIST_ID ? memberScopedContacts.length : filterContactsBySmartList(memberScopedContacts, list).length,
      })),
    [builtInLists, memberScopedContacts]
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

  const handleExportContacts = () => {
    if (visibleContacts.length === 0) return;

    const headers = ['Name', 'Phone', 'Email', 'Address', 'Status', 'Lists', 'Last Contacted', 'Created'];
    if (canFilterByMembers) headers.splice(4, 0, 'Member');

    const rows = visibleContacts.map((contact) => {
      const values = [
        contact.full_name,
        contact.phone ?? '',
        contact.email ?? '',
        contact.address ?? '',
        contact.status,
        (contactListLabelsById[contact.id] ?? []).join(' | '),
        contact.last_contacted ?? '',
        contact.created_at,
      ];

      if (canFilterByMembers) {
        values.splice(4, 0, memberNameById[contact.user_id] ?? 'Member');
      }

      return values.map((value) => escapeCsv(String(value ?? ''))).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const selectedMemberLabel =
      selectedMemberId === 'all'
        ? 'all-members'
        : slugify(memberNameById[selectedMemberId] ?? 'member') || 'member';

    link.href = url;
    link.download = `contacts-${selectedMemberLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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

  const handleSendSelectedToDialer = () => {
    if (selectedContactIds.length === 0) return;
    window.sessionStorage.setItem(DIALER_SELECTION_STORAGE_KEY, JSON.stringify(selectedContactIds));
    router.push('/dialer?selection=1');
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
    <div className="space-y-6 lg:flex lg:items-start lg:gap-6 lg:space-y-0">
      <SmartListSidebar
        builtInLists={builtInListItems}
        customLists={customListItems}
        selectedListId={selectedList.id}
        onSelectList={setSelectedListId}
        onCreateList={handleCreateSavedList}
        onDeleteList={handleDeleteList}
        canManageCustomLists={false}
        busy={loading}
      />

      <div className="min-w-0 flex-1 space-y-6">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-foreground">{selectedList.name}</h2>
                <Badge variant="secondary" className="rounded-full">
                  {visibleContacts.length} leads
                </Badge>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {selectedList.id === ALL_LEADS_LIST_ID
                  ? 'Browse all leads in this workspace, then export or send the right list to the dialer.'
                  : `Working from the ${selectedList.name} list. Export it or send this group straight to the dialer.`}
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

              <Button variant="outline" onClick={handleExportContacts} disabled={loading || visibleContacts.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Export Contacts
              </Button>
              <Button
                variant="outline"
                onClick={handleSendSelectedToDialer}
                disabled={loading || selectedContactIds.length === 0}
              >
                <Phone className="mr-2 h-4 w-4" />
                {selectedContactIds.length > 0 ? `Send ${selectedContactIds.length} to Dialer` : 'Send to Dialer'}
              </Button>
              <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import CSV
              </Button>
              <Button onClick={handleCreateContact} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Contact
              </Button>
            </div>
          </div>
        </section>

        <LeadsTableView
          contacts={visibleContacts}
          userStats={visibleStats}
          loading={loading}
          onContactSelect={handleOpenContact}
          contactListLabelsById={contactListLabelsById}
          selectedContactIds={selectedContactIds}
          allVisibleSelected={visibleContacts.length > 0 && selectedVisibleCount === visibleContacts.length}
          onToggleContactSelection={handleToggleContactSelection}
          onToggleSelectAll={handleToggleSelectAll}
        />
      </div>

      {userId && (
        <CreateContactDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSuccess={handleContactCreated}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
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
      />
    </div>
  );
}
