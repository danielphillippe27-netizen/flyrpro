'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ChevronRight, Loader2, MoreHorizontal, PhoneCall, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTwilioDevice } from '@/lib/hooks/useTwilioDevice';
import { formatPhoneDisplay, normalizePhoneNumber } from '@/lib/dialer/phone';
import { useWorkspace } from '@/lib/workspace-context';
import type { DialerCall, DiallerLead } from '@/types/database';

type DialerDevice = ReturnType<typeof useTwilioDevice>;

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
  if (!lead.disposition) return 'pending';
  return lead.disposition === 'dnc' ? 'skipped' : 'called';
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

export function useDialerRuntime() {
  const runtime = useContext(DialerRuntimeContext);
  if (!runtime) {
    throw new Error('useDialerRuntime must be used within DialerRuntimeProvider');
  }
  return runtime;
}

export function DialerRuntimeProvider({ children }: { children: ReactNode }) {
  const { currentWorkspaceId } = useWorkspace();
  const device = useTwilioDevice();
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
    }
    setDiallerRunning(false);
    setActiveCallId(null);
    setActiveCallIsDoubleDial(false);
  }, [device]);

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

      if (!device.isReady) {
        await device.initialize(currentWorkspaceId, tabId);
      }

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
      await device.startCall(data.call.call_request_id);
      return {
        ok: true,
        message: doubleDial ? `Voicemail detected. Redialing ${leadToCall.name || 'lead'} once.` : `Calling ${leadToCall.name || 'next lead'}.`,
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
        const shouldRedial =
          isMachineAnswer(payload.amd?.answeredBy, payload.amd?.isMachine) &&
          payload.doubleDial !== true &&
          !autoDoubleDialCallIdsRef.current.has(data.call.id);
        const leadId = typeof payload.diallerLeadId === 'string' ? payload.diallerLeadId : activeLeadId;

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
  }, [activeCallId, activeLeadId, currentWorkspaceId, device, diallerRunning, placeDiallerLeadCall]);


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
  const {
    activeCallId,
    activeCallIsDoubleDial,
    activeLeadSnapshot,
    callSeconds,
    device,
    diallerRunning,
    hangUpActiveCall,
    isPlacingNextCall,
    placeNextDiallerCall,
    startingCall,
  } = useDialerRuntime();
  const shouldShow = !pathname?.startsWith('/dialer') && (device.isInCall || Boolean(activeCallId) || diallerRunning);

  if (!shouldShow) return null;

  const leadName = activeLeadSnapshot?.name?.trim() || 'Dialler call';
  const leadPhone = activeLeadSnapshot?.phone ? formatPhoneDisplay(activeLeadSnapshot.phone) : null;
  const phaseLabel = device.isConnecting ? 'Connecting' : device.isInCall ? 'Live' : device.callPhase === 'ended' ? 'Ended' : 'Ready';

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
        <Button asChild className="h-9 min-w-0 bg-neutral-950 px-2 text-xs font-semibold text-white hover:bg-neutral-800">
          <Link href="/dialer">
            <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
            More
          </Link>
        </Button>
      </div>
    </div>
  );
}
