'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContactsService } from '@/lib/services/ContactsService';
import { CreateContactDialog } from './CreateContactDialog';
import { ImportContactsDialog } from './ImportContactsDialog';
import { LeadsTableView } from './LeadsTableView';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { getIndustryCopy } from '@/lib/industry-copy';
import type { Contact } from '@/types/database';

const LEAD_NAV_KEY = 'flyr:leads:record-contact-ids';

/**
 * Owner/member CRM contacts hub.
 * Pure campaign & manual contact management for workspace owners and members.
 */
export function CrmContactsHub() {
  const router = useRouter();
  const { currentWorkspace, currentWorkspaceId } = useWorkspace();
  const copy = getIndustryCopy(currentWorkspace?.industry);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
  }, []);

  const loadContacts = useCallback(async () => {
    if (!userId || !currentWorkspaceId) return;
    setLoading(true);
    try {
      const data = await ContactsService.fetchContacts(userId, currentWorkspaceId);
      setContacts(data);
    } catch (err) {
      console.error('[CrmContactsHub] failed to load contacts', err);
    } finally {
      setLoading(false);
    }
  }, [userId, currentWorkspaceId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const filtered = search.trim()
    ? contacts.filter((c) => {
        const q = search.toLowerCase();
        return (
          (c.full_name ?? '').toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q) ||
          (c.address ?? '').toLowerCase().includes(q)
        );
      })
    : contacts;

  const allVisible = filtered.length > 0 && filtered.every((c) => selectedContactIds.includes(c.id));

  const handleContactSelect = (contact: Contact) => {
    window.sessionStorage.setItem(LEAD_NAV_KEY, JSON.stringify(filtered.map((c) => c.id)));
    router.push(`/leads/${contact.id}`);
  };

  const handleToggleContact = (contactId: string, checked: boolean) => {
    setSelectedContactIds((prev) =>
      checked ? [...prev, contactId] : prev.filter((id) => id !== contactId)
    );
  };

  const handleToggleAll = (checked: boolean) => {
    setSelectedContactIds(checked ? filtered.map((c) => c.id) : []);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">
              {copy.nouns.leadPlural}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Contacts from your campaigns and manual entries.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add {copy.nouns.lead}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <Input
            placeholder={`Search ${copy.nouns.leadPlural.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
      </section>

      {/* Contacts table */}
      <LeadsTableView
        contacts={filtered}
        callStats={null}
        loading={loading}
        onContactSelect={handleContactSelect}
        contactListLabelsById={{}}
        selectedContactIds={selectedContactIds}
        allVisibleSelected={allVisible}
        onToggleContactSelection={handleToggleContact}
        onToggleSelectAll={handleToggleAll}
        hasActiveFilter={search.trim().length > 0}
        copy={copy}
      />

      {userId && (
        <CreateContactDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            loadContacts();
          }}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
          copy={copy}
        />
      )}

      <ImportContactsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => {
          setImportOpen(false);
          loadContacts();
        }}
        workspaceId={currentWorkspaceId ?? undefined}
        copy={copy}
      />
    </div>
  );
}
