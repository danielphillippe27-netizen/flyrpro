'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ChevronRight, Loader2, Mail, MessageSquare, MoreHorizontal, PhoneCall, PhoneIncoming, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialerDevice } from '@/lib/hooks/useDialerDevice';
import { formatPhoneDisplay, normalizePhoneNumber } from '@/lib/dialer/phone';
import { getDialerCallRecordingSummary } from '@/lib/dialer/recordings';
import { useWorkspace } from '@/lib/workspace-context';
import type { DialerCall, DiallerLead } from '@/types/database';

type DialerDevice = ReturnType<typeof useDialerDevice>;

export type ActiveDialerLeadSnapshot = {
  id: string;
  name: string | null;
  phone: string | null;
  company: string | null;
};

type DialerRuntimeContextValue = {
  device: DialerDevice;
  tabId: string;
  diallerLeads: DiallerLead[];
  setDiallerLeads: Dispatch<SetStateAction<DiallerLead[]>>;
  activeLeadId: string | null;
  setActiveLeadId: Dispatch<SetStateAction<string | null>>;
  activeCallId: string | null;
  setActiveCallId: Dispatch<SetStateAction<string | null>>;
  activeCallIsDoubleDial: boolean;
  setActiveCallIsDoubleDial: Dispatch<SetStateAction<boolean>>;
  activeLeadSnapshot: ActiveDialerLeadSnapshot | null;
  setActiveLeadSnapshot: Dispatch<SetStateAction<ActiveDialerLeadSnapshot | null>>;
  callSeconds: number;
  diallerRunning: boolean;
  setDiallerRunning: Dispatch<SetStateAction<boolean>>;
  startingCall: boolean;
  setStartingCall: Dispatch<SetStateAction<boolean>>;
  hangUpActiveCall: () => void;
  placeNextDiallerCall: () => Promise<{ ok: boolean; message: string }>;
  isPlacingNextCall: boolean;
};

const DialerRuntimeContext = createContext<DialerRuntimeContextValue | null>(null);

type DialerCallStatusPayload = {
  diallerLeadId?: unknown;
  doubleDial?: unknown;
  amd?: {
    answeredBy?: unknown;
    isMachine?: unknown;
  };
};

type PlaceDiallerLeadCallOptions = {
  leadId: string;
  doubleDial?: boolean;
};

type DemoMessageResponse = {
  demoLinkToken?: string | null;
  textBody?: string;
  emailSubject?: string;
  emailBody?: string;
  error?: string;
};

const ACTIVE_LEAD_SNAPSHOT_STORAGE_KEY = 'flyr:dialer:active-lead-snapshot';

function createTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dialer-${Date.now()}`;
}

function readStoredActiveLeadSnapshot(): ActiveDialerLeadSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_LEAD_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveDialerLeadSnapshot>;
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    return {
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      phone: typeof parsed.phone === 'string' ? parsed.phone : null,
      company: typeof parsed.company === 'string' ? parsed.company : null,
    };
  } catch {
    return null;
  }
}

function formatCallClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusForLead(lead: DiallerLead): 'pending' | 'called' | 'skipped' {
  if (lead.disposition === 'dnc') return 'skipped';
  if (lead.latest_call_outcome === 'answered' || lead.latest_call_outcome === 'no_answer') return 'called';
  if (!lead.disposition) return 'pending';
  return 'called';
}

function hasDialablePhone(value: string | null | undefined): boolean {
  return normalizePhoneNumber(value).isValid;
}

function getDialerCallStatusPayload(call: DialerCall | null | undefined): DialerCallStatusPayload {
  return typeof call?.status_payload === 'object' && call.status_payload
    ? call.status_payload as DialerCallStatusPayload
    : {};
}

function isMachineAnswer(answeredBy: unknown, isMachine: unknown): boolean {
  return isMachine === true || (typeof answeredBy === 'string' && answeredBy.startsWith('machine'));
}

function getCallOutcome(call: DialerCall): DiallerLead['latest_call_outcome'] {
  if (call.answered_at || call.status === 'answered' || call.status === 'in-progress') return 'answered';
  if (call.status === 'completed') return call.answered_at ? 'answered' : 'no_answer';
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(call.status ?? '')) return 'no_answer';
  return 'pending';
}

function isTerminalDialerCall(call: DialerCall): boolean {
  return Boolean(call.ended_at) || ['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(call.status ?? '');
}

export function useDialerRuntime() {
  const runtime = useContext(DialerRuntimeContext);
  if (!runtime) {
    throw new Error('useDialerRuntime must be used within DialerRuntimeProvider');
  }
  return runtime;
}

export function DialerRuntimeProvider({ children }: { children: ReactNode }) {
  const { currentWorkspaceId } = useWorkspace();
  const device = useDialerDevice();
  const [tabId] = useState(createTabId);
  const callStartedAtRef = useRef<number | null>(null);
  const [diallerLeads, setDiallerLeads] = useState<DiallerLead[]>([]);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [activeCallIsDoubleDial, setActiveCallIsDoubleDial] = useState(false);
  const [activeLeadSnapshot, setActiveLeadSnapshot] = useState<ActiveDialerLeadSnapshot | null>(
    readStoredActiveLeadSnapshot
  );
  const [callSeconds, setCallSeconds] = useState(0);
  const [diallerRunning, setDiallerRunning] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [isPlacingNextCall, setIsPlacingNextCall] = useState(false);
  const autoDoubleDialCallIdsRef = useRef<Set<string>>(new Set());
  const autoDoubleDialTimeoutRef = useRef<number | null>(null);
  const removedDiallerLeadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!device.isInCall) {
      callStartedAtRef.current = null;
      setCallSeconds(0);
      return;
    }

    callStartedAtRef.current = callStartedAtRef.current ?? Date.now();
    const interval = window.setInterval(() => {
      setCallSeconds(Math.floor((Date.now() - (callStartedAtRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [device.isInCall]);

  useEffect(() => {
    try {
      if (!activeLeadSnapshot) {
        window.sessionStorage.removeItem(ACTIVE_LEAD_SNAPSHOT_STORAGE_KEY);
        return;
      }
      window.sessionStorage.setItem(ACTIVE_LEAD_SNAPSHOT_STORAGE_KEY, JSON.stringify(activeLeadSnapshot));
    } catch {
      // ignore storage issues
    }
  }, [activeLeadSnapshot]);

  const hangUpActiveCall = useCallback(() => {
    if (device.isInCall) {
      device.hangUp();
    } else if (activeCallId && currentWorkspaceId) {
      void fetch(`/api/dialer/calls/${encodeURIComponent(activeCallId)}/hangup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      }).catch((error) => {
        console.warn('[dialer/runtime] failed to hang up backend call', error);
      });
    }
    setDiallerRunning(false);
    setActiveCallId(null);
    setActiveCallIsDoubleDial(false);
  }, [activeCallId, currentWorkspaceId, device]);

  const removeDiallerLeadFromQueue = useCallback(async (leadId: string): Promise<void> => {
    if (!currentWorkspaceId || removedDiallerLeadIdsRef.current.has(leadId)) return;
    removedDiallerLeadIdsRef.current.add(leadId);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: leadId,
        }),
      });
      if (!response.ok) throw new Error('Failed to remove dialler lead.');
    } catch {
      removedDiallerLeadIdsRef.current.delete(leadId);
      return;
    }

    setDiallerLeads((currentLeads) => {
      const removedIndex = currentLeads.findIndex((lead) => lead.id === leadId);
      const nextLeads = currentLeads.filter((lead) => lead.id !== leadId);
      setActiveLeadId((currentId) => {
        if (currentId && currentId !== leadId && nextLeads.some((lead) => lead.id === currentId)) return currentId;
        const laterPending = nextLeads.slice(Math.max(removedIndex, 0)).find((lead) => statusForLead(lead) === 'pending');
        const firstPending = nextLeads.find((lead) => statusForLead(lead) === 'pending');
        return laterPending?.id ?? firstPending?.id ?? nextLeads[0]?.id ?? null;
      });
      return nextLeads;
    });
    setActiveLeadSnapshot((snapshot) => (snapshot?.id === leadId ? null : snapshot));
  }, [currentWorkspaceId]);

  const placeDiallerLeadCall = useCallback(async ({
    leadId,
    doubleDial = false,
  }: PlaceDiallerLeadCallOptions): Promise<{ ok: boolean; message: string }> => {
    if (!currentWorkspaceId) {
      return { ok: false, message: 'Select a workspace before using the dialler.' };
    }
    if (device.setupState === 'initializing' || startingCall || isPlacingNextCall) {
      return { ok: false, message: 'Dialler is still preparing the current call.' };
    }

    const leadToCall = diallerLeads.find((lead) => lead.id === leadId) ?? null;
    if (!leadToCall || !hasDialablePhone(leadToCall.phone)) {
      return { ok: false, message: 'That lead is no longer dialable.' };
    }

    setIsPlacingNextCall(true);
    setStartingCall(true);

    try {
      if (device.isInCall) {
        device.hangUp();
      }

      setDiallerRunning(false);
      setActiveCallId(null);
      setActiveCallIsDoubleDial(false);
      setActiveLeadId(leadToCall.id);
      setActiveLeadSnapshot({
        id: leadToCall.id,
        name: leadToCall.name ?? null,
        phone: leadToCall.phone ?? null,
        company: leadToCall.company ?? null,
      });

      const response = await fetch('/api/dialer/leads/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          leadId: leadToCall.id,
          tabId,
          doubleDial,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { call?: DialerCall; error?: string };
      if (!response.ok || !data.call) {
        throw new Error(data.error || 'Failed to place the outbound call.');
      }

      setActiveCallId(data.call.id);
      setActiveCallIsDoubleDial(doubleDial);
      setDiallerRunning(true);
      if (!device.isReady) {
        await device.initialize(currentWorkspaceId, tabId);
      }
      await device.startCall(data.call.call_request_id, {
        toNumber: data.call.to_number_e164,
        fromNumber: data.call.from_number_e164,
      });
      return {
        ok: true,
        message:
          doubleDial
            ? `Voicemail detected. Redialing ${leadToCall.name || 'lead'} once.`
            : `Calling ${leadToCall.name || 'next lead'}.`,
      };
    } catch (error) {
      setDiallerRunning(false);
      setActiveCallId(null);
      setActiveCallIsDoubleDial(false);
      return { ok: false, message: error instanceof Error ? error.message : 'Failed to place the outbound call.' };
    } finally {
      setIsPlacingNextCall(false);
      setStartingCall(false);
    }
  }, [currentWorkspaceId, device, diallerLeads, isPlacingNextCall, startingCall, tabId]);

  const placeNextDiallerCall = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (diallerLeads.length === 0) {
      return { ok: false, message: 'Load a dialler list before starting the next call.' };
    }

    const currentLead = activeLeadId
      ? diallerLeads.find((lead) => lead.id === activeLeadId) ?? null
      : null;
    const currentIndex = currentLead ? diallerLeads.findIndex((lead) => lead.id === currentLead.id) : -1;
    const laterPendingLead = diallerLeads
      .slice(Math.max(currentIndex + 1, 0))
      .find((lead) => lead.id !== currentLead?.id && statusForLead(lead) === 'pending' && hasDialablePhone(lead.phone));
    const firstPendingLead = diallerLeads.find(
      (lead) => lead.id !== currentLead?.id && statusForLead(lead) === 'pending' && hasDialablePhone(lead.phone)
    );
    const nextLead = laterPendingLead ?? firstPendingLead;

    if (!nextLead) {
      setDiallerRunning(false);
      setActiveCallId(null);
      setActiveCallIsDoubleDial(false);
      return { ok: false, message: 'No other valid pending leads left.' };
    }

    return placeDiallerLeadCall({ leadId: nextLead.id });
  }, [activeLeadId, diallerLeads, placeDiallerLeadCall]);

  useEffect(() => {
    return () => {
      if (autoDoubleDialTimeoutRef.current) {
        window.clearTimeout(autoDoubleDialTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeCallId || !currentWorkspaceId || !diallerRunning) return;

    let cancelled = false;

    const inspectAmdStatus = async () => {
      try {
        const response = await fetch(
          `/api/dialer/calls/${encodeURIComponent(activeCallId)}?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
          { credentials: 'include' }
        );
        const data = (await response.json().catch(() => ({}))) as { call?: DialerCall };
        if (cancelled || !response.ok || !data.call) return;

        const payload = getDialerCallStatusPayload(data.call);
        const leadId = typeof payload.diallerLeadId === 'string' ? payload.diallerLeadId : activeLeadId;
        const shouldRedial =
          isMachineAnswer(payload.amd?.answeredBy, payload.amd?.isMachine) &&
          payload.doubleDial !== true &&
          !autoDoubleDialCallIdsRef.current.has(data.call.id);

        if (leadId && isTerminalDialerCall(data.call) && getCallOutcome(data.call) !== 'pending' && !shouldRedial) {
          void removeDiallerLeadFromQueue(leadId);
        } else if (leadId) {
          setDiallerLeads((currentLeads) =>
            currentLeads.map((lead) =>
              lead.id === leadId
                ? {
                    ...lead,
                    latest_call_id: data.call!.id,
                    latest_call_status: data.call!.status,
                    latest_call_outcome: getCallOutcome(data.call!),
                    latest_call_answered_at: data.call!.answered_at ?? null,
                    latest_call_ended_at: data.call!.ended_at ?? null,
                    latest_call_created_at: data.call!.created_at,
                    latest_call_recording: getDialerCallRecordingSummary(data.call!),
                  }
                : lead
            )
          );
        }

        if (!shouldRedial || !leadId) return;

        autoDoubleDialCallIdsRef.current.add(data.call.id);
        if (device.isInCall) {
          device.hangUp();
        }
        setDiallerRunning(false);
        setActiveCallId(null);
        setActiveCallIsDoubleDial(false);

        autoDoubleDialTimeoutRef.current = window.setTimeout(() => {
          void placeDiallerLeadCall({ leadId, doubleDial: true });
        }, 900);
      } catch {
        // The status poll is opportunistic; the active call should continue if it fails.
      }
    };

    void inspectAmdStatus();
    const interval = window.setInterval(() => {
      void inspectAmdStatus();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCallId, activeLeadId, currentWorkspaceId, device, diallerRunning, placeDiallerLeadCall, removeDiallerLeadFromQueue]);


  const value = useMemo<DialerRuntimeContextValue>(
    () => ({
      device,
      tabId,
      diallerLeads,
      setDiallerLeads,
      activeLeadId,
      setActiveLeadId,
      activeCallId,
      setActiveCallId,
      activeCallIsDoubleDial,
      setActiveCallIsDoubleDial,
      activeLeadSnapshot,
      setActiveLeadSnapshot,
      callSeconds,
      diallerRunning,
      setDiallerRunning,
      startingCall,
      setStartingCall,
      hangUpActiveCall,
      placeNextDiallerCall,
      isPlacingNextCall,
    }),
    [
      activeCallId,
      activeCallIsDoubleDial,
      activeLeadId,
      activeLeadSnapshot,
      callSeconds,
      device,
      diallerLeads,
      diallerRunning,
      hangUpActiveCall,
      isPlacingNextCall,
      placeNextDiallerCall,
      startingCall,
      tabId,
    ]
  );

  return (
    <DialerRuntimeContext.Provider value={value}>
      {children}
      <PersistentDialerBar />
    </DialerRuntimeContext.Provider>
  );
}

function PersistentDialerBar() {
  const pathname = usePathname();
  const { currentWorkspaceId } = useWorkspace();
  const {
    activeCallId,
    activeCallIsDoubleDial,
    activeLeadId,
    activeLeadSnapshot,
    callSeconds,
    device,
    diallerLeads,
    diallerRunning,
    hangUpActiveCall,
    isPlacingNextCall,
    placeNextDiallerCall,
    setDiallerLeads,
    startingCall,
  } = useDialerRuntime();
  const [demoAction, setDemoAction] = useState<'text' | 'email' | null>(null);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const shouldShow =
    !pathname?.startsWith('/dialer') &&
    (device.isInCall || device.hasIncomingCall || Boolean(activeCallId) || diallerRunning);

  if (!shouldShow) return null;

  const activeLead = activeLeadId
    ? diallerLeads.find((lead) => lead.id === activeLeadId) ?? null
    : null;
  const leadName = device.hasIncomingCall
    ? device.incomingCall?.name?.trim() || 'Incoming call'
    : activeLeadSnapshot?.name?.trim() || 'Dialler call';
  const leadPhone = device.hasIncomingCall
    ? device.incomingCall?.number ? formatPhoneDisplay(device.incomingCall.number) : null
    : activeLeadSnapshot?.phone ? formatPhoneDisplay(activeLeadSnapshot.phone) : null;
  const phaseLabel = device.hasIncomingCall
    ? 'Incoming'
    : device.isConnecting
      ? 'Connecting'
      : device.isInCall
        ? 'Live'
        : device.callPhase === 'ended'
          ? 'Ended'
          : 'Ready';
  const isSendingDemo = demoAction !== null;

  const loadDemoMessage = async (): Promise<DemoMessageResponse> => {
    if (!activeLeadId || !currentWorkspaceId) {
      throw new Error('Open the dialer and select a lead first.');
    }

    const response = await fetch(`/api/dialer/leads/${activeLeadId}/demo-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workspaceId: currentWorkspaceId,
        email: activeLead?.email ?? null,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as DemoMessageResponse;
    if (!response.ok) throw new Error(data.error || 'Failed to prepare demo message.');
    return data;
  };

  const sendDemoText = async () => {
    setDemoAction('text');
    setDemoStatus(null);

    try {
      const data = await loadDemoMessage();
      const body = data.textBody?.trim();
      if (!body || !activeLeadId || !currentWorkspaceId) {
        throw new Error('Demo text is not ready yet.');
      }

      const response = await fetch(`/api/dialer/leads/${activeLeadId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          body,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { warning?: string | null; error?: string };
      if (!response.ok) throw new Error(result.error || 'Failed to send demo text.');
      setDemoStatus(result.warning ?? 'Demo text sent.');
    } catch (error) {
      setDemoStatus(error instanceof Error ? error.message : 'Failed to send demo text.');
    } finally {
      setDemoAction(null);
    }
  };

  const sendDemoEmail = async () => {
    const email = activeLead?.email?.trim();
    if (!email) {
      setDemoStatus('Add an email on the dialer page first.');
      return;
    }

    setDemoAction('email');
    setDemoStatus(null);

    try {
      const data = await loadDemoMessage();
      if (!activeLeadId || !currentWorkspaceId || !data.emailBody?.trim()) {
        throw new Error('Demo email is not ready yet.');
      }

      const response = await fetch('/api/dialer/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: activeLeadId,
          email,
          saveContact: true,
          sendDemoEmail: true,
          demoEmailSubject: data.emailSubject,
          demoEmailBody: data.emailBody,
          demoLinkToken: data.demoLinkToken,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        lead?: DiallerLead;
        warning?: string | null;
        error?: string;
      };
      if (!response.ok || !result.lead) throw new Error(result.error || 'Failed to send demo email.');

      setDiallerLeads((currentLeads) =>
        currentLeads.map((lead) => (lead.id === result.lead!.id ? result.lead! : lead))
      );
      setDemoStatus(result.warning ?? 'Demo email sent.');
    } catch (error) {
      setDemoStatus(error instanceof Error ? error.message : 'Failed to send demo email.');
    } finally {
      setDemoAction(null);
    }
  };

  return (
    <div className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] w-[min(calc(100vw-1.5rem),21rem)] overflow-hidden rounded-lg border border-neutral-200 bg-white/95 text-neutral-950 shadow-2xl shadow-neutral-300/70 backdrop-blur sm:right-4 sm:top-[calc(env(safe-area-inset-top)+1rem)]">
      <div className="flex items-start gap-2 border-b border-neutral-200 px-3 py-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-950 text-white">
          <PhoneCall className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold leading-5">{leadName}</span>
            <span className="shrink-0 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-[11px] leading-none text-neutral-700">{phaseLabel}</span>
            {activeCallIsDoubleDial ? (
              <span className="shrink-0 rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold leading-none text-neutral-800">
                Double dial
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {[leadPhone, formatCallClock(callSeconds)].filter(Boolean).join(' | ')}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2">
        {device.hasIncomingCall ? (
          <>
            <Button
              type="button"
              onClick={() => void device.answerIncomingCall()}
              className="h-9 min-w-0 bg-neutral-950 px-2 text-xs font-semibold text-white hover:bg-neutral-800"
            >
              <PhoneIncoming className="h-3.5 w-3.5 shrink-0" />
              Answer
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={device.rejectIncomingCall}
              className="h-9 min-w-0 border-neutral-300 bg-white px-2 text-xs font-semibold text-neutral-950 hover:border-neutral-950 hover:bg-neutral-100"
            >
              <PhoneOff className="h-3.5 w-3.5 shrink-0" />
              Decline
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={hangUpActiveCall}
            disabled={!device.isInCall && !activeCallId}
            className="h-9 min-w-0 border-neutral-300 bg-white px-2 text-xs font-semibold text-neutral-950 hover:border-neutral-950 hover:bg-neutral-100 disabled:border-neutral-300 disabled:text-neutral-400"
          >
            <PhoneOff className="h-3.5 w-3.5 shrink-0" />
            Hang up
          </Button>
        )}
        {!device.hasIncomingCall ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void placeNextDiallerCall()}
            disabled={device.setupState === 'initializing' || startingCall || isPlacingNextCall}
            className="h-9 min-w-0 border-neutral-300 bg-white px-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-100 disabled:text-neutral-400"
          >
            {isPlacingNextCall || startingCall ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            Next call
          </Button>
        ) : null}
        <Button asChild className="h-9 min-w-0 bg-neutral-950 px-2 text-xs font-semibold text-white hover:bg-neutral-800">
          <Link href="/dialer">
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
            More
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 border-t border-neutral-200 p-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void sendDemoText()}
          disabled={isSendingDemo || !activeLeadId || !currentWorkspaceId}
          className="h-9 min-w-0 border-neutral-300 bg-white px-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-100 disabled:text-neutral-400"
        >
          {demoAction === 'text' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          )}
          Text demo
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void sendDemoEmail()}
          disabled={isSendingDemo || !activeLeadId || !currentWorkspaceId}
          className="h-9 min-w-0 border-neutral-300 bg-white px-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-100 disabled:text-neutral-400"
        >
          {demoAction === 'email' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Mail className="h-3.5 w-3.5 shrink-0" />
          )}
          Email demo
        </Button>
      </div>
      {demoStatus ? (
        <div className="border-t border-neutral-200 px-3 py-2 text-xs leading-5 text-neutral-600">
          {demoStatus}
        </div>
      ) : null}
    </div>
  );
}
