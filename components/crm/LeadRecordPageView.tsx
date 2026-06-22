'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  Mic,
  MicOff,
  MessageSquare,
  Pencil,
  Phone,
  PhoneOff,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContactsService } from '@/lib/services/ContactsService';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { useDialerDevice } from '@/lib/hooks/useDialerDevice';
import { DIALER_DISPOSITION_LABELS, formatDialerCallStatus, isFinalCallStatus } from '@/lib/dialer/constants';
import { formatPhoneDisplay, normalizePhoneNumber } from '@/lib/dialer/phone';
import type { Contact, ContactActivity, DialerCall, DialerCallDisposition, DialerInboundMessage, DialerSession, DialerSessionLead } from '@/types/database';

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

type ComposerMode = 'note' | 'text' | 'email';
type ContactDraft = {
  full_name: string;
  phone: string;
  email: string;
  address: string;
};

type CommunicationItem = {
  id: string;
  kind: 'note' | 'message' | 'call';
  title: string;
  body?: string;
  meta: string;
  timestamp: string;
};

const LEAD_RECORD_NAV_STORAGE_KEY = 'flyr:leads:record-contact-ids';

function toDateTimeInputValue(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function formatDuration(seconds?: number | null): string {
  const totalSeconds = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(remainder).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return `${hours}h ${minuteRemainder}m`;
}

export function LeadRecordPageView({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const device = useDialerDevice();
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
  const [emailSubject, setEmailSubject] = useState('');
  const [editingContact, setEditingContact] = useState(false);
  const [generatingDemoLink, setGeneratingDemoLink] = useState(false);
  const [manualDemoOpen, setManualDemoOpen] = useState(false);
  const [manualDemoCompany, setManualDemoCompany] = useState('');
  const [manualDemoCity, setManualDemoCity] = useState('');
  const [contactDraft, setContactDraft] = useState<ContactDraft>({
    full_name: '',
    phone: '',
    email: '',
    address: '',
  });
  const [composerMode, setComposerMode] = useState<ComposerMode>('note');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [sendingOutbound, setSendingOutbound] = useState(false);
  const [contactCalls, setContactCalls] = useState<DialerCall[]>([]);
  const [inboundMessages, setInboundMessages] = useState<DialerInboundMessage[]>([]);

  const [session, setSession] = useState<DialerSession | null>(null);
  const [leads, setLeads] = useState<DialerSessionLead[]>([]);
  const [calls, setCalls] = useState<DialerCall[]>([]);
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

  const communicationItems = useMemo<CommunicationItem[]>(() => {
    const contactName = contact?.full_name?.trim() || 'Lead';
    const cleanCommunicationBody = (value?: string | null) =>
      (value ?? '')
        .replace(/^Inbound SMS:\s*/i, '')
        .replace(/^Outbound SMS:\s*/i, '')
        .replace(/^Outbound email:\s*/i, '')
        .trim();

    const inboundTextBodies = new Set(
      inboundMessages.map((item) => item.body.trim()).filter(Boolean)
    );

    const activityItems = activities
      .filter((activity) => {
        if (activity.type === 'text' && activity.note?.startsWith('Inbound SMS:')) {
          const body = activity.note.replace(/^Inbound SMS:\s*/i, '').trim();
          return !inboundTextBodies.has(body);
        }
        return true;
      })
      .map<CommunicationItem>((activity) => {
        const isMessage = activity.type === 'text' || activity.type === 'email';
        const title =
          activity.type === 'note'
            ? 'Note'
            : activity.type === 'text'
              ? contactName
              : activity.type === 'email'
                ? contactName
                : activity.type === 'call'
                  ? 'Manual call note'
                  : activity.type;
        return {
          id: `activity-${activity.id}`,
          kind: activity.type === 'call' ? 'call' : isMessage ? 'message' : 'note',
          title,
          body: isMessage ? cleanCommunicationBody(activity.note) : activity.note,
          meta: formatDateTime(activity.timestamp),
          timestamp: activity.timestamp,
        };
      });

    const inboundItems = inboundMessages.map<CommunicationItem>((item) => ({
      id: `inbound-${item.id}`,
      kind: 'message',
      title: contactName,
      body: item.body,
      meta: `${formatPhoneDisplay(item.from_number_e164)} • ${formatDateTime(item.received_at)}`,
      timestamp: item.received_at,
    }));

    const callItems = contactCalls.map<CommunicationItem>((call) => {
      const connected = Boolean(call.answered_at || (call.duration_seconds ?? 0) > 0 || call.disposition === 'connected');
      const duration = (call.duration_seconds ?? 0) > 0 ? `Connected for ${formatDuration(call.duration_seconds)}` : connected ? 'Connected' : 'No connection recorded';
      const dispositionLabel = call.disposition ? DIALER_DISPOSITION_LABELS[call.disposition] : formatDialerCallStatus(call.status);
      return {
        id: `call-${call.id}`,
        kind: 'call',
        title: connected ? 'Call connected' : 'Call logged',
        body: [duration, call.disposition_note].filter(Boolean).join('\n'),
        meta: `${dispositionLabel} • ${formatDateTime(call.ended_at ?? call.created_at)}`,
        timestamp: call.ended_at ?? call.created_at,
      };
    });

    return [...activityItems, ...inboundItems, ...callItems]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [activities, contact?.full_name, contactCalls, inboundMessages]);

  const loadActivities = useCallback(async (currentContactId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingActivity(true);
    try {
      const supabase = createClient();
      const [activityRows, callRows, inboundRows] = await Promise.all([
        ContactsService.fetchActivities(currentContactId),
        supabase
          .from('dialer_calls')
          .select('*')
          .eq('contact_id', currentContactId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('dialer_inbound_messages')
          .select('*')
          .eq('contact_id', currentContactId)
          .order('received_at', { ascending: false })
          .limit(50),
      ]);

      setActivities(activityRows);

      if (callRows.error) {
        console.warn('[lead-record] failed to load dialer calls', callRows.error);
      } else {
        setContactCalls((callRows.data ?? []) as DialerCall[]);
      }

      if (inboundRows.error) {
        console.warn('[lead-record] failed to load inbound texts', inboundRows.error);
      } else {
        setInboundMessages((inboundRows.data ?? []) as DialerInboundMessage[]);
      }
    } catch (error) {
      console.error('Error loading activities:', error);
      setActivities([]);
      setContactCalls([]);
      setInboundMessages([]);
    } finally {
      if (!options?.silent) setLoadingActivity(false);
    }
  }, []);

  useEffect(() => {
    if (!contact) return;
    setNoteDraft('');
    setEmailSubject('');
    setContactDraft({
      full_name: contact.full_name,
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      address: contact.address ?? '',
    });
    setEditingContact(false);
    setComposerMode('note');
    setMessage(null);
    void loadActivities(contact.id);
  }, [contact, loadActivities]);

  useEffect(() => {
    if (!contact) return;
    const interval = window.setInterval(() => {
      void loadActivities(contact.id, { silent: true });
    }, 8000);
    return () => window.clearInterval(interval);
  }, [contact, loadActivities]);

  const applySessionResponse = useCallback((payload: SessionResponse, currentContactId: string) => {
    setSession(payload.session);
    setLeads(payload.leads ?? []);
    setCalls(payload.calls ?? []);

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

  const focusComposer = useCallback((mode: ComposerMode) => {
    setComposerMode(mode);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

  const handleSaveContactDetails = useCallback(async () => {
    if (!contact || !userId) return;
    const fullName = contactDraft.full_name.trim();
    const phone = contactDraft.phone.trim();
    const email = contactDraft.email.trim();
    const address = contactDraft.address.trim();

    if (!fullName) {
      setMessage({ type: 'error', text: 'Name is required.' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ type: 'error', text: 'Enter a valid email address.' });
      return;
    }

    const normalizedPhone = phone ? normalizePhoneNumber(phone, 'CA') : null;
    if (phone && !normalizedPhone?.e164) {
      setMessage({ type: 'error', text: normalizedPhone?.error ?? 'Enter a valid phone number.' });
      return;
    }

    setSaving(true);
    try {
      const updates: Partial<Contact> = {
        full_name: fullName,
        phone,
        email,
        address,
        phone_e164: normalizedPhone?.e164 ?? '',
        phone_validation_error: normalizedPhone?.error ?? '',
      };
      if (phone) {
        updates.phone_last_validated_at = new Date().toISOString();
      }

      await ContactsService.updateContact(contact.id, updates);
      await loadContacts(userId);
      setEditingContact(false);
      setMessage({ type: 'success', text: 'Contact details saved.' });
    } catch (error) {
      console.error('Error saving contact details:', error);
      setMessage({ type: 'error', text: 'Unable to save contact details right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact, contactDraft, loadContacts, userId]);

  const handleQuickFollowUp = useCallback(async () => {
    if (!contact || !userId) return;
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setSaving(true);
    setMessage(null);
    try {
      await ContactsService.updateContact(contact.id, { follow_up_at: tomorrow, reminder_date: tomorrow });
      await ContactsService.logActivity({
        contactId: contact.id,
        type: 'note',
        note: `Follow-up scheduled for ${formatDateTime(tomorrow)}.`,
      });
      await Promise.all([loadActivities(contact.id), loadContacts(userId)]);
      setMessage({ type: 'success', text: 'Follow-up set for tomorrow.' });
    } catch (error) {
      console.error('Error setting follow-up:', error);
      setMessage({ type: 'error', text: 'Unable to set that follow-up right now.' });
    } finally {
      setSaving(false);
    }
  }, [contact, loadActivities, loadContacts, userId]);

  const copyDemoUrl = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
    setMessage({ type: 'success', text: 'Link copied.' });
  }, []);

  const handleGenerateDemoLink = useCallback(async () => {
    if (!contact || !currentWorkspaceId) return;

    setGeneratingDemoLink(true);
    setMessage(null);
    try {
      const response = await fetch('/api/demo-links/from-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          contactId: contact.id,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        slug?: string;
        error?: string;
        needsManual?: boolean;
        company?: string;
        city?: string;
      };

      if (response.status === 404 && data.needsManual) {
        setManualDemoCompany(data.company || contact.full_name || '');
        setManualDemoCity(data.city || contact.address || '');
        setManualDemoOpen(true);
        return;
      }

      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to generate demo link.');
      }

      // Copy link to clipboard
      await copyDemoUrl(data.url);
      setMessage({
        type: 'success',
        text: `Demo link copied! ${contact.phone ? `Text to ${contact.phone}` : 'Ready to send'}`
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to generate demo link.',
      });
    } finally {
      setGeneratingDemoLink(false);
    }
  }, [contact, copyDemoUrl, currentWorkspaceId]);

  const handleManualDemoLinkSubmit = useCallback(async () => {
    if (!manualDemoCompany.trim() || !manualDemoCity.trim()) {
      setMessage({ type: 'error', text: 'Company and city are required to generate a demo link.' });
      return;
    }

    setGeneratingDemoLink(true);
    setMessage(null);
    try {
      const response = await fetch('/api/demo-links/from-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company: manualDemoCompany,
          city: manualDemoCity,
          industry: '',
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to generate demo link.');
      }

      await copyDemoUrl(data.url);
      setManualDemoOpen(false);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to generate demo link.',
      });
    } finally {
      setGeneratingDemoLink(false);
    }
  }, [copyDemoUrl, manualDemoCity, manualDemoCompany]);

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

  const handleSendOutbound = useCallback(async () => {
    if (!contact || !userId || !currentWorkspaceId || composerMode === 'note') return;
    const body = noteDraft.trim();
    if (!body) return;

    setSendingOutbound(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/contacts/${contact.id}/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          channel: composerMode,
          body,
          subject: composerMode === 'email' ? emailSubject.trim() : undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!response.ok) {
        throw new Error(data.error || `Failed to send ${composerMode === 'email' ? 'email' : 'message'}.`);
      }

      setNoteDraft('');
      setEmailSubject('');
      setMessage({
        type: 'success',
        text: data.warning || (composerMode === 'email' ? 'Email sent.' : 'Message sent.'),
      });
      await Promise.all([loadActivities(contact.id), loadContacts(userId)]);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : `Failed to send ${composerMode === 'email' ? 'email' : 'message'}.`,
      });
    } finally {
      setSendingOutbound(false);
    }
  }, [composerMode, contact, currentWorkspaceId, emailSubject, loadActivities, loadContacts, noteDraft, userId]);

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
      setContactCalls((previous) => [data.call as DialerCall, ...previous.filter((call) => call.id !== data.call?.id)]);
      await refreshSession(contact.id, prepared.sessionId);
      await device.startCall(data.call.call_request_id, {
        toNumber: data.call.to_number_e164,
        fromNumber: data.call.from_number_e164,
      });
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
      await Promise.all([refreshSession(contact.id, session?.id), loadActivities(contact.id), loadContacts(userId ?? '')]);
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
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-background dark:text-foreground">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-border dark:bg-card/95">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-normal text-slate-950 dark:text-foreground">
                {contact.full_name}
              </h1>
              <p className="text-sm text-slate-500 dark:text-muted-foreground">
                Last communication {formatRelativeTime(contact.last_contacted)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="mr-1 text-sm font-medium text-slate-500 dark:text-muted-foreground">
                Person {currentIndex >= 0 ? currentIndex + 1 : 1} of {orderedContacts.length}
              </div>
              <Button variant="outline" size="sm" onClick={() => router.push('/leads')}>
                Back to Leads
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => canGoNext && router.push(`/leads/${orderedContacts[currentIndex + 1].id}`)}
                disabled={!canGoNext || device.isInCall}
              >
                Next Person
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card className="overflow-hidden border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-200 text-base font-semibold text-slate-700 dark:bg-primary/15 dark:text-primary">
                      {getInitials(editingContact ? contactDraft.full_name || contact.full_name : contact.full_name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold text-slate-950 dark:text-foreground">
                        {editingContact ? contactDraft.full_name || 'Lead' : contact.full_name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-muted-foreground">
                        {formatRelativeTime(contact.last_contacted)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    onClick={() => {
                      if (editingContact) {
                        setContactDraft({
                          full_name: contact.full_name,
                          phone: contact.phone ?? '',
                          email: contact.email ?? '',
                          address: contact.address ?? '',
                        });
                        setEditingContact(false);
                        return;
                      }
                      setEditingContact(true);
                    }}
                    disabled={saving}
                  >
                    {editingContact ? <X className="mr-1 h-3.5 w-3.5" /> : <Pencil className="mr-1 h-3.5 w-3.5" />}
                    {editingContact ? 'Cancel' : 'Edit'}
                  </Button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="h-9 px-2 text-xs" onClick={() => focusComposer('text')}>
                    <MessageSquare className="mr-1 h-3.5 w-3.5" />
                    Message
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 px-2 text-xs" onClick={() => focusComposer('email')}>
                    <Mail className="mr-1 h-3.5 w-3.5" />
                    Email
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-2 text-xs"
                    onClick={async () => {
                      if (!device.isReady) {
                        setMessage(null);
                        await device.initialize(currentWorkspaceId ?? '', tabIdRef.current);
                        return;
                      }
                      await handleCallCurrentPerson();
                    }}
                    disabled={!currentWorkspaceId || !contact.phone?.trim() || startingCall || device.isInCall || device.setupState === 'initializing'}
                  >
                    {startingCall ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Phone className="mr-1 h-3.5 w-3.5" />}
                    Call
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 px-2 text-xs" onClick={handleQuickFollowUp} disabled={saving}>
                    <Clock3 className="mr-1 h-3.5 w-3.5" />
                    Follow
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-2 text-xs"
                    onClick={() => void handleGenerateDemoLink()}
                    disabled={!currentWorkspaceId || generatingDemoLink}
                  >
                    {generatingDemoLink ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                    Text Demo
                  </Button>
                </div>

                {editingContact ? (
                  <div className="mt-5 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-full-name" className="text-xs text-slate-500 dark:text-muted-foreground">
                        Name
                      </Label>
                      <Input
                        id="lead-full-name"
                        value={contactDraft.full_name}
                        onChange={(event) => setContactDraft((draft) => ({ ...draft, full_name: event.target.value }))}
                        className="h-9 bg-white dark:bg-background"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-phone" className="text-xs text-slate-500 dark:text-muted-foreground">
                        Phone
                      </Label>
                      <Input
                        id="lead-phone"
                        value={contactDraft.phone}
                        onChange={(event) => setContactDraft((draft) => ({ ...draft, phone: event.target.value }))}
                        placeholder="Phone number"
                        className="h-9 bg-white dark:bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-email" className="text-xs text-slate-500 dark:text-muted-foreground">
                        Email
                      </Label>
                      <Input
                        id="lead-email"
                        value={contactDraft.email}
                        onChange={(event) => setContactDraft((draft) => ({ ...draft, email: event.target.value }))}
                        placeholder="Email address"
                        type="email"
                        className="h-9 bg-white dark:bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="lead-address" className="text-xs text-slate-500 dark:text-muted-foreground">
                        Address
                      </Label>
                      <Textarea
                        id="lead-address"
                        value={contactDraft.address}
                        onChange={(event) => setContactDraft((draft) => ({ ...draft, address: event.target.value }))}
                        placeholder="Address"
                        className="min-h-[72px] resize-none bg-white dark:bg-background"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => {
                        setContactDraft({
                          full_name: contact.full_name,
                          phone: contact.phone ?? '',
                          email: contact.email ?? '',
                          address: contact.address ?? '',
                        });
                        setEditingContact(false);
                      }} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void handleSaveContactDetails()} disabled={saving}>
                        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-foreground">
                      <Phone className="h-4 w-4 shrink-0 text-slate-400 dark:text-muted-foreground" />
                      <span className="truncate">{contact.phone ? formatPhoneDisplay(contact.phone) : 'Add phone'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-700 dark:text-foreground">
                      <Mail className="h-4 w-4 shrink-0 text-slate-400 dark:text-muted-foreground" />
                      <span className="min-w-0 truncate">{contact.email || 'Add email'}</span>
                    </div>
                    <div className="flex items-start gap-2 text-slate-700 dark:text-foreground">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-muted-foreground" />
                      <span className="line-clamp-2">{contact.address || 'No address on file'}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>

          <section className="space-y-4">
            {message && (
              <div
                className={`rounded-md border px-4 py-3 text-sm ${
                  message.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                }`}
              >
                {message.text}
              </div>
            )}

            {manualDemoOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4">
                <Card className="w-full max-w-md border-slate-200 bg-white shadow-xl dark:border-border dark:bg-card">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Generate demo link</CardTitle>
                      <CardDescription>Confirm the company and city for this contact.</CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => setManualDemoOpen(false)}
                      disabled={generatingDemoLink}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="manual-demo-company" className="text-xs text-slate-500 dark:text-muted-foreground">
                        Company
                      </Label>
                      <Input
                        id="manual-demo-company"
                        value={manualDemoCompany}
                        onChange={(event) => setManualDemoCompany(event.target.value)}
                        className="bg-white dark:bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="manual-demo-city" className="text-xs text-slate-500 dark:text-muted-foreground">
                        City
                      </Label>
                      <Input
                        id="manual-demo-city"
                        value={manualDemoCity}
                        onChange={(event) => setManualDemoCity(event.target.value)}
                        placeholder="Oshawa, ON"
                        className="bg-white dark:bg-background"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" onClick={() => setManualDemoOpen(false)} disabled={generatingDemoLink}>
                        Cancel
                      </Button>
                      <Button onClick={() => void handleManualDemoLinkSubmit()} disabled={generatingDemoLink}>
                        {generatingDemoLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Generate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            <Card className="border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
              <CardHeader className="flex flex-row items-center justify-between gap-3 p-5 pb-3">
                <div>
                  <CardTitle className="text-base">New communication</CardTitle>
                  <CardDescription>Write a note or send a message or email.</CardDescription>
                </div>
                <div className="flex rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-border dark:bg-background">
                  <Button
                    variant={composerMode === 'note' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() => focusComposer('note')}
                  >
                    Note
                  </Button>
                  <Button
                    variant={composerMode === 'text' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() => focusComposer('text')}
                  >
                    Message
                  </Button>
                  <Button
                    variant={composerMode === 'email' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() => focusComposer('email')}
                  >
                    Email
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-5 pt-0">
                {composerMode === 'email' && (
                  <Input
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Subject"
                    className="bg-white dark:bg-background"
                  />
                )}
                <Textarea
                  ref={composerRef}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder={
                    composerMode === 'note'
                      ? 'Add a note...'
                      : composerMode === 'email'
                        ? 'Write an email...'
                        : 'Write a text message...'
                  }
                  className="min-h-[130px] resize-y bg-white dark:bg-background"
                />
                <div className="flex justify-end">
                  <Button
                    onClick={async () => {
                      if (!noteDraft.trim()) return;
                      if (composerMode === 'note') {
                        await handleLogActivity('note', noteDraft.trim());
                        setNoteDraft('');
                        return;
                      }
                      await handleSendOutbound();
                    }}
                    disabled={saving || sendingOutbound || !noteDraft.trim()}
                  >
                    {sendingOutbound ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : composerMode === 'note' ? null : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    {composerMode === 'note' ? 'Save Note' : composerMode === 'email' ? 'Send Email' : 'Send'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {(startingCall || device.isInCall || activeCall) && (
              <Card className="mx-auto max-w-xl border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
                <CardHeader className="p-5 pb-3 text-center">
                  <CardTitle className="text-base">Call controls</CardTitle>
                  <CardDescription>Calls are logged automatically when placed.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-5 pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-slate-200 p-3 dark:border-border">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">Device</div>
                      <div className="mt-1 text-sm font-semibold">{deviceStatusLabel}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 p-3 dark:border-border">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500 dark:text-muted-foreground">Call</div>
                      <div className="mt-1 text-sm font-semibold">{startingCall ? 'Calling' : callStatusLabel}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={device.toggleMute} disabled={!device.isInCall}>
                      {device.isMuted ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
                      {device.isMuted ? 'Unmute' : 'Mute'}
                    </Button>
                    <Button variant="destructive" onClick={device.hangUp} disabled={!device.isInCall}>
                      <PhoneOff className="mr-2 h-4 w-4" />
                      Hang Up
                    </Button>
                  </div>

                  <Button variant="ghost" className="w-full" onClick={() => void refreshSession(contact.id)} disabled={!session?.id || refreshingSession}>
                    {refreshingSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh Dialer
                  </Button>

                  {device.deviceError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      {device.deviceError}
                    </div>
                  )}

                  {activeCall && (
                    <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-border">
                      <div>
                        <div className="text-sm font-medium">Save call outcome</div>
                        <div className="text-xs text-slate-500 dark:text-muted-foreground">
                          Current outcome: {DIALER_DISPOSITION_LABELS[disposition]}
                        </div>
                      </div>
                      <Textarea
                        value={dispositionNote}
                        onChange={(event) => setDispositionNote(event.target.value)}
                        placeholder="Add call notes..."
                        className="min-h-[90px]"
                      />
                      <div className="space-y-2">
                        <Label htmlFor="call-follow-up" className="text-xs">Follow up</Label>
                        <Input id="call-follow-up" type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="call-appointment" className="text-xs">Appointment</Label>
                        <Input id="call-appointment" type="datetime-local" value={appointmentAt} onChange={(event) => setAppointmentAt(event.target.value)} />
                      </div>
                      <Button className="w-full" onClick={handleSubmitDisposition} disabled={submittingDisposition}>
                        {submittingDisposition ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save and Continue
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-slate-200 bg-white shadow-sm dark:border-border dark:bg-card">
              <CardHeader className="flex flex-row items-center justify-between gap-3 p-5 pb-3">
                <div>
                  <CardTitle className="text-base">Communication</CardTitle>
                  <CardDescription>Notes, texts, and automatically recorded calls.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadActivities(contact.id)} disabled={loadingActivity}>
                  {loadingActivity ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
              </CardHeader>
              <CardContent className="p-5 pt-1">
                {loadingActivity ? (
                  <div className="flex items-center gap-2 py-10 text-sm text-slate-500 dark:text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading communication…
                  </div>
                ) : communicationItems.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-border dark:text-muted-foreground">
                    No notes or messages yet. Calls and inbound texts will appear here automatically.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-border">
                    {communicationItems.map((item) => (
                      <div key={item.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            item.kind === 'call'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : item.kind === 'message'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-background dark:text-muted-foreground'
                          }`}
                        >
                          {item.kind === 'call' ? (
                            <Phone className="h-4 w-4" />
                          ) : item.kind === 'message' ? (
                            <MessageSquare className="h-4 w-4" />
                          ) : (
                            <Clock3 className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-slate-950 dark:text-foreground">{item.title}</div>
                            <div className="text-xs text-slate-500 dark:text-muted-foreground">{item.meta}</div>
                          </div>
                          {item.body ? (
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-foreground/90">
                              {item.body}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
