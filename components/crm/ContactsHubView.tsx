'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock3, MapPin, Plus, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LeadsTableView } from './LeadsTableView';
import { ContactDetailSheet } from './ContactDetailSheet';
import { CreateContactDialog } from './CreateContactDialog';
import { ContactsService, type AddressStatusLead } from '@/lib/services/ContactsService';
import { StatsService } from '@/lib/services/StatsService';
import type { Contact, UserStats } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';

function formatAddressShort(address: string | null | undefined): string {
  if (!address?.trim()) return '—';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ') || '—';
}

function formatReminderDate(reminderDate: string | undefined): string {
  if (!reminderDate) return '—';
  const d = new Date(reminderDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function AddressStatusLeadsTable({
  rows,
  loading,
  emptyMessage,
}: {
  rows: AddressStatusLead[];
  loading: boolean;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">{emptyMessage}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scans</TableHead>
              <TableHead>Visited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{formatAddressShort(row.address)}</TableCell>
                <TableCell className="text-muted-foreground">{row.campaign_name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{row.address_status || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{row.scans ?? 0}</TableCell>
                <TableCell className="text-muted-foreground">{row.visited ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function ContactsHubView({
  view = 'leads',
}: {
  view?: 'leads' | 'appointments' | 'follow-up';
}) {
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [appointmentAddresses, setAppointmentAddresses] = useState<AddressStatusLead[]>([]);
  const [followUpAddresses, setFollowUpAddresses] = useState<AddressStatusLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState<Date | undefined>(new Date());
  /** When true, show all workspace members' leads; when false, only current user's leads */
  const [showTeamLeads, setShowTeamLeads] = useState(false);
  const currentWorkspaceRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canIncludeMembers = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin';

  useEffect(() => {
    if (!canIncludeMembers && showTeamLeads) {
      setShowTeamLeads(false);
    }
  }, [canIncludeMembers, showTeamLeads]);

  const reminderContacts = useMemo(() => {
    return contacts
      .filter((c) => !!c.reminder_date)
      .sort((a, b) => {
        const aTime = a.reminder_date ? new Date(a.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.reminder_date ? new Date(b.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
  }, [contacts]);

  const appointmentDayEntries = useMemo(() => {
    const counts = new Map<string, number>();
    appointmentAddresses.forEach((row) => {
      const parsed = parseDateOrNull(row.status_updated_at);
      if (!parsed) return;
      const key = toDayKey(parsed);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([key, count]) => {
        const [yy, mm, dd] = key.split('-').map(Number);
        return { key, date: new Date(yy, mm - 1, dd), count };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [appointmentAddresses]);

  const appointmentCalendarDays = useMemo(
    () => appointmentDayEntries.map((entry) => entry.date),
    [appointmentDayEntries]
  );

  useEffect(() => {
    if (appointmentDayEntries.length === 0) return;
    if (!selectedAppointmentDate) {
      setSelectedAppointmentDate(appointmentDayEntries[appointmentDayEntries.length - 1].date);
      return;
    }
    const selectedKey = toDayKey(selectedAppointmentDate);
    const hasSelected = appointmentDayEntries.some((entry) => entry.key === selectedKey);
    if (!hasSelected && view === 'appointments') {
      setSelectedAppointmentDate(appointmentDayEntries[appointmentDayEntries.length - 1].date);
    }
  }, [appointmentDayEntries, selectedAppointmentDate, view]);

  const appointmentsForSelectedDay = useMemo(() => {
    if (!selectedAppointmentDate) return [];
    const selectedMonthKey = toMonthKey(selectedAppointmentDate);
    return appointmentAddresses
      .filter((row) => {
        const parsed = parseDateOrNull(row.status_updated_at);
        return parsed ? toMonthKey(parsed) === selectedMonthKey : false;
      })
      .sort((a, b) => (b.scans ?? 0) - (a.scans ?? 0));
  }, [appointmentAddresses, selectedAppointmentDate]);

  const selectedMonthLabel = useMemo(() => {
    if (!selectedAppointmentDate) return 'Selected Month';
    return selectedAppointmentDate.toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }, [selectedAppointmentDate]);

  const load = useCallback(
    async (currentUserId: string) => {
      try {
        setLoading(true);
        const scope = canIncludeMembers && showTeamLeads ? 'team' : 'mine';
        const [contactsData, statsData, appointmentsData, followUpsData] = await Promise.all([
          ContactsService.fetchContacts(currentUserId, currentWorkspaceId, { scope }),
          StatsService.fetchUserStats(currentUserId),
          ContactsService.fetchAddressStatusLeads(currentUserId, currentWorkspaceId, {
            scope,
            statuses: ['appointment'],
          }),
          ContactsService.fetchAddressStatusLeads(currentUserId, currentWorkspaceId, {
            scope,
            statuses: ['future_seller'],
          }),
        ]);
        setContacts(contactsData);
        setUserStats(statsData ?? null);
        setAppointmentAddresses(appointmentsData);
        setFollowUpAddresses(followUpsData);
      } catch (error) {
        console.error('Error loading contacts or stats:', error);
      } finally {
        setLoading(false);
      }
    },
    [canIncludeMembers, currentWorkspaceId, showTeamLeads]
  );

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
      if (user?.id) {
        load(user.id);
      } else {
        setLoading(false);
      }
    });
  }, [load]);

  const loadContacts = useCallback(() => {
    if (userId) load(userId);
  }, [userId, load]);

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
      <div className="-mx-4 sticky top-[var(--page-sticky-offset,0px)] z-20 mb-6 border-b border-border bg-gray-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Switch
              id="show-team-leads"
              checked={showTeamLeads}
              onCheckedChange={setShowTeamLeads}
              disabled={loading || !currentWorkspaceId || !canIncludeMembers}
            />
            <Label htmlFor="show-team-leads" className="text-sm font-medium cursor-pointer flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              Include other members&apos; leads
            </Label>
          </div>
          <div className="flex gap-2">
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
              {view === 'appointments' ? 'Add Appointment' : 'Add Contact'}
            </Button>
          </div>
        </div>
      </div>

      {view === 'leads' && (
        <>
          <LeadsTableView
            contacts={contacts}
            userStats={userStats}
            loading={loading}
            onContactSelect={setSelectedContact}
          />
        </>
      )}

      {view === 'appointments' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4" />
            House-level appointments synced from iOS address status.
          </div>
          <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="rounded-xl border border-border bg-card p-2">
              <Calendar
                mode="single"
                selected={selectedAppointmentDate}
                onSelect={setSelectedAppointmentDate}
                modifiers={{ hasAppointments: appointmentCalendarDays }}
                modifiersClassNames={{
                  hasAppointments: 'bg-primary/10 text-primary font-semibold',
                }}
                className="w-full"
              />
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {`Appointments for ${selectedMonthLabel}`}
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {appointmentsForSelectedDay.length}
                </Badge>
              </div>

              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : appointmentsForSelectedDay.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No appointments this month.
                </div>
              ) : (
                <div className="space-y-3">
                  {appointmentsForSelectedDay.map((row) => {
                    const updatedAt = parseDateOrNull(row.status_updated_at);
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-background p-3">
                        <p className="font-medium text-foreground">{formatAddressShort(row.address)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{row.campaign_name || 'Campaign'}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>Scans: {row.scans ?? 0}</span>
                          <span>Visited: {row.visited ? 'Yes' : 'No'}</span>
                          <span>Set: {updatedAt ? updatedAt.toLocaleString() : '—'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'follow-up' && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4" />
              House follow-ups from iOS address status (`future_seller`).
            </div>
            <AddressStatusLeadsTable
              rows={followUpAddresses}
              loading={loading}
              emptyMessage="No address follow-ups found."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="w-4 h-4" />
              Contact reminders from iOS `reminder_date`.
            </div>
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">Loading…</div>
              ) : reminderContacts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No contact reminders set.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Reminder</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reminderContacts.map((contact) => (
                      <TableRow
                        key={contact.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedContact(contact)}
                      >
                        <TableCell className="font-medium">{contact.full_name}</TableCell>
                        <TableCell className="text-muted-foreground">{formatAddressShort(contact.address)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatReminderDate(contact.reminder_date)}</TableCell>
                        <TableCell className="text-muted-foreground">{contact.phone || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
      )}

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
