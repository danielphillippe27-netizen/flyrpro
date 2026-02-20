'use client';

import { useState, useEffect } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LeadsTableView } from './LeadsTableView';
import { ContactDetailSheet } from './ContactDetailSheet';
import { CreateContactDialog } from './CreateContactDialog';
import { ContactsService } from '@/lib/services/ContactsService';
import { StatsService } from '@/lib/services/StatsService';
import type { Contact, UserStats } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';

export function ContactsHubView() {
  const { currentWorkspaceId } = useWorkspace();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const load = async (currentUserId: string) => {
      try {
        setLoading(true);
        const [contactsData, statsData] = await Promise.all([
          ContactsService.fetchContacts(currentUserId, currentWorkspaceId),
          StatsService.fetchUserStats(currentUserId),
        ]);
        setContacts(contactsData);
        setUserStats(statsData ?? null);
      } catch (error) {
        console.error('Error loading contacts or stats:', error);
      } finally {
        setLoading(false);
      }
    };

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
      if (user?.id) {
        load(user.id);
      } else {
        setLoading(false);
      }
    });
  }, [currentWorkspaceId]);

  const loadContacts = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const [contactsData, statsData] = await Promise.all([
        ContactsService.fetchContacts(userId, currentWorkspaceId),
        StatsService.fetchUserStats(userId),
      ]);
      setContacts(contactsData);
      setUserStats(statsData ?? null);
    } catch (error) {
      console.error('Error loading contacts or stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateContact = () => {
    setCreateDialogOpen(true);
  };

  const handleContactCreated = () => {
    loadContacts();
  };

  const handleSyncToCrm = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/leads/sync-crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? 'Sync to CRM failed.');
        return;
      }
      alert(data?.message ?? 'Leads synced to CRM.');
    } catch (e) {
      console.error('Sync to CRM error:', e);
      alert('Sync to CRM failed.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex justify-end gap-2 mb-6">
        <Button
          variant="outline"
          onClick={handleSyncToCrm}
          disabled={syncing || loading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync to CRM'}
        </Button>
        <Button onClick={handleCreateContact} className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Add Contact
        </Button>
      </div>

      <LeadsTableView
        contacts={contacts}
        userStats={userStats}
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

