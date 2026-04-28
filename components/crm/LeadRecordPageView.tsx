'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  Upload,
  Users,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ContactsService } from '@/lib/services/ContactsService';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { useTwilioDevice } from '@/lib/hooks/useTwilioDevice';
import { DIALER_DISPOSITION_LABELS, formatDialerCallStatus, isFinalCallStatus } from '@/lib/dialer/constants';
import { formatPhoneDisplay } from '@/lib/dialer/phone';
import type { Contact, ContactActivity, DialerCall, DialerCallDisposition, DialerSession, DialerSessionLead } from '@/types/database';

type SessionSummary = {
  total: number;
  pending: number;
  completed: number;
  skipped: number;
  invalid: number;
  callsPlaced: number;
  connected: number;
};

type SessionResponse = {
  session: DialerSession | null;
  leads: DialerSessionLead[];
  calls: DialerCall[];
  summary: SessionSummary;
};

type NextLeadResponse = {
  lead: DialerSessionLead | null;
  activeCall: DialerCall | null;
  error?: string;
};

const LEAD_RECORD_NAV_STORAGE_KEY = 'flyr:leads:record-contact-ids';

function toDateTimeInputValue(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = (fullName || '').trim();
  const space = trimmed.indexOf(' ');
  if (space <= 0) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return 'No recent activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No recent activity';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function splitTags(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function EmptySidebarSection({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof Calendar;
  title: string;
  message: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full">
          <Plus className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export function LeadRecordPageView({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const device = useTwilioDevice();
  const tabIdRef = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : `lead-record-${Date.now()}`);

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [noteDraft, setNoteDraft] = useState('');
  const [leadNotes, setLeadNotes] = useState('');
  const [sourceValue, setSourceValue] = useState('');
  const [tagsValue, setTagsValue] = useState('');
  const [lastContactedValue, setLastContactedValue] = useState('');
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<'success' | 'error' | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const [session, setSession] = useState<DialerSession | null>(null);
  const [leads, setLeads] = useState<DialerSessionLead[]>([]);
  const [calls, setCalls] = useState<DialerCall[]>([]);
  const [summary, setSummary] = useState<SessionSummary>({
    total: 0,
    pending: 0,
    completed: 0,
    skipped: 0,
    invalid: 0,
    callsPlaced: 0,
    connected: 0,
  });
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [refreshingSession, setRefreshingSession] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [submittingDisposition, setSubmittingDisposition] = useState(false);
  const [disposition, setDisposition] = useState<DialerCallDisposition>('connected');
  const [dispositionNote, setDispositionNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [appointmentAt, setAppointmentAt] = useState('');

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(LEAD_RECORD_NAV_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setOrderedIds(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
      }
    } catch (error) {
      console.error('Unable to read lead record navigation state:', error);
    }
  }, []);

  const loadContacts = useCallback(async (currentUserId: string) => {
    if (!currentWorkspaceId) {
      setContacts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await ContactsService.fetchContacts(currentUserId, currentWorkspaceId);
      setContacts(data);
    } catch (error) {
      console.error('Error loading contacts:', error);
      setContacts([]);
      setMessage({ type: 'error', text: 'Unable to load this lead right now.' });
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
      if (user?.id) {
        void loadContacts(user.id);
      } else {
        setLoading(false);
      }
    });
  }, [loadContacts]);

  const orderedContacts = useMemo(() => {
    if (orderedIds.length === 0) return contacts;
    const byId = new Map(contacts.map((contact) => [contact.id, contact]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((contact): contact is Contact => Boolean(contact));
    const orderedSet = new Set(ordered.map((contact) => contact.id));
    const extras = contacts.filter((contact) => !orderedSet.has(contact.id));
    return [...ordered, ...extras];
  }, [contacts, orderedIds]);

  const contact = useMemo(
    () => orderedContacts.find((item) => item.id === contactId) ?? contacts.find((item) => item.id === contactId) ?? null,
    [contactId, contacts, orderedContacts]
  );

  const currentIndex = useMemo(
    () => orderedContacts.findIndex((item) => item.id === contactId),
    [contactId, orderedContacts]
  );
  const canGoNext = currentIndex >= 0 && currentIndex < orderedContacts.length - 1;

  const activeLead =
    leads.find((lead) => lead.id === activeLeadId) ??
    leads.find((lead) => lead.status === 'claimed' || lead.status === 'calling') ??
    null;
  const activeCall =
    calls.find((call) => call.id === activeCallId) ??
    calls.find((call) => activeLead && call.session_lead_id === activeLead.id && !isFinalCallStatus(call.status)) ??
    null;

  const deviceStatusLabel =
    device.setupState === 'ready'
      ? 'Ready'
      : device.setupState === 'initializing'
        ? 'Initializing'
        : device.setupState === 'error'
          ? 'Needs attention'
          : 'Not initialized';
  const callStatusLabel = activeCall
    ? formatDialerCallStatus(activeCall.status)
    : device.callPhase === 'connecting'
      ? 'Connecting'
      : device.callPhase === 'connected'
        ? 'Connected'
        : 'Idle';

  const loadActivities = useCallback(async (currentContactId: string) => {
    setLoadingActivity(true);
    try {
      const data = await ContactsService.fetchActivities(currentContactId);
      setActivities(data);
    } catch (error) {
      console.error('Error loading activities:', error);
      setActivities([]);
    } finally {
      setLoadingActivity(false);
    }
  }, []);

  useEffect(() => {
    if (!contact) return;
    setNoteDraft('');
    setLeadNotes(contact.notes ?? '');
    setSourceValue(contact.source ?? '');
    setTagsValue(contact.tags ?? '');
    setLastContactedValue(toDateTimeInputValue(contact.last_contacted));
    setPushResult(null);
    setPushMessage(null);
    setMessage(null);
    void loadActivities(contact.id);
  }, [contact, loadActivities]);

  const applySessionResponse = useCallback((payload: SessionResponse, currentContactId: string) => {
    setSession(payload.session);
    setLeads(payload.leads ?? []);
    setCalls(payload.calls ?? []);
    setSummary(
      payload.summary ?? {
        total: 0,
        pending: 0,
        completed: 0,
        skipped: 0,
        invalid: 0,
        callsPlaced: 0,
        connected: 0,
      }
    );

    const nextLead =
      (payload.leads ?? []).find((lead) => lead.contact_id === currentContactId) ??
      (payload.leads ?? []).find((lead) => lead.status === 'claimed' || lead.status === 'calling') ??
      (payload.leads ?? [])[0] ??
      null;
    setActiveLeadId(nextLead?.id ?? null);

    const nextCall =
      (payload.calls ?? []).find((call) => nextLead && call.session_lead_id === nextLead.id && !isFinalCallStatus(call.status)) ??
      null;
    setActiveCallId(nextCall?.id ?? null);
  }, []);

  const refreshSession = useCallback(async (currentContactId: string, sessionId = session?.id) => {
    if (!currentWorkspaceId || !sessionId) return;
    setRefreshingSession(true);
    try {
      const response = await fetch(
        `/api/dialer/sessions?workspaceId=${encodeURIComponent(currentWorkspaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: 'include' }
      );
      const data = (await response.json().catch(() => ({}))) as SessionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh dialer state');
      }
      applySessionResponse(data, currentContactId);
    } catch (error) {
      console.error('[lead-record] failed to refresh dialer state', error);
    } finally {
      setRefreshingSession(false);
    }
  }, [applySessionResponse, currentWorkspaceId, session?.id]);

  useEffect(() => {
    if (!contact || !session?.id) return;
    const interval = window.setInterval(() => {
      void refreshSession(contact.id, session.id);
    }, activeCall ? 2500 : 5000);
    return () => window.clearInterval(interval);
  }, [activeCall, contact, refreshSession, session?.id]);

  useEffect(() => {
    if (!activeCall) return;
    setDisposition(activeCall.status === 'failed' ? 'bad_number' : 'connected');
    setDispositionNote('');
    setFollowUpAt(toDateTimeInputValue(activeCall.follow_up_at));
    setAppointmentAt(toDateTimeInputValue(activeCall.appointment_at));
  }, [activeCall]);

  const saveContactPatch = useCallback(async (updates: Partial<Contact>) => {
    if (!contact || !userId) return;
    setSaving(true);
    try {
      await ContactsService.updateContact(contact.id, updates);
      await loadContacts(userId);
    } catch (error) {
      console.error('Error updating contact:', error);
      setMessage({ type: 'error', text: 'Unable to save that change right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact, loadContacts, userId]);

  const handleLogActivity = useCallback(async (type: 'call' | 'note' | 'text' | 'email', note?: string) => {
    if (!contact || !userId) return;
    setSaving(true);
    try {
      await ContactsService.logActivity({
        contactId: contact.id,
        type,
        note,
      });
      await Promise.all([loadActivities(contact.id), loadContacts(userId)]);
    } catch (error) {
      console.error('Error logging activity:', error);
      setMessage({ type: 'error', text: 'Unable to save that activity right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact, loadActivities, loadContacts, userId]);

  const createSessionForCurrentContact = useCallback(async (currentContact: Contact) => {
    if (!currentWorkspaceId) {
      throw new Error('Select a workspace before using the dialer.');
    }

    const createResponse = await fetch('/api/dialer/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        contactIds: [currentContact.id],
        tabId: tabIdRef.current,
        name: 'Lead workspace dialer',
      }),
    });
    const createData = (await createResponse.json().catch(() => ({}))) as SessionResponse & { error?: string };
    if (!createResponse.ok || !createData.session?.id) {
      throw new Error(createData.error || 'Failed to prepare a dialer session');
    }

    applySessionResponse(createData, currentContact.id);

    const nextResponse = await fetch(`/api/dialer/sessions/${createData.session.id}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ workspaceId: currentWorkspaceId }),
    });
    const nextData = (await nextResponse.json().catch(() => ({}))) as NextLeadResponse;
    if (!nextResponse.ok || !nextData.lead) {
      throw new Error(nextData.error || 'Failed to select the current lead for calling');
    }

    setActiveLeadId(nextData.lead.id);
    setActiveCallId(nextData.activeCall?.id ?? null);
    await refreshSession(currentContact.id, createData.session.id);
    return { sessionId: createData.session.id, lead: nextData.lead };
  }, [applySessionResponse, currentWorkspaceId, refreshSession]);

  const handleCallCurrentPerson = useCallback(async () => {
    if (!contact) return;
    if (!device.isReady) {
      setMessage({ type: 'error', text: 'Initialize the browser dialer before placing a call.' });
      return;
    }
    if (!contact.phone?.trim()) {
      setMessage({ type: 'error', text: 'This lead needs a phone number before you can call them.' });
      return;
    }

    setStartingCall(true);
    setMessage(null);
    try {
      const prepared =
        session?.id && activeLead?.contact_id === contact.id
          ? { sessionId: session.id, lead: activeLead }
          : await createSessionForCurrentContact(contact);

      const response = await fetch('/api/dialer/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          sessionId: prepared.sessionId,
          sessionLeadId: prepared.lead.id,
          contactId: prepared.lead.contact_id,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { call?: DialerCall; error?: string };
      if (!response.ok || !data.call) {
        throw new Error(data.error || 'Failed to place the outbound call');
      }

      setActiveCallId(data.call.id);
      await refreshSession(contact.id, prepared.sessionId);
      await device.startCall(data.call.call_request_id);
    } catch (error) {
      console.error('[lead-record] failed to place call', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to place the outbound call.',
      });
    } finally {
      setStartingCall(false);
    }
  }, [activeLead, contact, createSessionForCurrentContact, currentWorkspaceId, device, refreshSession, session?.id]);

  const handleSubmitDisposition = async () => {
    if (!contact || !currentWorkspaceId || !activeCall) return;

    setSubmittingDisposition(true);
    try {
      const response = await fetch(`/api/dialer/calls/${activeCall.id}/disposition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          disposition,
          note: dispositionNote,
          followUpAt: toIsoOrNull(followUpAt),
          appointmentAt: toIsoOrNull(appointmentAt),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save the call outcome');
      }

      device.resetEndedPhase();
      setActiveCallId(null);
      await Promise.all([refreshSession(contact.id, session?.id), loadContacts(userId ?? '')]);
      if (canGoNext) {
        router.push(`/leads/${orderedContacts[currentIndex + 1].id}`);
      } else {
        setMessage({ type: 'success', text: 'Call outcome saved.' });
      }
    } catch (error) {
      console.error('[lead-record] failed to submit disposition', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save the call outcome.',
      });
    } finally {
      setSubmittingDisposition(false);
    }
  };

  const handlePushToCrm = async () => {
    if (!contact || !(contact.email || contact.phone) || pushLoading) return;

    setPushLoading(true);
    setPushResult(null);
    setPushMessage(null);
    try {
      const { firstName, lastName } = splitFullName(contact.full_name);
      const res = await fetch('/api/integrations/followupboss/push-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          address: contact.address || undefined,
          message: leadNotes ? `FLYR lead: ${leadNotes}` : 'Lead from FLYR',
          source: 'FLYR',
          campaignId: contact.campaign_id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPushResult('success');
        setPushMessage(data?.message ?? 'Pushed to Follow Up Boss');
      } else {
        setPushResult('error');
        setPushMessage(data?.error ?? 'Failed to push to CRM');
      }
    } catch (error) {
      console.error('Push to CRM error:', error);
      setPushResult('error');
      setPushMessage('Failed to push to CRM');
    } finally {
      setPushLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading lead…
        </div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <Card>
            <CardHeader>
              <CardTitle>Lead Not Found</CardTitle>
              <CardDescription>This lead could not be loaded in the current workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/leads">Back to Leads</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white/95 backdrop-blur dark:bg-card/95">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-sm text-muted-foreground">
                <Link href="/leads" className="hover:text-foreground">
                  Leads
                </Link>
                <span className="mx-2">/</span>
                <span>{contact.full_name}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-foreground">{contact.full_name}</h1>
              <p className="text-sm text-muted-foreground">
                Last communication {formatRelativeTime(contact.last_contacted)}
              </p>
            </div>

            <div className="flex items-center gap-3 self-end xl:self-auto">
              <div className="text-sm font-medium text-muted-foreground">
                Person {currentIndex >= 0 ? currentIndex + 1 : 1} of {orderedContacts.length}
              </div>
              <Button variant="outline" onClick={() => router.push('/leads')}>
                Back to Leads
              </Button>
              <Button variant="outline" onClick={() => canGoNext && router.push(`/leads/${orderedContacts[currentIndex + 1].id}`)} disabled={!canGoNext || device.isInCall}>
                Next Person
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
                    {getInitials(contact.full_name)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-2xl font-semibold text-foreground">{contact.full_name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Last communication {formatRelativeTime(contact.last_contacted)}
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-4 text-sm">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{contact.phone ? formatPhoneDisplay(contact.phone) : 'Add phone'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{contact.email || 'Add email'}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <span>{contact.address || 'No address on file'}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label>Status</Label>
                  <div className="mt-2">
                    <Badge variant="outline" className="capitalize">
                      {contact.status}
                    </Badge>
                  </div>
                </div>

                <div>
                  <Label htmlFor="lead-source">Source</Label>
                  <Input
                    id="lead-source"
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                    onBlur={() => {
                      const nextValue = sourceValue.trim();
                      if (nextValue === (contact.source ?? '')) return;
                      void saveContactPatch({ source: nextValue || undefined });
                    }}
                    placeholder="Referral, Website, Open house..."
                    disabled={saving}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="lead-tags">Tags</Label>
                  <Input
                    id="lead-tags"
                    value={tagsValue}
                    onChange={(event) => setTagsValue(event.target.value)}
                    onBlur={() => {
                      const nextValue = tagsValue.trim();
                      if (nextValue === (contact.tags ?? '')) return;
                      void saveContactPatch({ tags: nextValue || undefined });
                    }}
                    placeholder="Buyer, Import, London Team..."
                    disabled={saving}
                    className="mt-2"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {splitTags(tagsValue).map((tag) => (
                      <Badge key={tag} variant="secondary" className="rounded-full">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="lead-last-contacted">Last Contacted</Label>
                  <Input
                    id="lead-last-contacted"
                    type="datetime-local"
                    value={lastContactedValue}
                    onChange={(event) => setLastContactedValue(event.target.value)}
                    onBlur={() => {
                      if (lastContactedValue === toDateTimeInputValue(contact.last_contacted)) return;
                      void saveContactPatch({ last_contacted: toIsoOrUndefined(lastContactedValue) });
                    }}
                    disabled={saving}
                    className="mt-2"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={leadNotes}
                  onChange={(event) => setLeadNotes(event.target.value)}
                  onBlur={() => {
                    const nextValue = leadNotes.trim();
                    if (nextValue === (contact.notes ?? '')) return;
                    void saveContactPatch({ notes: nextValue || undefined });
                  }}
                  placeholder="Internal notes for this lead..."
                  className="min-h-[150px]"
                  disabled={saving}
                />
              </CardContent>
            </Card>
          </aside>

          <section className="space-y-6">
            {message && (
              <div
                className={`rounded-lg border px-4 py-3 text-sm ${
                  message.type === 'success'
                    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                }`}
              >
                {message.text}
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Create Note</CardTitle>
                <CardDescription>Add notes, log a call, or capture the next action for this person.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Add notes or type @name to notify"
                  className="min-h-[170px]"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={async () => {
                      if (!noteDraft.trim()) return;
                      await handleLogActivity('note', noteDraft.trim());
                      setNoteDraft('');
                    }}
                    disabled={saving || !noteDraft.trim()}
                  >
                    Create Note
                  </Button>
                  <Button variant="outline" onClick={() => void handleLogActivity('email')} disabled={saving}>
                    Send Email
                  </Button>
                  <Button variant="outline" onClick={() => void handleLogActivity('text')} disabled={saving}>
                    Text
                  </Button>
                  <Button variant="outline" onClick={() => void handleLogActivity('call')} disabled={saving}>
                    Log Call
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Activity Timeline</CardTitle>
                  <CardDescription>Recent touches, notes, and communication history.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadActivities(contact.id)} disabled={loadingActivity}>
                  {loadingActivity ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                </Button>
              </CardHeader>
              <CardContent>
                {loadingActivity ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading activity…
                  </div>
                ) : activities.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                    No activity yet. Create a note or log a call to get started.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activities.map((activity) => (
                      <div key={activity.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold capitalize text-foreground">{activity.type}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatDateTime(activity.timestamp)}
                            </div>
                          </div>
                          <Badge variant="outline" className="capitalize">
                            {activity.type}
                          </Badge>
                        </div>
                        {activity.note && (
                          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">
                            {activity.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <aside className="space-y-6">
            <div className="px-1 text-right text-sm font-medium text-muted-foreground">
              Person {currentIndex >= 0 ? currentIndex + 1 : 1} of {orderedContacts.length}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Dialer</CardTitle>
                <CardDescription>Put the call controls in reach while you review the lead.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Device</div>
                    <div className="mt-1 text-sm font-semibold">{deviceStatusLabel}</div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Call</div>
                    <div className="mt-1 text-sm font-semibold">{callStatusLabel}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pending</div>
                    <div className="mt-1 text-sm font-semibold">{summary.pending}</div>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Calls</div>
                    <div className="mt-1 text-sm font-semibold">{summary.callsPlaced}</div>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-sm font-medium text-foreground">{contact.full_name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {contact.phone ? formatPhoneDisplay(contact.phone) : 'No phone number on file'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {contact.source ? <Badge variant="outline">{contact.source}</Badge> : null}
                    {splitTags(contact.tags).slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button onClick={async () => {
                    setMessage(null);
                    await device.initialize(currentWorkspaceId ?? '', tabIdRef.current);
                  }} disabled={!currentWorkspaceId || device.setupState === 'initializing'}>
                    {device.setupState === 'initializing' ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    Initialize Browser Dialer
                  </Button>

                  <Button onClick={handleCallCurrentPerson} disabled={!contact.phone?.trim() || !device.isReady || startingCall || device.isInCall}>
                    {startingCall ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Phone className="mr-2 h-4 w-4" />
                    )}
                    Call Current Person
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={device.toggleMute} disabled={!device.isInCall}>
                      {device.isMuted ? (
                        <MicOff className="mr-2 h-4 w-4" />
                      ) : (
                        <Mic className="mr-2 h-4 w-4" />
                      )}
                      {device.isMuted ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button variant="destructive" onClick={device.hangUp} disabled={!device.isInCall}>
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Hang Up
                    </Button>
                  </div>

                  <Button variant="outline" onClick={() => void refreshSession(contact.id)} disabled={!session?.id || refreshingSession}>
                    {refreshingSession ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Refresh Dialer
                  </Button>
                </div>

                {device.deviceError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    {device.deviceError}
                  </div>
                )}

                {activeCall && (
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-medium text-foreground">Save Call Outcome</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Current outcome: {DIALER_DISPOSITION_LABELS[disposition]}
                    </div>
                    <Textarea
                      value={dispositionNote}
                      onChange={(event) => setDispositionNote(event.target.value)}
                      placeholder="Add call notes..."
                      className="mt-3 min-h-[100px]"
                    />
                    <div className="mt-3 grid gap-3">
                      <Input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} />
                      <Input type="datetime-local" value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} />
                    </div>
                    <Button className="mt-3 w-full" onClick={handleSubmitDisposition} disabled={submittingDisposition}>
                      {submittingDisposition ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save and Continue
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <EmptySidebarSection icon={Calendar} title="Appointments" message="No upcoming appointments" />
            <EmptySidebarSection icon={FileText} title="Files" message="No files yet" />
            <EmptySidebarSection icon={Users} title="Collaborators" message="No collaborators" />
            <EmptySidebarSection icon={Workflow} title="Action Plans" message="No action plans running" />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">CRM Sync</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" onClick={handlePushToCrm} disabled={!(contact.email || contact.phone) || pushLoading}>
                  <Upload className="mr-2 h-4 w-4" />
                  {pushLoading ? 'Pushing…' : 'Push to CRM'}
                </Button>
                {pushResult === 'success' && pushMessage && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    {pushMessage}
                  </div>
                )}
                {pushResult === 'error' && pushMessage && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {pushMessage}
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
