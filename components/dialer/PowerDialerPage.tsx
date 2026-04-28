'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ChevronRight,
  CheckCircle2,
  CreditCard,
  Flame,
  Gauge,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  SkipForward,
  Users,
  Zap,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { ContactsService } from '@/lib/services/ContactsService';
import { DIALER_CALL_DISPOSITIONS, DIALER_DISPOSITION_LABELS, isFinalCallStatus } from '@/lib/dialer/constants';
import { formatPhoneDisplay } from '@/lib/dialer/phone';
import { useTwilioDevice } from '@/lib/hooks/useTwilioDevice';
import type {
  Contact,
  DialerCall,
  DialerCallDisposition,
  DialerSession,
  DialerSessionLead,
  DialerSmsFollowup,
} from '@/types/database';

type TeamMemberOption = {
  user_id: string;
  display_name: string;
};

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

type SmsFollowupResponse = {
  followups?: DialerSmsFollowup[];
  followup?: DialerSmsFollowup;
  error?: string;
  warning?: string;
};

type DialerAccessResponse = {
  workspaceId: string;
  role: 'owner' | 'admin' | 'member' | null;
  canManage: boolean;
  featureEnabled: boolean;
  sharedDefaultDialingEnabled: boolean;
  offer: {
    priceId?: string | null;
    amount: string;
    currency: 'USD' | 'CAD';
    period: string;
  } | null;
  addon: {
    status: 'inactive' | 'active' | 'past_due' | 'canceled';
    isActive: boolean;
    priceId?: string | null;
    amountCents?: number | null;
    currency?: string | null;
  } | null;
  settings: {
    defaultFromNumber: string;
    defaultSmsFromNumber: string | null;
    dedicatedFromNumber: string | null;
    numberStatus: 'unassigned' | 'active' | 'released';
    usesSharedDefaultNumber: boolean;
  } | null;
};

const DIALER_SELECTION_STORAGE_KEY = 'flyr:dialer:selected-contact-ids';
const DIALER_AUTO_NEXT_STORAGE_KEY = 'flyr:dialer:auto-next';
const DIALER_SCRIPT_VISIBLE_STORAGE_KEY = 'flyr:dialer:quick-script-visible';
const SESSION_CALL_GOAL = 50;
const AUTO_NEXT_DELAY_MS = 1400;

type QuickOutcome = {
  label: string;
  disposition: DialerCallDisposition;
  accent: string;
};

