'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadsTableView } from './LeadsTableView';
import { ContactDetailSheet } from './ContactDetailSheet';
import { CreateContactDialog } from './CreateContactDialog';
import { ContactsService } from '@/lib/services/ContactsService';
import { StatsService } from '@/lib/services/StatsService';
import type { Contact, UserStats } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';

type TeamMemberOption = {
  user_id: string;
  display_name: string;
};

type TeamRosterResponse = {
  members?: TeamMemberOption[];
};

function escapeCsv(value: string | null | undefined): string {
  const safe = value ?? '';
  if (/[",\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function ContactsHubView() {
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [statsByUserId, setStatsByUserId] = useState<Record<string, UserStats>>({});
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canFilterByMembers = currentRole === 'owner' || currentRole === 'admin';

  const loadContacts = useCallback(async (currentUserId: string) => {
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
      const [contactsData, members] = await Promise.all([
        ContactsService.fetchContacts(currentUserId, currentWorkspaceId),
        loadTeamMembers(),
      ]);

      const statsUsers = members.length > 0 ? members.map((member) => member.user_id) : [currentUserId];
      const statsRows =
        statsUsers.length > 1
          ? await StatsService.fetchUserStatsForUsers(statsUsers)
          : [await StatsService.fetchUserStats(statsUsers[0])].filter((value): value is UserStats => Boolean(value));

      setContacts(contactsData);
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
        void loadContacts(user.id);
      } else {
        setLoading(false);
      }
    });
  }, [loadContacts]);

  const handleCreateContact = () => {
    setCreateDialogOpen(true);
  };

  const handleContactCreated = () => {
    if (userId) {
      void loadContacts(userId);
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

  const visibleContacts = useMemo(() => {
    if (selectedMemberId === 'all') return contacts;
    return contacts.filter((contact) => contact.user_id === selectedMemberId);
  }, [contacts, selectedMemberId]);

  const visibleStats = useMemo(() => {
    if (selectedMemberId === 'all') {
      return StatsService.aggregateUserStats(Object.values(statsByUserId), 'all');
    }
    return statsByUserId[selectedMemberId] ?? null;
  }, [selectedMemberId, statsByUserId]);

  const handleExportContacts = () => {
    if (visibleContacts.length === 0) return;

    const headers = ['Name', 'Phone', 'Email', 'Address', 'Status', 'Tags', 'Created'];
    if (canFilterByMembers) headers.splice(4, 0, 'Member');

    const rows = visibleContacts.map((contact) => {
      const values = [
        contact.full_name,
        contact.phone ?? '',
        contact.email ?? '',
        contact.address ?? '',
        contact.status,
        contact.tags ?? '',
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
    const selectedLabel =
      selectedMemberId === 'all'
        ? 'all-members'
        : (memberNameById[selectedMemberId] ?? 'member').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    link.href = url;
    link.download = `contacts-${selectedLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap justify-end gap-2">
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
        <Button onClick={handleCreateContact} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Contact
        </Button>
      </div>

      <LeadsTableView
        contacts={visibleContacts}
        userStats={visibleStats}
        loading={loading}
        onContactSelect={setSelectedContact}
      />

      {selectedContact && (
        <ContactDetailSheet
          contact={selectedContact}
          open={!!selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdate={loadContacts}
        />
      )}

      {userId && (
        <CreateContactDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onSuccess={handleContactCreated}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
        />
      )}
    </div>
  );
}
