'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Tags,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ContactsService } from '@/lib/services/ContactsService';
import { useWorkspace } from '@/lib/workspace-context';
import { useDialerDevice } from '@/lib/hooks/useDialerDevice';
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
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
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

export function ContactDetailSheet({
  contact,
  contacts,
  open,
  onClose,
  onUpdate,
  onSelectContact,
}: {
  contact: Contact;
  contacts: Contact[];
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onSelectContact: (contact: Contact) => void;
}) {
  const { currentWorkspaceId } = useWorkspace();
  const device = useDialerDevice();
  const tabIdRef = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : `contact-dialer-${Date.now()}`);

  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [leadNotes, setLeadNotes] = useState(contact.notes ?? '');
  const [sourceValue, setSourceValue] = useState(contact.source ?? '');
  const [tagsValue, setTagsValue] = useState(contact.tags ?? '');
  const [lastContactedValue, setLastContactedValue] = useState(toDateTimeInputValue(contact.last_contacted));
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<'success' | 'error' | null>(null);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [disposition, setDisposition] = useState<DialerCallDisposition>('connected');
  const [dispositionNote, setDispositionNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [appointmentAt, setAppointmentAt] = useState('');

  const currentIndex = useMemo(
    () => contacts.findIndex((item) => item.id === contact.id),
    [contact.id, contacts]
  );
  const canGoNext = currentIndex >= 0 && currentIndex < contacts.length - 1;
  const canPushToCrm = Boolean(contact.email || contact.phone);

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

  const loadActivities = useCallback(async () => {
    setLoadingActivity(true);
    try {
      const data = await ContactsService.fetchActivities(contact.id);
      setActivities(data);
    } catch (error) {
      console.error('Error loading activities:', error);
      setActivities([]);
    } finally {
      setLoadingActivity(false);
    }
  }, [contact.id]);

  const resetDialerState = useCallback(() => {
    setSession(null);
    setLeads([]);
    setCalls([]);
    setSummary({
      total: 0,
      pending: 0,
      completed: 0,
      skipped: 0,
      invalid: 0,
      callsPlaced: 0,
      connected: 0,
    });
    setActiveLeadId(null);
    setActiveCallId(null);
    setDispositionOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setNoteDraft('');
    setLeadNotes(contact.notes ?? '');
    setSourceValue(contact.source ?? '');
    setTagsValue(contact.tags ?? '');
    setLastContactedValue(toDateTimeInputValue(contact.last_contacted));
    setPushResult(null);
    setPushMessage(null);
    setMessage(null);
    resetDialerState();
    void loadActivities();
  }, [contact.id, contact.last_contacted, contact.notes, contact.source, contact.tags, loadActivities, open, resetDialerState]);

  const saveContactPatch = useCallback(async (updates: Partial<Contact>) => {
    setSaving(true);
    try {
      await ContactsService.updateContact(contact.id, updates);
      onUpdate();
    } catch (error) {
      console.error('Error updating contact:', error);
      setMessage({ type: 'error', text: 'Unable to save that change right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact.id, onUpdate]);

  const handleLogActivity = useCallback(async (type: 'call' | 'note' | 'text' | 'email', note?: string) => {
    setSaving(true);
    try {
      await ContactsService.logActivity({
        contactId: contact.id,
        type,
        note,
      });
      await loadActivities();
      onUpdate();
    } catch (error) {
      console.error('Error logging activity:', error);
      setMessage({ type: 'error', text: 'Unable to save that activity right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact.id, loadActivities, onUpdate]);

  const applySessionResponse = useCallback((payload: SessionResponse) => {
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
      (payload.leads ?? []).find((lead) => lead.contact_id === contact.id) ??
      (payload.leads ?? []).find((lead) => lead.status === 'claimed' || lead.status === 'calling') ??
      (payload.leads ?? [])[0] ??
      null;
    setActiveLeadId(nextLead?.id ?? null);

    const nextCall =
      (payload.calls ?? []).find((call) => call.id === activeCallId) ??
      (payload.calls ?? []).find((call) => nextLead && call.session_lead_id === nextLead.id && !isFinalCallStatus(call.status)) ??
      null;
    setActiveCallId(nextCall?.id ?? null);
  }, [activeCallId, contact.id]);

  const refreshSession = useCallback(async (sessionId = session?.id) => {
    if (!currentWorkspaceId || !sessionId) return;
    setRefreshingSession(true);
    try {
      const response = await fetch(
        `/api/dialer/sessions?workspaceId=${encodeURIComponent(currentWorkspaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: 'include' }
      );
      const data = (await response.json().catch(() => ({}))) as SessionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh dialer status');
      }
      applySessionResponse(data);
    } catch (error) {
      console.error('[contact-detail] failed to refresh dialer session', error);
    } finally {
      setRefreshingSession(false);
    }
  }, [applySessionResponse, currentWorkspaceId, session?.id]);

  useEffect(() => {
    if (!open || !session?.id) return;
    const interval = window.setInterval(() => {
      void refreshSession(session.id);
    }, activeCall ? 2500 : 5000);
    return () => window.clearInterval(interval);
  }, [activeCall, open, refreshSession, session?.id]);

  useEffect(() => {
    if (!activeCall) return;
    setDisposition(activeCall.status === 'failed' ? 'bad_number' : 'connected');
    setDispositionNote('');
    setFollowUpAt(toDateTimeInputValue(activeCall.follow_up_at));
    setAppointmentAt(toDateTimeInputValue(activeCall.appointment_at));
  }, [activeCall]);

  useEffect(() => {
    if (!activeCallId || device.callPhase !== 'ended') return;
    setDispositionOpen(true);
    void refreshSession(session?.id);
  }, [activeCallId, device.callPhase, device.endedCount, refreshSession, session?.id]);

  const handleInitializeDevice = async () => {
    if (!currentWorkspaceId) return;
    setMessage(null);
    await device.initialize(currentWorkspaceId, tabIdRef.current);
  };

  const createSessionForCurrentContact = useCallback(async () => {
    if (!currentWorkspaceId) {
      throw new Error('Select a workspace before using the dialer.');
    }

    const createResponse = await fetch('/api/dialer/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        contactIds: [contact.id],
        tabId: tabIdRef.current,
        name: 'Lead workspace dialer',
      }),
    });
    const createData = (await createResponse.json().catch(() => ({}))) as SessionResponse & { error?: string };
    if (!createResponse.ok || !createData.session?.id) {
      throw new Error(createData.error || 'Failed to prepare a dialer session');
    }

    applySessionResponse(createData);

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
    await refreshSession(createData.session.id);
    return { sessionId: createData.session.id, lead: nextData.lead };
  }, [applySessionResponse, contact.id, currentWorkspaceId, refreshSession]);

  const handleCallCurrentPerson = useCallback(async () => {
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
          : await createSessionForCurrentContact();

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
      await refreshSession(prepared.sessionId);
      await device.startCall(data.call.call_request_id, {
        toNumber: data.call.to_number_e164,
        fromNumber: data.call.from_number_e164,
      });
    } catch (error) {
      console.error('[contact-detail] failed to place call', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to place the outbound call.',
      });
    } finally {
      setStartingCall(false);
    }
  }, [activeLead, contact.id, contact.phone, createSessionForCurrentContact, currentWorkspaceId, device, refreshSession, session?.id]);

  const handleSubmitDisposition = async () => {
    if (!currentWorkspaceId || !activeCall) return;

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

      setDispositionOpen(false);
      setActiveCallId(null);
      device.resetEndedPhase();
      await refreshSession(session?.id);
      onUpdate();
      if (canGoNext) {
        onSelectContact(contacts[currentIndex + 1]);
      }
    } catch (error) {
      console.error('[contact-detail] failed to submit disposition', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save the call outcome.',
      });
    } finally {
      setSubmittingDisposition(false);
    }
  };

  const handlePushToCrm = async () => {
    if (!canPushToCrm || pushLoading) return;
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
          message: leadNotes
            ? `WolfGrid lead: ${leadNotes}`
            : 'Lead from WolfGrid',
          source: 'WolfGrid',
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

  const handleGoNextPerson = () => {
    if (!canGoNext || device.isInCall) return;
    onSelectContact(contacts[currentIndex + 1]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="h-[92vh] w-[96vw] max-w-[1500px] overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{contact.full_name}</DialogTitle>
          <DialogDescription>Lead workspace with notes, activity, and a live dialer panel.</DialogDescription>
        </DialogHeader>

        <div className="flex h-full flex-col bg-background">
          <div className="border-b border-border px-6 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                  {getInitials(contact.full_name)}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">{contact.full_name}</h2>
                  <p className="text-sm text-muted-foreground">
                    Last communication {formatRelativeTime(contact.last_contacted)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 self-end lg:self-auto">
                <div className="text-sm font-medium text-muted-foreground">
                  Person {currentIndex >= 0 ? currentIndex + 1 : 1} of {contacts.length}
                </div>
                <Button variant="outline" onClick={handleGoNextPerson} disabled={!canGoNext || device.isInCall}>
                  Next Person
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
            <aside className="overflow-y-auto border-r border-border bg-muted/20 p-5">
              <div className="space-y-5">
                <Card>
                  <CardContent className="space-y-4 p-5">
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{contact.phone ? formatPhoneDisplay(contact.phone) : 'No phone added'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>{contact.email || 'No email added'}</span>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <span>{contact.address || 'No address added'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                        placeholder="Buyer, Import, Sphere..."
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

                    <div>
                      <Label htmlFor="lead-notes">Lead Notes</Label>
                      <Textarea
                        id="lead-notes"
                        value={leadNotes}
                        onChange={(event) => setLeadNotes(event.target.value)}
                        onBlur={() => {
                          const nextValue = leadNotes.trim();
                          if (nextValue === (contact.notes ?? '')) return;
                          void saveContactPatch({ notes: nextValue || undefined });
                        }}
                        placeholder="Internal notes for this lead..."
                        disabled={saving}
                        className="mt-2 min-h-[120px]"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">CRM Push</CardTitle>
                    <CardDescription>Send this lead into Follow Up Boss.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      className="w-full"
                      onClick={handlePushToCrm}
                      disabled={!canPushToCrm || pushLoading}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {pushLoading ? 'Pushing…' : 'Push to CRM'}
                    </Button>
                    {!canPushToCrm && (
                      <p className="text-xs text-muted-foreground">
                        Add an email or phone number first so this lead can be pushed.
                      </p>
                    )}
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
              </div>
            </aside>

            <main className="overflow-y-auto p-5">
              <div className="space-y-5">
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
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Create Note</CardTitle>
                    <CardDescription>Capture the next step or the outcome from your conversation.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      placeholder="Add notes for this lead..."
                      className="min-h-[150px]"
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
                        Save Note
                      </Button>
                      <Button variant="outline" onClick={() => void handleLogActivity('call')} disabled={saving}>
                        Log Call
                      </Button>
                      <Button variant="outline" onClick={() => void handleLogActivity('text')} disabled={saving}>
                        Log Text
                      </Button>
                      <Button variant="outline" onClick={() => void handleLogActivity('email')} disabled={saving}>
                        Log Email
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Activity Feed</CardTitle>
                    <CardDescription>Recent calls, notes, and touchpoints for this lead.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingActivity ? (
                      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading activity…
                      </div>
                    ) : activities.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                        No activity yet. Add a note or log a call to start the history.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activities.map((activity) => (
                          <div key={activity.id} className="rounded-xl border border-border bg-card/80 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold capitalize text-foreground">
                                  {activity.type}
                                </div>
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
              </div>
            </main>

            <aside className="overflow-y-auto border-l border-border bg-muted/10 p-5">
              <div className="space-y-5">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Dialer</CardTitle>
                    <CardDescription>Call this lead directly from the detail workspace.</CardDescription>
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

                    <div className="rounded-xl border p-4">
                      <div className="text-sm font-medium text-foreground">{contact.full_name}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {contact.phone ? formatPhoneDisplay(contact.phone) : 'No phone number on file'}
                      </div>
                      {contact.source && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                          <Tags className="h-3.5 w-3.5" />
                          {contact.source}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button onClick={handleInitializeDevice} disabled={!currentWorkspaceId || device.setupState === 'initializing'}>
                        {device.setupState === 'initializing' ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Mic className="mr-2 h-4 w-4" />
                        )}
                        Initialize Browser Dialer
                      </Button>

                      <Button
                        onClick={handleCallCurrentPerson}
                        disabled={!contact.phone?.trim() || !device.isReady || startingCall || device.isInCall}
                      >
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

                      <Button variant="outline" onClick={() => void refreshSession()} disabled={!session?.id || refreshingSession}>
                        {refreshingSession ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Refresh Dialer State
                      </Button>
                    </div>

                    {!device.microphoneGranted && device.setupState !== 'idle' && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        Allow microphone access in your browser before placing a call.
                      </div>
                    )}

                    {device.deviceError && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                        {device.deviceError}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Call Snapshot</CardTitle>
                    <CardDescription>Single-contact session progress for this workspace panel.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pending</div>
                        <div className="mt-1 text-lg font-semibold">{summary.pending}</div>
                      </div>
                      <div className="rounded-xl border p-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Calls</div>
                        <div className="mt-1 text-lg font-semibold">{summary.callsPlaced}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border p-4 text-sm">
                      <div className="font-medium text-foreground">Current lead</div>
                      <div className="mt-2 text-muted-foreground">
                        {activeLead?.contact?.full_name ?? contact.full_name}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {formatPhoneDisplay(activeLead?.contact?.phone ?? contact.phone)}
                      </div>
                    </div>

                    {device.tokenExpiresAt && (
                      <div className="text-xs text-muted-foreground">
                        Browser token refreshes automatically before {new Date(device.tokenExpiresAt).toLocaleTimeString()}.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </aside>
          </div>
        </div>

        <Dialog open={dispositionOpen} onOpenChange={setDispositionOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Save Call Outcome</DialogTitle>
              <DialogDescription>
                Update the result from this call, then move on to the next person if you want.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Outcome</Label>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                  {DIALER_DISPOSITION_LABELS[disposition]}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="call-note">Call note</Label>
                <Textarea
                  id="call-note"
                  value={dispositionNote}
                  onChange={(event) => setDispositionNote(event.target.value)}
                  placeholder="Capture the key takeaway from this conversation."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="call-follow-up">Follow up</Label>
                  <Input
                    id="call-follow-up"
                    type="datetime-local"
                    value={followUpAt}
                    onChange={(event) => setFollowUpAt(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="call-appointment">Appointment</Label>
                  <Input
                    id="call-appointment"
                    type="datetime-local"
                    value={appointmentAt}
                    onChange={(event) => setAppointmentAt(event.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDispositionOpen(false)} disabled={submittingDisposition}>
                Close
              </Button>
              <Button onClick={handleSubmitDisposition} disabled={submittingDisposition}>
                {submittingDisposition ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save and Continue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