const QUICK_OUTCOMES: QuickOutcome[] = [
  { label: 'No Answer', disposition: 'no_answer', accent: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300' },
  { label: 'Voicemail Left', disposition: 'left_voicemail', accent: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' },
  { label: 'Conversation', disposition: 'connected', accent: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' },
  { label: 'Not Interested', disposition: 'not_interested', accent: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' },
  { label: 'Follow Up', disposition: 'follow_up', accent: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300' },
];

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

function formatLeadDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function defaultDispositionForCall(call: DialerCall | null): DialerCallDisposition {
  if (!call) return 'connected';
  if (call.status_payload && typeof call.status_payload.voicemailDrop === 'object' && call.status_payload.voicemailDrop) {
    return 'left_voicemail';
  }
  if (call.status === 'no-answer' || call.status === 'busy' || call.status === 'canceled') return 'no_answer';
  if (call.status === 'failed') return 'bad_number';
  return 'connected';
}

function shouldOfferSmsFollowup(disposition: DialerCallDisposition): boolean {
  return disposition !== 'bad_number' && disposition !== 'do_not_call';
}

function buildSuggestedSmsBody(payload: {
  contact: { full_name?: string | null } | undefined;
  disposition: DialerCallDisposition;
  appointmentAt?: string | null;
}) {
  const firstName = payload.contact?.full_name?.trim().split(/\s+/)[0] || 'there';
  const appointmentLabel = payload.appointmentAt
    ? new Date(payload.appointmentAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  switch (payload.disposition) {
    case 'left_voicemail':
      return `Hi ${firstName}, this is FLYR. I just left you a voicemail and wanted to send a quick text here too. Reply when you have a minute and I’ll follow up.`;
    case 'callback_requested':
    case 'follow_up':
      return `Hi ${firstName}, thanks for the call today. What time works best for a quick follow-up conversation?`;
    case 'appointment_set':
      return appointmentLabel
        ? `Hi ${firstName}, thanks again for booking time with me. I’ve got you down for ${appointmentLabel}.`
        : `Hi ${firstName}, thanks again for booking time with me. Looking forward to our appointment.`;
    case 'no_answer':
      return `Hi ${firstName}, I just tried to reach you by phone. Feel free to text me back here if that’s easier.`;
    case 'not_interested':
      return `Hi ${firstName}, thanks for taking my call today. If anything changes, you can always reply here.`;
    default:
      return `Hi ${firstName}, thanks for taking my call today. Feel free to reply here if any questions come up.`;
  }
}

function formatSmsStatus(status: string): string {
  return status
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCallClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildLeadContext(contact: Contact | undefined): string {
  if (!contact) return 'No context on file';
  const source = contact.source?.trim();
  const tags = contact.tags?.trim();
  const notes = contact.notes?.trim();
  if (source && tags) return `${source} • ${tags}`;
  if (source) return source;
  if (tags) return tags;
  if (notes) return notes.split('\n')[0]?.slice(0, 100) || 'No context on file';
  return 'No context on file';
}

function buildQuickScript(contact: Contact | undefined) {
  const firstName = contact?.full_name?.trim().split(/\s+/)[0] || 'there';
  return {
    intro: `Hi ${firstName}, this is Daniel with FLYR. I’ll be quick.`,
    bullets: [
      'Reason for calling: local follow-up and a quick value hook.',
      'If busy: ask for a better callback time immediately.',
      'If mild interest: offer one concrete next step, not a long pitch.',
      'If objection: acknowledge, clarify, and either book follow-up or close cleanly.',
    ],
  };
}

function formatDialerOfferLabel(offer?: DialerAccessResponse['offer'] | null): string {
  if (!offer) return 'CA$19.99/month';
  return `${offer.currency === 'CAD' ? 'CA$' : '$'}${offer.amount}${offer.currency === 'USD' ? ' USD' : ''}${offer.period}`;
}

export function PowerDialerPage() {
  const searchParams = useSearchParams();
  const priorityContactId = searchParams.get('contactId');
  const selectedQueueMode = searchParams.get('selection') === '1';
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedQueueContactIds, setSelectedQueueContactIds] = useState<string[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [dialerAccess, setDialerAccess] = useState<DialerAccessResponse | null>(null);
  const [dialerAccessLoading, setDialerAccessLoading] = useState(true);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
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
  const [creatingSession, setCreatingSession] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [startingPowerSession, setStartingPowerSession] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [disposition, setDisposition] = useState<DialerCallDisposition>('connected');
  const [dispositionNote, setDispositionNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [appointmentAt, setAppointmentAt] = useState('');
  const [submittingDisposition, setSubmittingDisposition] = useState(false);
  const [sendSmsFollowup, setSendSmsFollowup] = useState(false);
  const [smsBody, setSmsBody] = useState('');
  const [smsHistory, setSmsHistory] = useState<DialerSmsFollowup[]>([]);
  const [loadingSmsHistory, setLoadingSmsHistory] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [scriptVisible, setScriptVisible] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canFilterByMembers = currentRole === 'owner' || currentRole === 'admin';
  const device = useTwilioDevice();
  const tabIdRef = useRef<string>(typeof crypto !== 'undefined' ? crypto.randomUUID() : `dialer-${Date.now()}`);
  const autoStartedSelectionRef = useRef(false);
  const autoClaimedSessionRef = useRef<string | null>(null);
  const autoNextTimeoutRef = useRef<number | null>(null);
  const leadRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dialerGateState = useMemo(() => {
    if (!currentWorkspaceId) return 'workspace';
    if (dialerAccessLoading) return 'loading';
    if (dialerAccess && !dialerAccess.featureEnabled) return 'hidden';
    if (!dialerAccess) return 'buy';
    if (!dialerAccess.addon?.isActive) {
      return dialerAccess.canManage ? 'buy' : 'ask-owner-buy';
    }
    if (
      !dialerAccess.settings?.dedicatedFromNumber &&
      !dialerAccess.sharedDefaultDialingEnabled
    ) {
      return dialerAccess.canManage ? 'setup' : 'ask-owner-setup';
    }
    return 'ready';
  }, [currentWorkspaceId, dialerAccess, dialerAccessLoading]);

  const visibleContacts = useMemo(() => {
    const base = selectedMemberId === 'all'
      ? contacts
      : contacts.filter((contact) => contact.user_id === selectedMemberId);

    const scopedBase = selectedQueueContactIds.length > 0
      ? selectedQueueContactIds
          .map((contactId) => base.find((contact) => contact.id === contactId))
          .filter((contact): contact is Contact => Boolean(contact))
      : base;

    if (!priorityContactId) return scopedBase;

    const priority = scopedBase.find((contact) => contact.id === priorityContactId);
    if (!priority) return scopedBase;
    return [priority, ...scopedBase.filter((contact) => contact.id !== priorityContactId)];
  }, [contacts, priorityContactId, selectedMemberId, selectedQueueContactIds]);

  const queueContactIds = useMemo(
    () =>
      visibleContacts
        .filter((contact) => Boolean(contact.phone?.trim()))
        .map((contact) => contact.id),
    [visibleContacts]
  );

  const activeLead =
    leads.find((lead) => lead.id === activeLeadId) ??
    leads.find((lead) => lead.status === 'claimed' || lead.status === 'calling') ??
    null;
  const activeCall =
    calls.find((call) => call.id === activeCallId) ??
    calls.find((call) => activeLead && call.session_lead_id === activeLead.id && !isFinalCallStatus(call.status)) ??
    null;
  const activeLeadName = activeLead?.contact?.full_name ?? null;
  const activeCallStatus = activeCall?.status ?? null;
  const activeCallFollowUpAt = activeCall?.follow_up_at ?? null;
  const activeCallAppointmentAt = activeCall?.appointment_at ?? null;
  const activeCallDefaultDisposition = defaultDispositionForCall(activeCall);
  const nextLeadPreview =
    leads.find((lead) => activeLead && lead.position === activeLead.position + 1) ??
    leads.find((lead) => lead.status === 'pending' && lead.id !== activeLead?.id) ??
    null;
  const quickScript = useMemo(() => buildQuickScript(activeLead?.contact), [activeLead?.contact]);
  const leadContext = useMemo(() => buildLeadContext(activeLead?.contact), [activeLead?.contact]);
  const pickupCalls = useMemo(
    () => calls.filter((call) => call.status === 'answered' || call.disposition === 'connected' || call.disposition === 'appointment_set').length,
    [calls]
  );
  const conversationCalls = useMemo(
    () =>
      calls.filter((call) =>
        ['connected', 'follow_up', 'appointment_set', 'callback_requested'].includes(call.disposition ?? '')
      ).length,
    [calls]
  );
  const sessionAgeSeconds = useMemo(() => {
    if (!session?.started_at) return 0;
    const diff = Math.floor((nowTick - new Date(session.started_at).getTime()) / 1000);
    return diff > 0 ? diff : 0;
  }, [nowTick, session?.started_at]);
  const averageSecondsPerCall = summary.callsPlaced > 0 && sessionAgeSeconds > 0
    ? Math.round(sessionAgeSeconds / Math.max(summary.callsPlaced, 1))
    : 0;
  const callsPerHour = sessionAgeSeconds > 0
    ? Math.round((summary.callsPlaced / sessionAgeSeconds) * 3600)
    : 0;
  const paceText = callsPerHour > 0 ? `You're on pace for ${callsPerHour} calls/hr` : 'Start dialing to build your pace';
  const sessionGoalProgress = Math.min(100, Math.round((summary.callsPlaced / SESSION_CALL_GOAL) * 100));

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
      (payload.leads ?? []).find((lead) => lead.id === activeLeadId) ??
      (payload.leads ?? []).find((lead) => lead.status === 'claimed' || lead.status === 'calling') ??
      null;
    setActiveLeadId(nextLead?.id ?? null);

    const nextCall =
      (payload.calls ?? []).find((call) => call.id === activeCallId) ??
      (payload.calls ?? []).find((call) => nextLead && call.session_lead_id === nextLead.id && !isFinalCallStatus(call.status)) ??
      null;
    setActiveCallId(nextCall?.id ?? null);
  }, [activeCallId, activeLeadId]);

  const refreshSession = useCallback(async (sessionId = session?.id) => {
    if (!currentWorkspaceId || !sessionId) return;

    try {
      const response = await fetch(
        `/api/dialer/sessions?workspaceId=${encodeURIComponent(currentWorkspaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        { credentials: 'include' }
      );
      const data = (await response.json()) as SessionResponse;
      if (response.ok) {
        applySessionResponse(data);
      }
    } catch (error) {
      console.error('[dialer/page] failed to refresh session', error);
    }
  }, [applySessionResponse, currentWorkspaceId, session?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!currentWorkspaceId) {
      setDialerAccess(null);
      setDialerAccessLoading(false);
      return;
    }

    setDialerAccessLoading(true);
    void fetch(`/api/dialer/settings?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as DialerAccessResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load workspace dialer access');
        }

        if (!cancelled) {
          setDialerAccess(data);
        }
      })
      .catch((error) => {
        console.error('[dialer/page] failed to load dialer access', error);
        if (!cancelled) {
          setDialerAccess(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDialerAccessLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId]);

  const loadSmsHistory = useCallback(async (callId: string) => {
    if (!currentWorkspaceId) return;
    setLoadingSmsHistory(true);

    try {
      const response = await fetch(
        `/api/dialer/calls/${callId}/sms?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
        { credentials: 'include' }
      );
      const data = (await response.json().catch(() => ({}))) as SmsFollowupResponse;
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load follow-up texts');
      }
      setSmsHistory(data.followups ?? []);
    } catch (error) {
      console.error('[dialer/page] failed to load sms follow-up history', error);
      setSmsHistory([]);
    } finally {
      setLoadingSmsHistory(false);
    }
  }, [currentWorkspaceId]);

  const loadContactsAndSession = useCallback(async () => {
    if (!currentWorkspaceId || dialerGateState !== 'ready') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const teamPromise =
        canFilterByMembers
          ? fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`)
              .then((response) => (response.ok ? response.json() : { members: [] }))
              .catch(() => ({ members: [] }))
          : Promise.resolve({ members: [] as TeamMemberOption[] });

      const [contactsData, sessionResponse, teamResponse] = await Promise.all([
        ContactsService.fetchContacts(user.id, currentWorkspaceId),
        fetch(`/api/dialer/sessions?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
          credentials: 'include',
        }).then((response) => (response.ok ? response.json() : { session: null, leads: [], calls: [], summary: undefined })),
        teamPromise,
      ]);

      setContacts(contactsData);
      setTeamMembers(Array.isArray(teamResponse.members) ? teamResponse.members : []);
      applySessionResponse(sessionResponse as SessionResponse);
    } catch (error) {
      console.error('[dialer/page] failed to load dialer data', error);
      setMessage({ type: 'error', text: 'Failed to load your dialer queue.' });
    } finally {
      setLoading(false);
    }
  }, [applySessionResponse, canFilterByMembers, currentWorkspaceId, dialerGateState]);

  useEffect(() => {
    if (dialerGateState !== 'ready') return;
    void loadContactsAndSession();
  }, [dialerGateState, loadContactsAndSession]);

  useEffect(() => {
    try {
      const storedAutoNext = window.localStorage.getItem(DIALER_AUTO_NEXT_STORAGE_KEY);
      if (storedAutoNext === 'false') {
        setAutoNextEnabled(false);
      }

      const storedScriptVisible = window.localStorage.getItem(DIALER_SCRIPT_VISIBLE_STORAGE_KEY);
      if (storedScriptVisible === 'true') {
        setScriptVisible(true);
      }
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
    try {
      window.localStorage.setItem(DIALER_SCRIPT_VISIBLE_STORAGE_KEY, String(scriptVisible));
    } catch {
      // ignore storage write issues
    }
  }, [scriptVisible]);

  useEffect(() => {
    if (!selectedQueueMode) {
      autoStartedSelectionRef.current = false;
      setSelectedQueueContactIds([]);
      return;
    }

    try {
      const raw = window.sessionStorage.getItem(DIALER_SELECTION_STORAGE_KEY);
      if (!raw) {
        setSelectedQueueContactIds([]);
        return;
      }

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSelectedQueueContactIds(
          Array.from(new Set(parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
        );
      } else {
        setSelectedQueueContactIds([]);
      }
    } catch {
      setSelectedQueueContactIds([]);
    } finally {
      window.sessionStorage.removeItem(DIALER_SELECTION_STORAGE_KEY);
    }
  }, [selectedQueueMode]);

  useEffect(() => {
    if (!session?.id || !currentWorkspaceId) return;
    const interval = window.setInterval(() => {
      void refreshSession(session.id);
    }, activeCall ? 2500 : 5000);
    return () => window.clearInterval(interval);
  }, [activeCall, currentWorkspaceId, refreshSession, session?.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedMemberId === 'all') return;
    if (teamMembers.some((member) => member.user_id === selectedMemberId)) return;
    setSelectedMemberId('all');
  }, [selectedMemberId, teamMembers]);

  useEffect(() => {
    if (!activeCallId) {
      setSendSmsFollowup(false);
      setSmsBody('');
      setSmsHistory([]);
      return;
    }

    const nextDisposition = activeCallDefaultDisposition;
    setDisposition(nextDisposition);
    setDispositionNote('');
    setFollowUpAt(toDateTimeInputValue(activeCallFollowUpAt));
    setAppointmentAt(toDateTimeInputValue(activeCallAppointmentAt));
    setSendSmsFollowup(
      device.allowSmsFollowup &&
        ['left_voicemail', 'callback_requested', 'follow_up', 'appointment_set', 'no_answer'].includes(nextDisposition)
    );
    setSmsBody(
      device.allowSmsFollowup && shouldOfferSmsFollowup(nextDisposition)
        ? buildSuggestedSmsBody({
            contact: activeLeadName ? { full_name: activeLeadName } : undefined,
            disposition: nextDisposition,
            appointmentAt: activeCallAppointmentAt,
          })
        : ''
    );
  }, [
    activeCallAppointmentAt,
    activeCallDefaultDisposition,
    activeCallFollowUpAt,
    activeCallId,
    activeCallStatus,
    activeLeadName,
    device.allowSmsFollowup,
  ]);

  useEffect(() => {
    if (!activeCall?.id) {
      setSmsHistory([]);
      return;
    }

    void loadSmsHistory(activeCall.id);
  }, [activeCall?.id, loadSmsHistory]);

  useEffect(() => {
    if (!activeCallId || device.callPhase !== 'ended') return;
    setDispositionOpen(true);
    void refreshSession(session?.id);
  }, [activeCallId, device.callPhase, device.endedCount, refreshSession, session?.id]);

  useEffect(() => {
    if (!activeLeadId) return;
    const node = leadRowRefs.current[activeLeadId];
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLeadId]);

  useEffect(() => {
    if (device.callPhase === 'idle' || device.callPhase === 'ended') {
      setCallSeconds(0);
      return;
    }

    const startedAt = activeCall?.answered_at
      ? new Date(activeCall.answered_at).getTime()
      : activeCall?.created_at
        ? new Date(activeCall.created_at).getTime()
        : Date.now();

    const updateClock = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setCallSeconds(elapsed);
    };

    updateClock();
    const interval = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(interval);
  }, [activeCall?.answered_at, activeCall?.created_at, device.callPhase]);

  useEffect(() => {
    return () => {
      if (autoNextTimeoutRef.current) {
        window.clearTimeout(autoNextTimeoutRef.current);
      }
    };
  }, []);

  const handleInitializeDevice = async () => {
    if (!currentWorkspaceId || dialerGateState !== 'ready') return;
    setMessage(null);
    await device.initialize(currentWorkspaceId, tabIdRef.current);
  };

  const advanceToNextLeadInternal = useCallback(async (sessionId = session?.id, skipCurrent = false) => {
    if (!currentWorkspaceId || !sessionId) return;

    const response = await fetch(`/api/dialer/sessions/${sessionId}/next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        skipCurrent,
        reason: skipCurrent ? 'Skipped by user' : undefined,
      }),
    });
    const data = (await response.json()) as {
      lead: DialerSessionLead | null;
      activeCall: DialerCall | null;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || 'Failed to advance to the next lead');
    }

    setActiveLeadId(data.lead?.id ?? null);
    setActiveCallId(data.activeCall?.id ?? null);
    await refreshSession(sessionId);
    return data;
  }, [currentWorkspaceId, refreshSession, session?.id]);

  const handleAdvanceToNextLead = useCallback(async (sessionId = session?.id, skipCurrent = false) => {
    try {
      const data = await advanceToNextLeadInternal(sessionId, skipCurrent);
      if (!data?.lead) {
        setMessage({ type: 'success', text: 'Your dialer queue is complete.' });
      }
    } catch (error) {
      console.error('[dialer/page] failed to advance queue', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to move to the next lead.',
      });
    }
  }, [advanceToNextLeadInternal, session?.id]);

  const createDialerSession = useCallback(async () => {
    if (!currentWorkspaceId || queueContactIds.length === 0) {
      throw new Error('Add leads with phone numbers before starting the dialer.');
    }
    const response = await fetch('/api/dialer/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        contactIds: queueContactIds,
        tabId: tabIdRef.current,
        name: selectedQueueContactIds.length > 0 ? 'Dialer from selected leads' : priorityContactId ? 'Dialer from lead detail' : undefined,
      }),
    });
    const data = (await response.json()) as SessionResponse & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create dialer session');
    }

    applySessionResponse(data);
    return data;
  }, [
    applySessionResponse,
    currentWorkspaceId,
    priorityContactId,
    queueContactIds,
    selectedQueueContactIds.length,
  ]);

  const handleStartSession = useCallback(async () => {
    setCreatingSession(true);
    setMessage(null);

    try {
      const data = await createDialerSession();
      setMessage({ type: 'success', text: `Dialer session started with ${data.summary.total} leads.` });
      await handleAdvanceToNextLead(data.session?.id ?? undefined);
    } catch (error) {
      console.error('[dialer/page] failed to start session', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to start the dialer session.',
      });
    } finally {
      setCreatingSession(false);
    }
  }, [createDialerSession, handleAdvanceToNextLead]);

  const placeCallForLead = useCallback(async (lead: DialerSessionLead, sessionId: string) => {
    if (!currentWorkspaceId || !lead.contact_id) {
      throw new Error('This lead is missing the contact details needed to call.');
    }

    const response = await fetch('/api/dialer/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        sessionId,
        sessionLeadId: lead.id,
        contactId: lead.contact_id,
      }),
    });
    const data = (await response.json()) as { call?: DialerCall; error?: string };
    if (!response.ok || !data.call) {
      throw new Error(data.error || 'Failed to place the outbound call');
    }

    setActiveCallId(data.call.id);
    await refreshSession(sessionId);
    await device.startCall(data.call.call_request_id);
    return data.call;
  }, [currentWorkspaceId, device, refreshSession]);

  const startNextCallFlow = useCallback(async (options?: { sessionId?: string; delayMs?: number }) => {
    const sessionId = options?.sessionId ?? session?.id;
    if (!sessionId) return;

    const nextLeadResult = await advanceToNextLeadInternal(sessionId);
    if (!nextLeadResult?.lead) {
      setMessage({ type: 'success', text: 'Your dialer queue is complete.' });
      return;
    }

    if (!autoNextEnabled) {
      return;
    }

    const delayMs = options?.delayMs ?? AUTO_NEXT_DELAY_MS;
    if (autoNextTimeoutRef.current) {
      window.clearTimeout(autoNextTimeoutRef.current);
    }

    autoNextTimeoutRef.current = window.setTimeout(() => {
      setStartingCall(true);
      void placeCallForLead(nextLeadResult.lead!, sessionId)
        .catch((error) => {
          console.error('[dialer/page] failed to auto place next call', error);
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Failed to place the next call.',
          });
        })
        .finally(() => {
          setStartingCall(false);
        });
    }, delayMs);
  }, [advanceToNextLeadInternal, autoNextEnabled, placeCallForLead, session?.id]);

  const handleStartPowerSession = useCallback(async () => {
    if (!currentWorkspaceId || dialerGateState !== 'ready') return;

    setStartingPowerSession(true);
    setMessage(null);

    try {
      if (!device.isReady) {
        await device.initialize(currentWorkspaceId, tabIdRef.current);
      }

      const currentSession = session?.id ? session : await createDialerSession().then((data) => data.session);
      if (!currentSession?.id) {
        throw new Error('The power session could not be created.');
      }

      const nextLeadResult = activeLead
        ? { lead: activeLead }
        : await advanceToNextLeadInternal(currentSession.id);
      const claimedLead = nextLeadResult?.lead ?? null;

      if (!currentSession?.id || !claimedLead) {
        setMessage({ type: 'success', text: 'Your dialer queue is complete.' });
        return;
      }

      setCreatingSession(false);
      setStartingCall(true);
      await placeCallForLead(claimedLead, currentSession.id);
      setMessage({ type: 'success', text: 'Power session live. Stay in flow.' });
    } catch (error) {
      console.error('[dialer/page] failed to start power session', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to start the power session.',
      });
    } finally {
      setStartingCall(false);
      setStartingPowerSession(false);
    }
  }, [activeLead, advanceToNextLeadInternal, createDialerSession, currentWorkspaceId, device, dialerGateState, placeCallForLead, session]);

  useEffect(() => {
    if (!selectedQueueMode || loading || creatingSession) return;
    if (autoStartedSelectionRef.current) return;
    if (session?.id || leads.length > 0) return;
    if (queueContactIds.length === 0) return;

    autoStartedSelectionRef.current = true;
    void handleStartPowerSession();
  }, [creatingSession, handleStartPowerSession, leads.length, loading, queueContactIds.length, selectedQueueMode, session?.id]);

  useEffect(() => {
    if (!session?.id) {
      autoClaimedSessionRef.current = null;
      return;
    }

    if (loading || creatingSession || device.isInCall) return;
    if (activeLead || activeCall) {
      autoClaimedSessionRef.current = session.id;
      return;
    }
    if (leads.length === 0 || summary.pending === 0) return;
    if (autoClaimedSessionRef.current === session.id) return;

    autoClaimedSessionRef.current = session.id;
    void handleAdvanceToNextLead(session.id);
  }, [activeCall, activeLead, creatingSession, device.isInCall, handleAdvanceToNextLead, leads.length, loading, session?.id, summary.pending]);

  const handlePlaceCall = async () => {
    if (!currentWorkspaceId || !session?.id || !activeLead?.contact_id) return;

    setStartingCall(true);
    setMessage(null);

    try {
      await placeCallForLead(activeLead, session.id);
    } catch (error) {
      console.error('[dialer/page] failed to place call', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to place the outbound call.',
      });
      await refreshSession(session.id);
    } finally {
      setStartingCall(false);
    }
  };

  const handleDropVoicemail = useCallback(async () => {
    if (!currentWorkspaceId || !activeCall?.id) return;
    setDroppingVoicemail(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/dialer/calls/${activeCall.id}/voicemail-drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to drop voicemail');
      }

      await refreshSession(session?.id);
      device.hangUp();
      setDisposition('left_voicemail');
      setDispositionNote('Voicemail dropped from power session.');
      setMessage({ type: 'success', text: 'Voicemail dropped. Wrapping this lead and moving on.' });
    } catch (error) {
      console.error('[dialer/page] failed to drop voicemail', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to drop voicemail.',
      });
    } finally {
      setDroppingVoicemail(false);
    }
  }, [activeCall?.id, currentWorkspaceId, device, refreshSession, session?.id]);

  const handleApplySuggestedSms = useCallback(() => {
    if (!activeLead?.contact) return;
    setSmsBody(
      buildSuggestedSmsBody({
        contact: activeLead.contact,
        disposition,
        appointmentAt: toIsoOrNull(appointmentAt),
      })
    );
  }, [activeLead?.contact, appointmentAt, disposition]);

  const handleSubmitDisposition = useCallback(async (overrideDisposition?: DialerCallDisposition) => {
    if (!currentWorkspaceId || !activeCall) return;

    setSubmittingDisposition(true);
    setSendingSms(false);

    try {
      const selectedDisposition =
        typeof overrideDisposition === 'string' ? overrideDisposition : disposition;
      const smsRequested =
        device.allowSmsFollowup &&
        sendSmsFollowup &&
        shouldOfferSmsFollowup(selectedDisposition) &&
        Boolean(smsBody.trim());

      const response = await fetch(`/api/dialer/calls/${activeCall.id}/disposition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          disposition: selectedDisposition,
          note: dispositionNote,
          followUpAt: toIsoOrNull(followUpAt),
          appointmentAt: toIsoOrNull(appointmentAt),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save the call disposition');
      }

      let smsError: string | null = null;
      let smsWarning: string | null = null;
      if (smsRequested) {
        setSendingSms(true);
        const smsResponse = await fetch(`/api/dialer/calls/${activeCall.id}/sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            body: smsBody,
          }),
        });
        const smsData = (await smsResponse.json().catch(() => ({}))) as SmsFollowupResponse;
        if (!smsResponse.ok) {
          smsError = smsData.error || 'Failed to send the follow-up text.';
        } else if (smsData.warning) {
          smsWarning = smsData.warning;
        }
      }

      setDispositionOpen(false);
      setActiveCallId(null);
      device.resetEndedPhase();
      setSendSmsFollowup(false);
      setSmsBody('');
      await refreshSession(session?.id);
      if (autoNextEnabled) {
        await startNextCallFlow({ sessionId: session?.id, delayMs: AUTO_NEXT_DELAY_MS });
      } else {
        await handleAdvanceToNextLead(session?.id);
      }

      if (smsError) {
        setMessage({ type: 'error', text: `Call outcome saved, but the text follow-up failed: ${smsError}` });
      } else if (smsWarning) {
        setMessage({ type: 'success', text: `Call outcome saved. ${smsWarning}` });
      } else if (smsRequested) {
        setMessage({ type: 'success', text: 'Call outcome saved and follow-up text queued.' });
      }
    } catch (error) {
      console.error('[dialer/page] failed to submit disposition', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save the call disposition.',
      });
    } finally {
      setSendingSms(false);
      setSubmittingDisposition(false);
    }
  }, [activeCall, autoNextEnabled, currentWorkspaceId, device, disposition, dispositionNote, followUpAt, appointmentAt, sendSmsFollowup, smsBody, refreshSession, session?.id, startNextCallFlow, handleAdvanceToNextLead]);

  const handleQuickOutcome = useCallback(async (nextDisposition: DialerCallDisposition) => {
    setDisposition(nextDisposition);
    await handleSubmitDisposition(nextDisposition);
  }, [handleSubmitDisposition]);

  const callMachineState =
    device.isInCall
      ? activeCall?.status === 'ringing' || device.callPhase === 'connecting'
        ? 'Ringing now'
        : 'Live conversation'
      : dispositionOpen
        ? 'Wrap the last call'
        : activeLead
          ? 'Ready for next lead'
          : 'Queue not started';
  const sessionXp = summary.callsPlaced * 5 + pickupCalls * 10 + conversationCalls * 15;
  const smsFollowupReady = Boolean(device.allowSmsFollowup && device.smsFromNumber);
  const dialerOfferLabel = formatDialerOfferLabel(dialerAccess?.offer);
  const safetyChecks = [
    { label: 'Workspace selected', ok: Boolean(currentWorkspaceId) },
    { label: 'Microphone granted', ok: device.microphoneGranted },
    { label: 'Twilio device ready', ok: device.isReady },
    { label: 'SMS follow-up ready', ok: smsFollowupReady },
  ];

  const renderDialerGate = () => {
    if (dialerGateState === 'loading') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-background">
          <main className="mx-auto flex w-full max-w-3xl items-center justify-center px-4 py-24 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 rounded-xl border bg-background px-5 py-4 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking Power Dialer access…
            </div>
          </main>
        </div>
      );
    }

    if (dialerGateState === 'ready') {
      return null;
    }

    let title = 'Power Dialer needs setup';
    let description = 'Finish setup before launching the dialer.';
    let primaryHref = '/billing';
    let primaryLabel = `Enable dialer add-on (${dialerOfferLabel})`;
    let secondaryHref = '/leads';
    let secondaryLabel = 'Back to Leads';
    let accent = 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
    let Icon = CreditCard;

    if (dialerGateState === 'workspace') {
      title = 'Choose a workspace first';
      description = 'Pick a workspace before opening the Power Dialer.';
      primaryHref = '/leads';
      primaryLabel = 'Go to Leads';
      secondaryHref = '/settings';
      secondaryLabel = 'Open Settings';
      accent = 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300';
      Icon = Users;
    } else if (dialerGateState === 'setup') {
      title = 'Claim your workspace dialer number';
      description = 'The add-on is active, but this workspace still needs its own Twilio number before anyone can dial.';
      primaryHref = '/settings';
      primaryLabel = 'Claim workspace number';
      secondaryHref = '/billing';
      secondaryLabel = 'View billing';
      accent = 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300';
      Icon = PhoneCall;
    } else if (dialerGateState === 'hidden') {
      title = 'Power Dialer is not enabled here yet';
      description = 'This workspace is outside the current dialer test group. Switch to the test workspace to continue.';
      primaryHref = '/settings';
      primaryLabel = 'Open Settings';
      secondaryHref = '/leads';
      secondaryLabel = 'Back to Leads';
      accent = 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300';
      Icon = AlertCircle;
    } else if (dialerGateState === 'ask-owner-buy') {
      title = 'Ask your team owner to enable Power Dialer';
      description = `This workspace does not have the Power Dialer add-on yet. An owner or admin needs to purchase it first for ${dialerOfferLabel}.`;
      primaryHref = '/leads';
      primaryLabel = 'Back to Leads';
      secondaryHref = '/settings';
      secondaryLabel = 'Open Settings';
      accent = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
      Icon = AlertCircle;
    } else if (dialerGateState === 'ask-owner-setup') {
      title = 'Ask your team owner to finish dialer setup';
      description = 'The Power Dialer add-on is active, but your team owner still needs to claim and assign the workspace phone number.';
      primaryHref = '/leads';
      primaryLabel = 'Back to Leads';
      secondaryHref = '/settings';
      secondaryLabel = 'Open Settings';
      accent = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
      Icon = AlertCircle;
    }

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Power Dialer</h1>
                <p className="text-sm text-muted-foreground">
                  Browser calling for workspace leads with Twilio Voice.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href="/leads">Back to Leads</Link>
                </Button>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <Card className="overflow-hidden">
            <CardHeader className="space-y-4">
              <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${accent}`}>
                <Icon className="h-3.5 w-3.5" />
                {title}
              </div>
              <div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Workspace price</div>
                  <div className="mt-2 text-2xl font-semibold">{dialerOfferLabel}</div>
                </div>
                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Caller ID status</div>
                  <div className="mt-2 text-base font-semibold text-foreground">
                    {dialerAccess?.settings?.dedicatedFromNumber
                      ? dialerAccess.settings.dedicatedFromNumber
                      : dialerAccess?.sharedDefaultDialingEnabled
                        ? `${dialerAccess?.settings?.defaultFromNumber ?? 'Shared default number'} (shared default)`
                        : 'No workspace number assigned'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={primaryHref}>{primaryLabel}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={secondaryHref}>{secondaryLabel}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  };

  if (dialerGateState !== 'ready') {
    return renderDialerGate();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Power Dialer</h1>
              <p className="text-sm text-muted-foreground">
                Browser calling for workspace leads with Twilio Voice.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void loadContactsAndSession()} disabled={loading}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button asChild variant="outline">
                <Link href="/leads">Back to Leads</Link>
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {safetyChecks.map((check) => (
              <div
                key={check.label}
                className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {check.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                )}
                <span>{check.label}</span>
              </div>
            ))}
            {device.smsFromNumber && (
              <div className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Texts from {formatPhoneDisplay(device.smsFromNumber)}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
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

          {device.deviceError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {device.deviceError}
            </div>
          )}

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Flow Mode</CardTitle>
                <CardDescription>
                  One button to start. Minimal decisions once you are moving.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        {callMachineState}
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Current call timer</div>
                        <div className="text-5xl font-semibold tracking-tight text-foreground">{formatCallClock(callSeconds)}</div>
                      </div>
                    </div>

                    <div className="w-full max-w-sm space-y-3">
                      <Button
                        size="lg"
                        className="h-14 w-full text-base font-semibold shadow-sm"
                        onClick={handleStartPowerSession}
                        disabled={startingPowerSession || creatingSession || startingCall || queueContactIds.length === 0}
                      >
                        {startingPowerSession || creatingSession || startingCall ? (
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        ) : (
                          <Rocket className="mr-2 h-5 w-5" />
                        )}
                        Start Power Session
                      </Button>
                      <div className="flex items-center justify-between rounded-xl border bg-background/80 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Auto-next</div>
                          <div className="text-xs text-muted-foreground">Call the next lead after wrap-up</div>
                        </div>
                        <Switch checked={autoNextEnabled} onCheckedChange={setAutoNextEnabled} aria-label="Toggle auto-next" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button variant="outline" onClick={handleInitializeDevice} disabled={!currentWorkspaceId || device.setupState === 'initializing'}>
                          {device.setupState === 'initializing' ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Mic className="mr-2 h-4 w-4" />
                          )}
                          Init
                        </Button>
                        <Button variant="outline" onClick={handlePlaceCall} disabled={!activeLead || startingCall || device.isInCall}>
                          <PhoneCall className="mr-2 h-4 w-4" />
                          Call
                        </Button>
                        <Button variant="outline" onClick={() => void handleAdvanceToNextLead(session?.id, true)} disabled={!activeLead || Boolean(activeCall) || device.isInCall}>
                          <SkipForward className="mr-2 h-4 w-4" />
                          Skip
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleStartSession} disabled={creatingSession || queueContactIds.length === 0}>
                    <Users className="mr-2 h-4 w-4" />
                    Queue Only
                  </Button>
                  <Button variant="outline" onClick={() => void handleAdvanceToNextLead()} disabled={!session?.id || device.isInCall}>
                    <ChevronRight className="mr-2 h-4 w-4" />
                    Next Lead
                  </Button>
                  <Button
                    variant="outline"
                    onClick={device.toggleMute}
                    disabled={!device.isInCall}
                  >
                    {device.isMuted ? (
                      <MicOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    {device.isMuted ? 'Unmute' : 'Mute'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDropVoicemail}
                    disabled={!device.isInCall || droppingVoicemail}
                  >
                    {droppingVoicemail ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    Drop Voicemail
                  </Button>
                  <Button variant="destructive" onClick={device.hangUp} disabled={!device.isInCall}>
                    <PhoneOff className="mr-2 h-4 w-4" />
                    Hang Up
                  </Button>
                </div>

                {canFilterByMembers && teamMembers.length > 0 && (
                  <div className="max-w-xs">
                    <Label className="mb-2 block">Filter by member</Label>
                    <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                      <SelectTrigger className="w-full">
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
                  </div>
                )}

                {!device.microphoneGranted && device.setupState !== 'idle' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    Allow microphone access in your browser to place calls from the web dialer.
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" />
                      Calls Made
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{summary.callsPlaced}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Zap className="h-3.5 w-3.5" />
                      Connected Calls
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{pickupCalls}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Conversations
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{conversationCalls}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5" />
                      Remaining
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{summary.pending}</div>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-3">
                  <div className="rounded-xl border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Speed</div>
                    <div className="mt-2 text-xl font-semibold">
                      {averageSecondsPerCall > 0 ? `1 call / ${averageSecondsPerCall}s` : 'Waiting to build pace'}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{paceText}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <Flame className="h-3.5 w-3.5 text-orange-500" />
                      Streak
                    </div>
                    <div className="mt-2 text-xl font-semibold">{summary.callsPlaced} calls in flow</div>
                    <div className="mt-1 text-sm text-muted-foreground">{sessionXp} XP this session</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily Goal</div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span>{summary.callsPlaced} / {SESSION_CALL_GOAL} calls</span>
                      <span>{sessionGoalProgress}%</span>
                    </div>
                    <Progress value={sessionGoalProgress} className="mt-3" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Call Queue</CardTitle>
                <CardDescription>
                  {queueContactIds.length} leads are loaded. Keep the pipeline moving.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {nextLeadPreview && (
                  <div className="mb-4 rounded-xl border bg-muted/40 p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Next Up</div>
                    <div className="mt-1 font-medium text-foreground">{nextLeadPreview.contact?.full_name ?? 'Lead'}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatPhoneDisplay(nextLeadPreview.contact?.phone)} • {buildLeadContext(nextLeadPreview.contact)}
                    </div>
                  </div>
                )}
                {loading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading queue…
                  </div>
                ) : leads.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    {selectedQueueContactIds.length > 0
                      ? 'Start a session to generate a dialer queue from the leads you selected in Leads.'
                      : 'Start a session to generate a dialer queue from your current workspace contacts.'}
                  </div>
                ) : (
                  <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                    {leads.map((lead) => {
                      const isCurrent = activeLead?.id === lead.id;
                      return (
                        <button
                          key={lead.id}
                          ref={(node) => {
                            leadRowRefs.current[lead.id] = node;
                          }}
                          type="button"
                          onClick={() => setActiveLeadId(lead.id)}
                          className={`w-full rounded-2xl border p-4 text-left transition-all ${
                            isCurrent
                              ? 'scale-[1.01] border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_12px_30px_rgba(59,130,246,0.08)]'
                              : 'border-border hover:border-primary/40 hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-foreground">
                                {lead.position}. {lead.contact?.full_name ?? 'Lead'}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {formatPhoneDisplay(lead.contact?.phone)}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{buildLeadContext(lead.contact)}</div>
                            </div>
                            <div className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wide ${
                              isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                            }`}>
                              {isCurrent ? 'Active' : lead.status}
                            </div>
                          </div>
                          {lead.skip_reason && (
                            <div className="mt-2 text-xs text-muted-foreground">{lead.skip_reason}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Call Cockpit</CardTitle>
                <CardDescription>
                  Keep only what you need in front of you while you dial.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!activeLead ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    No active lead yet. Start a queue, then advance to the next lead.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border bg-muted/30 p-5">
                      <div className="text-2xl font-semibold">{activeLead.contact?.full_name ?? 'Lead'}</div>
                      <div className="mt-1 text-base text-muted-foreground">
                        {formatPhoneDisplay(activeLead.contact?.phone)}
                      </div>
                      <div className="mt-3 text-sm text-foreground">{leadContext}</div>
                      {activeLead.contact?.address && (
                        <div className="mt-2 text-sm text-muted-foreground">{activeLead.contact.address}</div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border p-4">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Contacted</div>
                        <div className="mt-2 text-sm font-medium">{formatLeadDateTime(activeLead.contact?.last_contacted)}</div>
                      </div>
                      <div className="rounded-xl border p-4">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Contact Status</div>
                        <div className="mt-2 text-sm font-medium capitalize">{activeLead.contact?.status ?? 'new'}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Quick Script</div>
                          <div className="text-xs text-muted-foreground">Intro line and objection anchors</div>
                        </div>
                        <Switch checked={scriptVisible} onCheckedChange={setScriptVisible} aria-label="Toggle quick script" />
                      </div>
                      {scriptVisible && (
                        <div className="mt-4 space-y-3">
                          <div className="rounded-lg bg-primary/5 p-3 text-sm text-foreground">
                            {quickScript.intro}
                          </div>
                          <div className="space-y-2">
                            {quickScript.bullets.map((bullet) => (
                              <div key={bullet} className="flex gap-2 text-sm text-muted-foreground">
                                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span>{bullet}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline">
                        <Link href={`/leads/${activeLead.contact_id}`}>Open in Leads</Link>
                      </Button>
                      <Button variant="outline" onClick={() => setDispositionOpen(true)} disabled={!activeCallId}>
                        <MessageSquare className="mr-2 h-4 w-4" />
                        Wrap Call
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Dialog open={dispositionOpen} onOpenChange={setDispositionOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Wrap the Call</DialogTitle>
            <DialogDescription>
              One tap if you want. Notes and follow-up are optional.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Quick outcomes</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {QUICK_OUTCOMES.map((option) => (
                  <Button
                    key={option.disposition}
                    type="button"
                    variant="outline"
                    className={`h-auto justify-start px-4 py-3 text-left ${option.accent}`}
                    onClick={() => void handleQuickOutcome(option.disposition)}
                    disabled={submittingDisposition}
                  >
                    <div>
                      <div className="font-medium">{option.label}</div>
                      <div className="text-xs opacity-80">Save and {autoNextEnabled ? 'move automatically' : 'load the next lead'}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dialer-disposition">Detailed outcome</Label>
              <Select value={disposition} onValueChange={(value) => setDisposition(value as DialerCallDisposition)}>
                <SelectTrigger id="dialer-disposition" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIALER_CALL_DISPOSITIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {DIALER_DISPOSITION_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dialer-note">Call note</Label>
              <Textarea
                id="dialer-note"
                value={dispositionNote}
                onChange={(event) => setDispositionNote(event.target.value)}
                placeholder="Capture the key outcome from this conversation."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="dialer-follow-up">Follow up</Label>
                <Input
                  id="dialer-follow-up"
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(event) => setFollowUpAt(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dialer-appointment">Appointment</Label>
                <Input
                  id="dialer-appointment"
                  type="datetime-local"
                  value={appointmentAt}
                  onChange={(event) => setAppointmentAt(event.target.value)}
                />
              </div>
            </div>

            {device.allowSmsFollowup ? (
              <div className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <MessageSquare className="h-4 w-4" />
                      SMS follow-up
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Queue a text follow-up right after this call outcome is saved.
                    </p>
                    {device.smsFromNumber && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sending from {formatPhoneDisplay(device.smsFromNumber)}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={sendSmsFollowup}
                    onCheckedChange={setSendSmsFollowup}
                    disabled={!shouldOfferSmsFollowup(disposition) || !device.smsFromNumber}
                    aria-label="Send SMS follow-up"
                  />
                </div>

                {!device.smsFromNumber && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    Add an SMS-enabled Twilio number to send follow-up texts from this modal.
                  </div>
                )}

                {device.smsFromNumber && !shouldOfferSmsFollowup(disposition) && (
                  <div className="mt-3 text-xs text-muted-foreground">
                    SMS follow-up is disabled for this outcome.
                  </div>
                )}

                {sendSmsFollowup && device.smsFromNumber && shouldOfferSmsFollowup(disposition) && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleApplySuggestedSms}
                      >
                        Use suggested text
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="dialer-sms-body">Message</Label>
                      <Textarea
                        id="dialer-sms-body"
                        value={smsBody}
                        onChange={(event) => setSmsBody(event.target.value)}
                        placeholder="Write the follow-up text that should send after this call."
                        className="min-h-[120px]"
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {smsBody.trim().length} characters
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 border-t pt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent texts for this call</div>
                  {loadingSmsHistory ? (
                    <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading follow-up texts…
                    </div>
                  ) : smsHistory.length === 0 ? (
                    <div className="mt-3 text-sm text-muted-foreground">
                      No follow-up texts have been sent for this call yet.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {smsHistory.map((followup) => (
                        <div key={followup.id} className="rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>{formatSmsStatus(followup.status)}</span>
                            <span>{formatLeadDateTime(followup.sent_at ?? followup.created_at)}</span>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">{followup.body}</div>
                          {followup.error_message && (
                            <div className="mt-2 text-xs text-red-600 dark:text-red-400">{followup.error_message}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                SMS follow-up is off for this workspace. Add a Twilio SMS-enabled number and enable SMS follow-up to text leads from the dialer.
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispositionOpen(false)} disabled={submittingDisposition}>
              Close
            </Button>
            <Button onClick={() => void handleSubmitDisposition()} disabled={submittingDisposition}>
              {submittingDisposition ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <>
                  {sendingSms ? <Send className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                </>
              )}
              {submittingDisposition ? (sendingSms ? 'Saving and texting…' : 'Saving…') : 'Save and continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
