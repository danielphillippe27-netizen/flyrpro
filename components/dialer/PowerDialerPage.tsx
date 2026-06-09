'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail, MessageSquare, Mic, Pause, PhoneCall, Play, Save, Send, Trash2, Upload, Voicemail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useTwilioDevice } from '@/lib/hooks/useTwilioDevice';
import { formatPhoneDisplay, normalizePhoneNumber } from '@/lib/dialer/phone';
import { useWorkspace } from '@/lib/workspace-context';
import type { DialerCall, DiallerLead, DiallerLeadDisposition } from '@/types/database';

type DialerAccessResponse = {
  workspaceId: string;
  role: 'owner' | 'admin' | 'member' | null;
  canManage: boolean;
  featureEnabled: boolean;
  sharedDefaultDialingEnabled: boolean;
  addon: {
    status: 'inactive' | 'active' | 'past_due' | 'canceled';
    isActive: boolean;
  } | null;
  settings: {
    defaultFromNumber: string;
    defaultSmsFromNumber: string | null;
    dedicatedFromNumber: string | null;
    numberStatus: 'unassigned' | 'active' | 'released';
    usesSharedDefaultNumber: boolean;
  } | null;
};

type DiallerLeadStatus = 'pending' | 'called' | 'skipped';

const DIALER_AUTO_NEXT_STORAGE_KEY = 'flyr:dialer:auto-next';

function formatCallClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getDateInputValue(date: Date): string {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function getTimeInputValue(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function getCallbackDefaultDateTime(choice: 'today' | 'tomorrow' | 'custom', calledAt: Date): { date: string; time: string } {
  const defaultDate = new Date(calledAt);
  if (choice === 'today') {
    defaultDate.setHours(defaultDate.getHours() + 4);
  }
  if (choice === 'tomorrow') {
    defaultDate.setDate(defaultDate.getDate() + 1);
  }
  return {
    date: getDateInputValue(defaultDate),
    time: getTimeInputValue(defaultDate),
  };
}

function statusForLead(lead: DiallerLead): DiallerLeadStatus {
  if (!lead.disposition) return 'pending';
  return lead.disposition === 'dnc' ? 'skipped' : 'called';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function findColumn(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function hasDialablePhone(value: string | null | undefined): boolean {
  return normalizePhoneNumber(value).isValid;
}

function scorePhoneColumn(rows: string[][], columnIndex: number): number {
  return rows.reduce((score, row) => score + (hasDialablePhone(row[columnIndex]) ? 1 : 0), 0);
}

function findPhoneColumn(headers: string[], rows: string[][]): number {
  const exactPhoneIndex = findColumn(headers, [
    'phone',
    'phone_number',
    'phone_1',
    'primary_phone',
    'contact_phone',
    'mobile',
    'mobile_phone',
    'cell',
    'cell_phone',
    'telephone',
    'tel',
  ]);
  if (exactPhoneIndex >= 0 && scorePhoneColumn(rows, exactPhoneIndex) > 0) return exactPhoneIndex;

  const fuzzyIndexes = headers.flatMap((header, index) =>
    header.includes('phone') || header.includes('mobile') || header.includes('cell') || header.includes('telephone') || header === 'tel'
      ? [index]
      : []
  );
  const scored = fuzzyIndexes
    .map((index) => ({ index, score: scorePhoneColumn(rows, index) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.index ?? -1;
}

function leadsFromCsv(text: string): Array<{ name: string; phone: string; company: string | null; email: string | null }> {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const nameIndex = findColumn(headers, ['name', 'full_name', 'contact', 'contact_name', 'lead', 'lead_name']);
  const dataRows = rows.slice(1);
  const phoneIndex = findPhoneColumn(headers, dataRows);
  const companyIndex = findColumn(headers, ['company', 'company_name', 'business', 'organization', 'account']);
  const emailIndex = findColumn(headers, ['email', 'email_address', 'mail']);

  if (phoneIndex === -1) return [];

  return dataRows.flatMap((row) => {
    const phone = row[phoneIndex]?.trim() ?? '';
    if (!hasDialablePhone(phone)) return [];
    return [{
      name: nameIndex >= 0 ? row[nameIndex]?.trim() || 'Lead' : 'Lead',
      phone,
      company: companyIndex >= 0 ? row[companyIndex]?.trim() || null : null,
      email: emailIndex >= 0 ? row[emailIndex]?.trim() || null : null,
    }];
  });
}

export function PowerDialerPage() {
  const { currentWorkspaceId } = useWorkspace();
  const device = useTwilioDevice();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tabIdRef = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : `dialer-${Date.now()}`);
  const callbackCalledAtRef = useRef<Date | null>(null);

  const [dialerAccess, setDialerAccess] = useState<DialerAccessResponse | null>(null);
  const [dialerAccessLoading, setDialerAccessLoading] = useState(true);
  const [leads, setLeads] = useState<DiallerLead[]>([]);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [selectedDisposition, setSelectedDisposition] = useState<DiallerLeadDisposition>('interested');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpName, setFollowUpName] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [followUpChoice, setFollowUpChoice] = useState<'today' | 'tomorrow' | 'custom'>('today');
  const [textOpen, setTextOpen] = useState(false);
  const [textBody, setTextBody] = useState('');
  const [sendingText, setSendingText] = useState(false);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [diallerRunning, setDiallerRunning] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [deletingList, setDeletingList] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isIphone, setIsIphone] = useState(false);

  const activeLead = useMemo(
    () =>
      leads.find((lead) => lead.id === activeLeadId) ??
      leads.find((lead) => statusForLead(lead) === 'pending') ??
      leads[0] ??
      null,
    [activeLeadId, leads]
  );
  const hasActiveLead = Boolean(activeLead);
  const calledCount = leads.filter((lead) => statusForLead(lead) === 'called').length;
  const connectedCount = leads.filter((lead) => lead.disposition === 'interested' || lead.disposition === 'callback').length;
  const remainingCount = leads.filter((lead) => statusForLead(lead) === 'pending').length;

  const statusChecks = [
    { label: 'Workspace selected', ok: Boolean(currentWorkspaceId) },
    { label: 'Microphone granted', ok: device.microphoneGranted },
    { label: 'Twilio device ready', ok: device.isReady },
    { label: 'Shared caller ID', ok: Boolean(dialerAccess?.sharedDefaultDialingEnabled || dialerAccess?.settings?.dedicatedFromNumber) },
  ];

  const loadDiallerLeads = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setLoadingLeads(true);
    setError(null);

    try {
      const response = await fetch(`/api/dialer/leads?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as { leads?: DiallerLead[]; error?: string };
      if (!response.ok) {
        setLeads([]);
        setActiveLeadId(null);
        setError(data.error || `Failed to load dialler leads (${response.status}).`);
        return;
      }

      const nextLeads = data.leads ?? [];
      setLeads(nextLeads);
      setActiveLeadId((currentId) => {
        if (currentId && nextLeads.some((lead) => lead.id === currentId)) return currentId;
        return nextLeads.find((lead) => statusForLead(lead) === 'pending')?.id ?? nextLeads[0]?.id ?? null;
      });
    } catch {
      setLeads([]);
      setActiveLeadId(null);
      setError('Failed to load dialler leads.');
    } finally {
      setLoadingLeads(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    const userAgent = window.navigator.userAgent;
    const platform = window.navigator.platform;
    setIsIphone(/iPhone/.test(userAgent) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1));

    try {
      const storedAutoNext = window.localStorage.getItem(DIALER_AUTO_NEXT_STORAGE_KEY);
      if (storedAutoNext === 'false') setAutoNextEnabled(false);
    } catch {
      // ignore storage read issues
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(DIALER_AUTO_NEXT_STORAGE_KEY, String(autoNextEnabled));
    } catch {
      // ignore storage write issues
    }
  }, [autoNextEnabled]);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setDialerAccess(null);
      setDialerAccessLoading(false);
      setLeads([]);
      setActiveLeadId(null);
      return;
    }

    let cancelled = false;
    setDialerAccessLoading(true);
    setError(null);

    void fetch(`/api/dialer/settings?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as DialerAccessResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Failed to load dialler settings.');
        if (!cancelled) setDialerAccess(data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load dialler settings.');
      })
      .finally(() => {
        if (!cancelled) setDialerAccessLoading(false);
      });

    void loadDiallerLeads();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, loadDiallerLeads]);

  useEffect(() => {
    if (!activeLead) {
      setNotes('');
      setEmail('');
      setTextBody('');
      setTextOpen(false);
      setSelectedDisposition('interested');
      return;
    }
    setNotes(activeLead.notes ?? '');
    setEmail(activeLead.email ?? '');
    setTextBody('');
    setTextOpen(false);
    setSelectedDisposition(activeLead.disposition ?? 'interested');
  }, [activeLead]);

  useEffect(() => {
    if (!device.isInCall) {
      setCallSeconds(0);
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [device.isInCall]);

  useEffect(() => {
    if (device.callPhase !== 'ended' || !activeCallId) return;
    setDiallerRunning(false);
    setActiveCallId(null);
    setMessage((currentMessage) => currentMessage ?? 'Call ended.');
  }, [activeCallId, device.callPhase]);

  const handleInitializeDevice = async () => {
    if (!currentWorkspaceId) return;
    setError(null);
    await device.initialize(currentWorkspaceId, tabIdRef.current);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file || !currentWorkspaceId) return;

    setImporting(true);
    setError(null);
    setMessage(null);

    try {
      const text = await file.text();
      const parsedLeads = leadsFromCsv(text);
      if (parsedLeads.length === 0) {
        throw new Error('CSV must include phone plus optional name and company columns.');
      }

      const response = await fetch('/api/dialer/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          leads: parsedLeads,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        leads?: DiallerLead[];
        importedCount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Failed to import list.');

      const importedLeads = data.leads ?? [];
      setLeads((currentLeads) => [...currentLeads, ...importedLeads]);
      setActiveLeadId((currentId) => currentId ?? importedLeads[0]?.id ?? null);
      setMessage(`${data.importedCount ?? importedLeads.length} leads loaded.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import list.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const advanceToNextLead = useCallback((updatedLeads: DiallerLead[], currentLeadId: string) => {
    const currentIndex = updatedLeads.findIndex((lead) => lead.id === currentLeadId);
    const laterPending = updatedLeads.slice(Math.max(currentIndex + 1, 0)).find((lead) => statusForLead(lead) === 'pending');
    const firstPending = updatedLeads.find((lead) => statusForLead(lead) === 'pending');
    setActiveLeadId(laterPending?.id ?? firstPending?.id ?? updatedLeads[currentIndex + 1]?.id ?? updatedLeads[0]?.id ?? null);
  }, []);

  const saveLeadDisposition = async ({
    disposition,
    sendLink = false,
    notesOverride,
    followUpNameOverride,
    followUpAt,
    createNotification = false,
    forceAdvance = false,
    successMessage,
  }: {
    disposition: DiallerLeadDisposition;
    sendLink?: boolean;
    notesOverride?: string;
    followUpNameOverride?: string | null;
    followUpAt?: string | null;
    createNotification?: boolean;
    forceAdvance?: boolean;
    successMessage: string;
  }) => {
    if (!activeLead || !currentWorkspaceId) return false;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: activeLead.id,
          disposition,
          notes: notesOverride ?? notes,
          email,
          sendLink,
          followUpName: followUpNameOverride,
          followUpAt,
          createNotification,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { lead?: DiallerLead; error?: string; warning?: string | null };
      if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to save lead.');

      setLeads((currentLeads) => {
        const updatedLeads = currentLeads.map((lead) => (lead.id === data.lead!.id ? data.lead! : lead));
        if (autoNextEnabled || forceAdvance) {
          advanceToNextLead(updatedLeads, data.lead!.id);
        }
        return updatedLeads;
      });
      setMessage(data.warning ?? successMessage);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save lead.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const findNextDialableLead = (updatedLeads: DiallerLead[], currentLeadId: string): DiallerLead | null => {
    const currentIndex = updatedLeads.findIndex((lead) => lead.id === currentLeadId);
    const laterPending = updatedLeads
      .slice(Math.max(currentIndex + 1, 0))
      .find((lead) => statusForLead(lead) === 'pending' && hasDialablePhone(lead.phone));
    const firstPending = updatedLeads.find((lead) => statusForLead(lead) === 'pending' && hasDialablePhone(lead.phone));
    return laterPending ?? firstPending ?? null;
  };

  const skipInvalidPendingLeads = async (): Promise<{ updatedLeads: DiallerLead[]; skippedCount: number }> => {
    if (!currentWorkspaceId) return { updatedLeads: leads, skippedCount: 0 };
    const invalidPendingLeads = leads.filter((lead) => statusForLead(lead) === 'pending' && !hasDialablePhone(lead.phone));
    if (invalidPendingLeads.length === 0) return { updatedLeads: leads, skippedCount: 0 };

    const skippedLeads = await Promise.all(
      invalidPendingLeads.map(async (leadToSkip) => {
        const nextNotes = [
          leadToSkip.id === activeLead?.id ? notes.trim() : (leadToSkip.notes ?? '').trim(),
          `Skipped by dialler: invalid phone number (${leadToSkip.phone || 'missing'}).`,
        ].filter(Boolean).join('\n');

        const response = await fetch('/api/dialer/leads', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            id: leadToSkip.id,
            disposition: 'dnc',
            notes: nextNotes,
            email: leadToSkip.email ?? '',
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { lead?: DiallerLead; error?: string };
        if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to skip invalid lead.');
        return data.lead;
      })
    );

    const skippedById = new Map(skippedLeads.map((lead) => [lead.id, lead]));
    const updatedLeads = leads.map((lead) => skippedById.get(lead.id) ?? lead);
    setLeads(updatedLeads);
    return { updatedLeads, skippedCount: skippedLeads.length };
  };

  const openFollowUpTask = () => {
    if (!activeLead) return;
    const calledAt = new Date();
    callbackCalledAtRef.current = calledAt;
    const todayDefault = getCallbackDefaultDateTime('today', calledAt);
    setFollowUpName(`Follow up with ${activeLead.name || 'lead'}`);
    setFollowUpChoice('today');
    setFollowUpDate(todayDefault.date);
    setFollowUpTime(todayDefault.time);
    setFollowUpOpen(true);
  };

  const handleDispositionAction = async (disposition: DiallerLeadDisposition) => {
    setSelectedDisposition(disposition);
    await saveLeadDisposition({
      disposition,
      sendLink: disposition === 'interested',
      successMessage: disposition === 'interested' ? 'Interested saved. Link sent.' : 'Saved. Next lead is ready.',
    });
  };

  const handleFollowUp = async () => {
    const calledAt = callbackCalledAtRef.current ?? new Date();
    const defaultDateTime = getCallbackDefaultDateTime(followUpChoice, calledAt);
    const resolvedDate = followUpChoice === 'custom' ? followUpDate || defaultDateTime.date : defaultDateTime.date;
    const resolvedTime = followUpTime || defaultDateTime.time;
    const followUpAt = new Date(`${resolvedDate}T${resolvedTime}:00`).toISOString();
    const followUpParts = [
      followUpName.trim() ? `Follow up: ${followUpName.trim()}` : 'Follow up',
      `When: ${[resolvedDate, resolvedTime].filter(Boolean).join(' ')}`,
    ].filter(Boolean);
    const nextNotes = [notes.trim(), followUpParts.join(' | ')].filter(Boolean).join('\n');

    setSelectedDisposition('callback');
    const saved = await saveLeadDisposition({
      disposition: 'callback',
      notesOverride: nextNotes,
      followUpNameOverride: followUpName.trim() || `Follow up with ${activeLead?.name || 'lead'}`,
      followUpAt,
      createNotification: true,
      successMessage: email.trim() ? 'Follow-up saved with email.' : 'Follow-up saved.',
    });
    if (saved) setFollowUpOpen(false);
  };

  const placeCurrentCall = async (doubleDial = false) => {
    if (!activeLead || !currentWorkspaceId) return;
    if (device.isInCall) {
      setMessage('A call is already active.');
      return;
    }

    setStartingCall(true);
    setError(null);
    setMessage(null);

    try {
      const { updatedLeads, skippedCount } = await skipInvalidPendingLeads();
      const activeLeadFromQueue = updatedLeads.find((lead) => lead.id === activeLead.id);
      const leadToCall =
        activeLeadFromQueue && statusForLead(activeLeadFromQueue) === 'pending' && hasDialablePhone(activeLeadFromQueue.phone)
          ? activeLeadFromQueue
          : findNextDialableLead(updatedLeads, activeLead.id);

      if (!leadToCall) {
        setActiveLeadId(updatedLeads.find((lead) => statusForLead(lead) === 'pending')?.id ?? updatedLeads[0]?.id ?? null);
        setMessage(skippedCount > 0 ? `Skipped ${skippedCount} invalid phone numbers. No valid pending leads left.` : 'No valid pending leads left.');
        return;
      }
      setActiveLeadId(leadToCall.id);

      if (!device.isReady && device.setupState !== 'initializing') {
        await device.initialize(currentWorkspaceId, tabIdRef.current);
      }

      const response = await fetch('/api/dialer/leads/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          leadId: leadToCall.id,
          tabId: tabIdRef.current,
          doubleDial,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { call?: DialerCall; error?: string };
      if (!response.ok || !data.call) throw new Error(data.error || 'Failed to place the outbound call.');

      setActiveCallId(data.call.id);
      setDiallerRunning(true);
      setMessage(doubleDial ? 'Double dial started.' : 'Call started.');
      await device.startCall(data.call.call_request_id);
    } catch (callError) {
      setDiallerRunning(false);
      setActiveCallId(null);
      setError(callError instanceof Error ? callError.message : 'Failed to place the outbound call.');
    } finally {
      setStartingCall(false);
    }
  };

  const handleDoubleDial = () => {
    void placeCurrentCall(true);
  };

  const handleVoicemailDrop = async () => {
    if (!device.isInCall || !activeCallId || !currentWorkspaceId) {
      setMessage('Voicemail drop is ready after a live call connects.');
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/dialer/calls/${activeCallId}/voicemail-drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to drop voicemail.');
      setMessage('Voicemail dropped.');
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : 'Failed to drop voicemail.');
    } finally {
      setSaving(false);
    }
  };

  const openTextComposer = () => {
    if (!activeLead) return;
    setError(null);
    setMessage(null);
    setTextOpen(true);
  };

  const handleSendText = async () => {
    if (!activeLead || !currentWorkspaceId) return;

    const body = textBody.trim();
    if (!body) {
      setError('Write a text before sending it.');
      return;
    }

    setSendingText(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/dialer/leads/${activeLead.id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          body,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { warning?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to send text.');

      setTextBody('');
      setTextOpen(false);
      setMessage(data.warning ?? 'Text sent.');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send text.');
    } finally {
      setSendingText(false);
    }
  };

  const handleSaveContact = async () => {
    if (!activeLead || !currentWorkspaceId) return;

    setSavingContact(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: activeLead.id,
          notes,
          email,
          saveContact: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        lead?: DiallerLead;
        contact?: unknown;
        warning?: string | null;
        error?: string;
      };
      if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to save contact.');

      setLeads((currentLeads) => currentLeads.map((lead) => (lead.id === data.lead!.id ? data.lead! : lead)));
      setMessage(data.warning ?? 'Contact saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save contact.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!activeLead || !currentWorkspaceId) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: activeLead.id,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { deletedId?: string; error?: string };
      if (!response.ok || !data.deletedId) throw new Error(data.error || 'Failed to delete lead.');

      setLeads((currentLeads) => {
        const updatedLeads = currentLeads.filter((lead) => lead.id !== data.deletedId);
        setActiveLeadId(updatedLeads.find((lead) => statusForLead(lead) === 'pending')?.id ?? updatedLeads[0]?.id ?? null);
        return updatedLeads;
      });
      setMessage('Not interested. Lead deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete lead.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteList = async () => {
    if (!currentWorkspaceId || leads.length === 0) return;
    if (!window.confirm('Delete the current dialler list? This removes all loaded dialler leads.')) return;

    if (device.isInCall) {
      device.hangUp();
    }

    setDeletingList(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          deleteAll: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { deletedCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to delete list.');

      setLeads([]);
      setActiveLeadId(null);
      setNotes('');
      setEmail('');
      setDiallerRunning(false);
      setActiveCallId(null);
      setMessage(`Deleted ${data.deletedCount ?? leads.length} leads.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete list.');
    } finally {
      setDeletingList(false);
    }
  };

  const handleStartPause = async () => {
    if (!diallerRunning) {
      await placeCurrentCall(false);
      return;
    }

    if (device.isInCall) {
      device.hangUp();
    }
    setDiallerRunning(false);
    setActiveCallId(null);
    setMessage('Dialler paused.');
  };

  return (
    <div
      data-device={isIphone ? 'iphone' : undefined}
      className="min-h-[100svh] overflow-x-hidden bg-[#111111] px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] text-neutral-100 sm:px-6 sm:py-4 lg:px-8"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4">
        <div className="-mx-3 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-w-full items-center gap-2">
            {statusChecks.map((check) => (
              <span
                key={check.label}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300"
              >
                {check.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-neutral-500" />
                )}
                {check.label}
              </span>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleInitializeDevice}
              disabled={!currentWorkspaceId || device.setupState === 'initializing'}
              className="h-7 shrink-0 touch-manipulation border-neutral-800 bg-neutral-950 px-2.5 text-[11px] text-neutral-200 hover:bg-neutral-900"
            >
              {device.setupState === 'initializing' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
              Init
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-neutral-900 bg-neutral-950/60 px-3 py-2 text-center text-[11px] text-neutral-500 sm:flex sm:flex-wrap sm:items-center sm:gap-5 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-left sm:text-sm sm:text-neutral-400">
          <span><span className="block text-base font-semibold leading-none text-neutral-100 sm:inline sm:text-sm">{calledCount}</span> calls</span>
          <span><span className="block text-base font-semibold leading-none text-neutral-100 sm:inline sm:text-sm">{connectedCount}</span> connected</span>
          <span><span className="block text-base font-semibold leading-none text-neutral-100 sm:inline sm:text-sm">{remainingCount}</span> left</span>
          {dialerAccessLoading || loadingLeads ? (
            <span className="col-span-3 inline-flex items-center justify-center gap-1.5 text-xs sm:col-span-1 sm:justify-start">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing
            </span>
          ) : null}
        </div>

        {(message || error || device.deviceError) && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              error || device.deviceError
                ? 'border-red-500/30 bg-red-950/40 text-red-200'
                : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
            }`}
          >
            {error || device.deviceError || message}
          </div>
        )}

        <section className="rounded-xl border border-neutral-800 bg-[#202020] p-4 shadow-2xl shadow-black/30 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {activeLead?.company?.trim() || '—'}
              </div>
              <div className="mt-2 truncate text-[26px] font-semibold leading-tight text-neutral-50 sm:text-[28px]">
                {activeLead?.name?.trim() || '—'}
              </div>
              <div className="mt-1 text-base text-neutral-400">
                {activeLead?.phone ? formatPhoneDisplay(activeLead.phone) : '—'}
              </div>
            </div>
            <div className="font-mono text-xs text-neutral-400">{formatCallClock(callSeconds)}</div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={() => void handleDispositionAction('interested')}
              className={`h-[58px] touch-manipulation justify-center border-neutral-700 bg-transparent text-[15px] text-neutral-100 hover:bg-neutral-800 sm:h-14 sm:text-base ${
                selectedDisposition === 'interested' ? 'border-red-400 bg-red-500/10 text-white' : ''
              } ${!hasActiveLead ? 'opacity-40' : ''}`}
            >
              {saving && selectedDisposition === 'interested' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send link
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={handleDoubleDial}
              className={`h-[58px] touch-manipulation justify-center border-neutral-700 bg-transparent text-[15px] text-neutral-100 hover:bg-neutral-800 sm:h-14 sm:text-base ${
                !hasActiveLead ? 'opacity-40' : ''
              }`}
            >
              {startingCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Double dial
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={openFollowUpTask}
              className={`h-[58px] touch-manipulation justify-center border-neutral-700 bg-transparent text-[15px] text-neutral-100 hover:bg-neutral-800 sm:h-14 sm:text-base ${
                selectedDisposition === 'callback' ? 'border-red-400 bg-red-500/10 text-white' : ''
              } ${!hasActiveLead ? 'opacity-40' : ''}`}
            >
              <Mail className="h-4 w-4" />
              Callback
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={() => void handleDeleteLead()}
              className={`h-[58px] touch-manipulation justify-center border-neutral-700 bg-transparent text-[15px] text-neutral-100 hover:border-red-500/60 hover:bg-red-950/30 hover:text-red-100 sm:h-14 sm:text-base ${
                !hasActiveLead ? 'opacity-40' : ''
              }`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Not interested
            </Button>
          </div>

          <div className="mt-3 grid gap-2 sm:mt-4">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!hasActiveLead || saving}
                placeholder="Add email"
                className="h-12 border-neutral-700 bg-[#171717] pl-9 text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={openTextComposer}
                disabled={!hasActiveLead || sendingText || saving || startingCall}
                className="h-12 w-full touch-manipulation border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800"
              >
                {sendingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                Text
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleVoicemailDrop}
                disabled={!hasActiveLead || saving || startingCall}
                className="h-12 w-full touch-manipulation border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800"
              >
                <Voicemail className="h-4 w-4" />
                Voicemail drop
              </Button>
            </div>
          </div>

          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={!hasActiveLead || saving}
            placeholder="Add a note…"
            className="mt-3 min-h-[86px] resize-none border-neutral-700 bg-[#171717] text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40 sm:min-h-[104px]"
          />

          <div className="mt-3 flex items-center justify-between rounded-md border border-neutral-800 bg-[#171717] px-3 py-2 sm:mt-4">
            <div>
              <div className="text-sm font-medium text-neutral-200">Auto-next</div>
              <div className="text-xs text-neutral-500">Keep the next lead ready after every tap</div>
            </div>
            <Switch checked={autoNextEnabled} onCheckedChange={setAutoNextEnabled} aria-label="Toggle auto-next" />
          </div>

          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-20 mt-4 sm:static">
            <div className="grid grid-cols-[1.2fr_0.8fr] gap-2 sm:grid-cols-[1fr_180px]">
              <Button
                type="button"
                onClick={() => void handleStartPause()}
                disabled={!hasActiveLead || device.setupState === 'initializing' || startingCall}
                className="h-[52px] min-h-[52px] w-full touch-manipulation bg-red-500 text-base font-semibold text-white shadow-lg shadow-black/35 hover:bg-red-600 sm:h-12 sm:min-h-12"
              >
                {device.setupState === 'initializing' || startingCall ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : diallerRunning ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {diallerRunning ? 'Pause' : 'Start'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSaveContact()}
                disabled={!hasActiveLead || savingContact || saving || startingCall}
                className="h-[52px] min-h-[52px] touch-manipulation border-neutral-700 bg-[#171717] text-base font-semibold text-neutral-100 hover:bg-neutral-800 sm:h-12 sm:min-h-12"
              >
                {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </section>

        <Dialog open={textOpen} onOpenChange={setTextOpen}>
          <DialogContent
            className="max-w-[calc(100%-1.5rem)] border-neutral-800 bg-[#202020] p-0 text-neutral-100 sm:max-w-xl"
            showCloseButton={false}
          >
            <DialogHeader className="border-b border-neutral-800 px-4 py-4 text-left sm:px-5">
              <DialogTitle className="text-xl font-semibold text-neutral-50">Text</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2 px-4 py-4 sm:px-5">
              <div className="text-sm text-neutral-400">
                {activeLead?.name?.trim() || 'Lead'} · {activeLead?.phone ? formatPhoneDisplay(activeLead.phone) : '—'}
              </div>
              <Textarea
                value={textBody}
                onChange={(event) => setTextBody(event.target.value.slice(0, 1000))}
                disabled={!hasActiveLead || sendingText}
                placeholder="Write a text…"
                className="min-h-[132px] resize-none border-neutral-700 bg-[#171717] text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40"
              />
              <div className="text-right text-xs text-neutral-500">{textBody.trim().length}/1000</div>
            </div>
            <DialogFooter className="border-t border-neutral-800 px-4 py-4 sm:flex-row sm:px-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTextOpen(false)}
                disabled={sendingText}
                className="h-11 border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleSendText()}
                disabled={!hasActiveLead || sendingText || !textBody.trim()}
                className="h-11 bg-red-500 text-white hover:bg-red-600"
              >
                {sendingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                Send text
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
          <DialogContent
            className="max-w-[calc(100%-1.5rem)] border-neutral-800 bg-[#202020] p-0 text-neutral-100 sm:max-w-xl"
            showCloseButton={false}
          >
            <DialogHeader className="border-b border-neutral-800 px-4 py-4 text-left sm:px-5">
              <DialogTitle className="text-xl font-semibold text-neutral-50">Callback</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 px-4 py-4 sm:px-5">
              <Input
                value={followUpName}
                onChange={(event) => setFollowUpName(event.target.value)}
                placeholder="Callback name"
                aria-label="Follow up name"
                className="h-12 border-neutral-700 bg-[#171717] text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40"
              />
              <div className="grid grid-cols-3 gap-2">
                {(['today', 'tomorrow', 'custom'] as const).map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const calledAt = callbackCalledAtRef.current ?? new Date();
                      const defaults = getCallbackDefaultDateTime(choice, calledAt);
                      setFollowUpChoice(choice);
                      setFollowUpDate(defaults.date);
                      setFollowUpTime(defaults.time);
                    }}
                    className={`h-11 border-neutral-700 bg-[#171717] text-neutral-100 hover:bg-neutral-800 ${
                      followUpChoice === choice ? 'border-red-400 bg-red-500/10 text-white' : ''
                    }`}
                  >
                    {choice === 'today' ? 'Today' : choice === 'tomorrow' ? 'Tomorrow' : 'Custom'}
                  </Button>
                ))}
              </div>
              <div className={`grid gap-2 ${followUpChoice === 'custom' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {followUpChoice === 'custom' ? (
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(event) => setFollowUpDate(event.target.value)}
                    aria-label="Follow up date"
                    className="h-12 border-neutral-700 bg-[#171717] text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40"
                  />
                ) : null}
                <Input
                  type="time"
                  value={followUpTime}
                  onChange={(event) => setFollowUpTime(event.target.value)}
                  aria-label="Follow up time"
                  className="h-12 border-neutral-700 bg-[#171717] text-base text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-red-500/40"
                />
              </div>
            </div>
            <DialogFooter className="border-t border-neutral-800 px-4 py-4 sm:flex-row sm:px-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFollowUpOpen(false)}
                disabled={saving}
                className="h-11 border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleFollowUp()}
                disabled={!hasActiveLead || saving}
                className="h-11 bg-red-500 text-white hover:bg-red-600"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Create callback
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className="mt-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-100">Call Queue</h2>
              <p className="text-sm text-neutral-500">
                {leads.length > 0 ? `${leads.length} leads loaded.` : 'Import a CSV list to begin.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleImportClick}
                disabled={!currentWorkspaceId || importing}
                className="min-h-11 touch-manipulation border-neutral-700 bg-transparent text-neutral-100 hover:bg-neutral-900"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="hidden sm:inline">Import List</span>
                <span className="sm:hidden">Import</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDeleteList()}
                disabled={!currentWorkspaceId || leads.length === 0 || deletingList || importing}
                className="min-h-11 touch-manipulation border-red-500/40 bg-transparent text-red-200 hover:border-red-500/70 hover:bg-red-950/30 hover:text-red-100"
              >
                {deletingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span className="hidden sm:inline">Delete List</span>
                <span className="sm:hidden">Delete</span>
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-[#171717]">
            {leads.length === 0 ? (
              <div className="px-4 py-8 text-sm text-neutral-500">
                No leads loaded.
              </div>
            ) : (
              <div className="divide-y divide-neutral-800">
                {leads.map((lead) => {
                  const status = statusForLead(lead);
                  const isActive = lead.id === activeLead?.id;
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => setActiveLeadId(lead.id)}
                      className={`grid min-h-[64px] w-full gap-1.5 px-3 py-3 text-left transition hover:bg-neutral-900 sm:grid-cols-[1.2fr_1fr_0.9fr_auto] sm:items-center sm:gap-2 sm:px-4 ${
                        isActive ? 'bg-neutral-900' : ''
                      }`}
                    >
                      <div className="truncate text-sm font-medium text-neutral-100">{lead.name || 'Lead'}</div>
                      <div className="truncate text-sm text-neutral-400">{lead.company || '—'}</div>
                      <div className="text-sm text-neutral-400">{formatPhoneDisplay(lead.phone)}</div>
                      <Badge
                        variant="outline"
                        className={`w-fit border-neutral-700 text-neutral-300 ${
                          status === 'pending'
                            ? 'bg-neutral-950'
                            : status === 'called'
                              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                              : 'border-red-500/40 bg-red-950/30 text-red-200'
                        }`}
                      >
                        {status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
