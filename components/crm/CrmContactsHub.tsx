'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContactsService } from '@/lib/services/ContactsService';
import { CreateContactDialog } from './CreateContactDialog';
import { ImportContactsDialog } from './ImportContactsDialog';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { getIndustryCopy } from '@/lib/industry-copy';
import type { Contact } from '@/types/database';

const LEAD_NAV_KEY = 'flyr:leads:record-contact-ids';
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'az', label: 'A–Z' },
  { value: 'za', label: 'Z–A' },
  { value: 'oldest', label: 'Oldest' },
] as const;
type LeadSort = (typeof SORT_OPTIONS)[number]['value'];

function createdTime(contact: Contact) {
  return Date.parse(contact.created_at) || 0;
}

function leadName(contact: Contact) {
  return contact.full_name?.trim() || 'Unnamed contact';
}

function initials(name: string) {
  const parts = name.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

function dateLabel(contact: Contact) {
  const date = new Date(contact.created_at);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

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
  const [sort, setSort] = useState<LeadSort>('newest');
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

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matches = contacts.filter((contact) =>
      [contact.full_name, contact.email, contact.phone, contact.address].some((value) =>
        (value ?? '').toLocaleLowerCase().includes(query)
      )
    );
    return matches.sort((a, b) => {
      if (sort === 'az' || sort === 'za') {
        const order = leadName(a).localeCompare(leadName(b), undefined, { sensitivity: 'base', numeric: true });
        return (sort === 'az' ? order : -order) || createdTime(b) - createdTime(a) || a.id.localeCompare(b.id);
      }
      const order = createdTime(a) - createdTime(b);
      return (sort === 'oldest' ? order : -order) || a.id.localeCompare(b.id);
    });
  }, [contacts, search, sort]);

  const groups = useMemo(() => {
    const result: { label: string; contacts: Contact[] }[] = [];
    for (const contact of filtered) {
      const label = sort === 'az' || sort === 'za'
        ? leadName(contact).charAt(0).toLocaleUpperCase()
        : dateLabel(contact);
      const last = result[result.length - 1];
      if (last?.label === label) last.contacts.push(contact);
      else result.push({ label, contacts: [contact] });
    }
    return result;
  }, [filtered, sort]);

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
    <div className="min-h-screen w-full bg-gray-50 text-slate-900 dark:bg-background dark:text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold capitalize text-foreground">
                {copy.nouns.leadPlural}
              </h1>
              <p className="mt-1 text-muted-foreground">
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
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="relative w-full sm:max-w-sm">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={`Search ${copy.nouns.leadPlural.toLowerCase()}`}
              placeholder={`Search ${copy.nouns.leadPlural.toLowerCase()}…`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-card pl-9"
            />
          </div>
          <div role="group" aria-label="Sort leads" className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">Sort:</span>
            {SORT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={sort === option.value ? 'default' : 'outline'}
                className={sort === option.value ? 'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200' : undefined}
                aria-pressed={sort === option.value}
                onClick={() => setSort(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <section aria-label={copy.nouns.leadPlural} aria-busy={loading} className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">{copy.leads.loading}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search.trim() ? 'No matching contacts. Try another name, email, phone, or address.' : 'No leads yet. Add a contact or import a list to get started.'}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 border-b border-border px-4 py-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={copy.leads.selectAllAria}
                  checked={allVisible}
                  onChange={(event) => handleToggleAll(event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-primary"
                />
                <span aria-live="polite">{filtered.length} {copy.nouns.leadPlural.toLowerCase()}{selectedContactIds.length > 0 ? ` · ${selectedContactIds.length} selected` : ''}</span>
              </div>
              {groups.map((group, groupIndex) => (
                <div key={`${group.label}-${groupIndex}`}>
                  <h2 className="bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-700 dark:bg-muted/40 dark:text-foreground">
                    {group.label} ({group.contacts.length})
                  </h2>
                  <ul className="divide-y divide-slate-100 dark:divide-border/60">
                    {group.contacts.map((contact) => {
                      const name = leadName(contact);
                      const hue = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
                      return (
                        <li key={contact.id} className="flex items-center gap-4 px-4 hover:bg-muted/30">
                          <input
                            type="checkbox"
                            aria-label={`Select ${name}`}
                            checked={selectedContactIds.includes(contact.id)}
                            onChange={(event) => handleToggleContact(contact.id, event.target.checked)}
                            className="h-5 w-5 shrink-0 accent-primary"
                          />
                          <button
                            type="button"
                            onClick={() => handleContactSelect(contact)}
                            className="flex min-w-0 flex-1 items-center gap-4 rounded-md py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: `hsl(${hue}, 40%, 44%)` }}>
                              {initials(name)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-red-600 dark:text-red-400">{name}</span>
                              <span className="mt-0.5 block truncate text-sm text-slate-700 dark:text-muted-foreground">{contact.address || contact.email || contact.phone || 'No contact details yet'}</span>
                              {(contact.address && (contact.email || contact.phone)) && (
                                <span className="mt-1 block truncate text-xs text-muted-foreground">{[contact.phone, contact.email].filter(Boolean).join(' · ')}</span>
                              )}
                            </span>
                            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>
      </div>

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
