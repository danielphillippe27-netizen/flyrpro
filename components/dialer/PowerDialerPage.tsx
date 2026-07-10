'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Download, ListPlus, Loader2, Mail, MessageSquare, Mic, Pause, PhoneIncoming, PhoneOff, Play, Save, Send, Star, Trash2, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDialerRuntime } from '@/components/dialer/DialerRuntimeProvider';
import {
  buildCustomSmartListOption,
  filterContactsBySmartList,
  type SmartListOption,
} from '@/components/crm/smart-list-utils';
import {
  PHONE_MARKET_LABELS,
  SUPPORTED_PHONE_MARKETS,
  formatPhoneDisplay,
  normalizePhoneNumber,
  phoneMarketFromCountryCode,
  type PhoneNormalizationResult,
  type SupportedPhoneMarket,
} from '@/lib/dialer/phone';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { ContactsService } from '@/lib/services/ContactsService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { FarmService } from '@/lib/services/FarmService';
import { SmartListsService } from '@/lib/services/SmartListsService';
import { createClient } from '@/lib/supabase/client';
import type { CampaignV2, Contact, DialerCall, DiallerLead, DiallerLeadDisposition, Farm } from '@/types/database';
import type { SmartListCriteria } from '@/types/smart-lists';

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
  salesperson?: {
    id: string | null;
    fullName: string | null;
    email: string | null;
  } | null;
};

type DiallerLeadStatus = 'pending' | 'completed' | 'no_answer' | 'answered' | 'skipped';
type PlaceCallOptions = {
  doubleDial?: boolean;
  forceLeadId?: string;
  redialAfterEnd?: boolean;
};
type DiallerListOption = SmartListOption & {
  contacts: Contact[];
  count: number;
  dialableCount: number;
  areaOptions: DiallerAreaOption[];
};
type DiallerAreaOption = {
  id: string;
  label: string;
  description: string;
  countryCode: string | null;
  areaCode: string | null;
  contacts: Contact[];
  count: number;
  dialableCount: number;
};
type DemoAudience = 'team' | 'solo';
type DiallerImportResponse = {
  leads?: DiallerLead[];
  importedCount?: number;
  error?: string;
};

const DIALER_OUTLINE_BUTTON_CLASS =
  'border-border bg-background text-foreground hover:bg-muted hover:text-foreground disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 dark:bg-card dark:hover:bg-muted/80 dark:disabled:bg-muted/50';
const DIALER_PRIMARY_BUTTON_CLASS =
  'bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90 dark:disabled:bg-muted/50';
const DIALER_INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/30 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 dark:bg-card dark:disabled:bg-muted/50';
const DIALER_SELECTED_BUTTON_CLASS =
  'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:border-foreground dark:bg-foreground dark:text-background dark:hover:bg-foreground/90';
const ALL_LEADS_LIST_ID = 'all';
const TEST_LEAD = {
  name: 'Daniel Phillippe',
  phone: '289-675-2788',
  company: 'Test Lead',
  email: null,
};
const AUTO_NEXT_CALL_DELAY_MS = 1800;
const DEMO_AUDIENCE_OPTIONS: Array<{ value: DemoAudience; label: string; description: string }> = [
  { value: 'team', label: 'Team', description: 'Demo 1' },
  { value: 'solo', label: 'Solo', description: 'Demo 2' },
];

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

function getFirstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || '';
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function getRepFirstName(dialerAccess: DialerAccessResponse | null): string {
  const fullName = dialerAccess?.salesperson?.fullName?.trim();
  const emailName = dialerAccess?.salesperson?.email?.split('@')[0]?.split(/[._+-]/)[0]?.trim();
  return titleCaseName(getFirstName(fullName) || emailName || '');
}

function getLeadRecordingExportHref(lead: DiallerLead | null | undefined, workspaceId: string | null | undefined): string | null {
  if (!lead?.latest_call_recording?.available || !workspaceId) return null;
  const params = new URLSearchParams({ workspaceId });
  return `/api/dialer/leads/${encodeURIComponent(lead.id)}/recording?${params.toString()}`;
}

function formatRecordingDuration(totalSeconds: number | null | undefined): string | null {
  if (!totalSeconds || totalSeconds < 1) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildTextDropBody(lead: DiallerLead, repName: string): string {
  const rep = repName || 'your FLYR rep';
  return `Hey there, its ${rep} with FLYR can you give me a call back when you get a chance !`;
}

function inferDemoAudience(lead: DiallerLead | null | undefined): DemoAudience {
  if (!lead) return 'team';
  const haystack = `${lead.name ?? ''} ${lead.company ?? ''} ${lead.notes ?? ''}`.toLowerCase();
  if (haystack.includes('classification: individual_agent') || haystack.includes('individual_agent')) return 'solo';
  if (haystack.includes('real_estate_individual_agent')) return 'solo';
  return 'team';
}

function getTwoDayFollowUpAt(): string {
  const followUpAt = new Date();
  followUpAt.setDate(followUpAt.getDate() + 2);
  followUpAt.setHours(9, 0, 0, 0);
  return followUpAt.toISOString();
}

function statusForLead(lead: DiallerLead): DiallerLeadStatus {
  if (lead.disposition === 'dnc') return 'skipped';
  if (lead.latest_call_outcome === 'answered') return 'answered';
  if (lead.disposition === 'interested' || lead.disposition === 'callback') return 'answered';
  if (lead.disposition === 'not_now') return 'no_answer';
  if (lead.called_at) return 'completed';
  if (lead.latest_call_outcome === 'no_answer') return 'no_answer';
  return 'pending';
}

function leadStatusLabel(status: DiallerLeadStatus): string {
  switch (status) {
    case 'no_answer':
      return 'No Answer';
    case 'answered':
      return 'Answered';
    case 'skipped':
      return 'Skipped';
    case 'completed':
      return 'Completed';
    default:
      return 'Pending';
  }
}

function leadStatusPillClass(status: DiallerLeadStatus): string {
  switch (status) {
    case 'answered':
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200';
    case 'no_answer':
    case 'skipped':
      return 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-200';
    case 'completed':
      return 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-200';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
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

function hasDialablePhone(value: string | null | undefined, phoneMarket: SupportedPhoneMarket = 'US'): boolean {
  return normalizePhoneNumber(value, phoneMarket).isValid;
}

function isWorkedContact(contact: Contact): boolean {
  return Boolean(contact.last_contacted) || contact.status !== 'new';
}

function buildListCriteria(baseKind: SmartListCriteria['baseKind'], overrides?: Partial<SmartListCriteria>): SmartListCriteria {
  return {
    baseKind,
    source: '',
    tags: [],
    campaignIds: [],
    farmIds: [],
    contactIds: [],
    ...overrides,
  };
}

function getContactPhoneMetadata(contact: Contact, fallbackMarket: SupportedPhoneMarket): PhoneNormalizationResult {
  return normalizePhoneNumber(
    contact.phone_e164?.trim() || contact.phone,
    contact.phone_country_code ? phoneMarketFromCountryCode(contact.phone_country_code) : fallbackMarket
  );
}

function areaSortKey(contact: Contact, fallbackMarket: SupportedPhoneMarket): string {
  const phone = getContactPhoneMetadata(contact, fallbackMarket);
  return [
    phone.countryCode ?? contact.phone_country_code ?? 'ZZ',
    phone.areaCode ?? contact.phone_area_code ?? '999',
    contact.full_name ?? '',
  ].join('|');
}

function sortContactsByPhoneArea(contacts: Contact[], fallbackMarket: SupportedPhoneMarket): Contact[] {
  return [...contacts].sort((a, b) => areaSortKey(a, fallbackMarket).localeCompare(areaSortKey(b, fallbackMarket)));
}

function buildAreaOptions(contacts: Contact[], fallbackMarket: SupportedPhoneMarket): DiallerAreaOption[] {
  const groups = new Map<string, DiallerAreaOption>();

  for (const contact of contacts) {
    const phone = getContactPhoneMetadata(contact, fallbackMarket);
    if (!phone.isValid) continue;
    const countryCode = phone.countryCode ?? contact.phone_country_code ?? null;
    const areaCode = phone.areaCode ?? contact.phone_area_code ?? null;
    const label =
      phone.areaLabel ??
      contact.phone_area_label ??
      ([countryCode, areaCode].filter(Boolean).join(' ') || 'Unknown area');
    const key = `${countryCode ?? 'unknown'}:${areaCode ?? 'unknown'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.contacts.push(contact);
      existing.count += 1;
      existing.dialableCount += 1;
      continue;
    }
    groups.set(key, {
      id: key,
      label,
      description: [countryCode, areaCode].filter(Boolean).join(' / ') || 'Parsed phone area',
      countryCode,
      areaCode,
      contacts: [contact],
      count: 1,
      dialableCount: 1,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      contacts: sortContactsByPhoneArea(group.contacts, fallbackMarket),
    }))
    .sort((a, b) =>
      [a.countryCode ?? 'ZZ', a.areaCode ?? '999'].join('|').localeCompare(
        [b.countryCode ?? 'ZZ', b.areaCode ?? '999'].join('|')
      )
    );
}

function buildDiallerAllLeadsList(): SmartListOption {
  return {
    id: ALL_LEADS_LIST_ID,
    name: 'All Leads',
    kind: 'all',
    description: 'People you have actually contacted.',
  };
}

function buildDiallerCampaignListOption(campaign: CampaignV2): SmartListOption {
  return {
    id: `campaign:${campaign.id}`,
    name: campaign.name?.trim() || 'Untitled Campaign',
    kind: 'campaign',
    description: 'Campaign list',
    isCustom: true,
    criteria: buildListCriteria('campaign', { campaignIds: [campaign.id] }),
  };
}

function buildDiallerFarmListOption(farm: Farm): SmartListOption {
  return {
    id: `farm:${farm.id}`,
    name: farm.name?.trim() || 'Untitled Farm',
    kind: 'farm',
    description: 'Farm list',
    isCustom: true,
    criteria: buildListCriteria('farm', { farmIds: [farm.id] }),
  };
}

function parseFocusedLeadIds(value: string | null): string[] {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, 100);
}

function scorePhoneColumn(rows: string[][], columnIndex: number, phoneMarket: SupportedPhoneMarket): number {
  return rows.reduce((score, row) => score + (hasDialablePhone(row[columnIndex], phoneMarket) ? 1 : 0), 0);
}

function findPhoneColumn(headers: string[], rows: string[][], phoneMarket: SupportedPhoneMarket): number {
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
  if (exactPhoneIndex >= 0 && scorePhoneColumn(rows, exactPhoneIndex, phoneMarket) > 0) return exactPhoneIndex;

  const fuzzyIndexes = headers.flatMap((header, index) =>
    header.includes('phone') || header.includes('mobile') || header.includes('cell') || header.includes('telephone') || header === 'tel'
      ? [index]
      : []
  );
  const scored = fuzzyIndexes
    .map((index) => ({ index, score: scorePhoneColumn(rows, index, phoneMarket) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.index ?? -1;
}

function leadsFromCsv(text: string, phoneMarket: SupportedPhoneMarket): Array<{ name: string; phone: string; company: string | null; email: string | null }> {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const nameIndex = findColumn(headers, ['name', 'full_name', 'contact', 'contact_name', 'lead', 'lead_name']);
  const dataRows = rows.slice(1);
  const phoneIndex = findPhoneColumn(headers, dataRows, phoneMarket);
  const companyIndex = findColumn(headers, ['company', 'company_name', 'business', 'organization', 'account']);
  const emailIndex = findColumn(headers, ['email', 'email_address', 'mail']);

  if (phoneIndex === -1) return [];

  return dataRows.flatMap((row) => {
    const phone = row[phoneIndex]?.trim() ?? '';
    const normalizedPhone = normalizePhoneNumber(phone, phoneMarket);
    if (!normalizedPhone.e164) return [];
    return [{
      name: nameIndex >= 0 ? row[nameIndex]?.trim() || 'Lead' : 'Lead',
      phone: normalizedPhone.e164,
      company: companyIndex >= 0 ? row[companyIndex]?.trim() || null : null,
      email: emailIndex >= 0 ? row[emailIndex]?.trim() || null : null,
    }];
  });
}

export function PowerDialerPage() {
  const { currentWorkspaceId, setCurrentWorkspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const {
    activeLeadId,
    activeCallId,
    activeCallIsDoubleDial,
    callSeconds,
    device,
    diallerLeads: leads,
    diallerRunning,
    isPlacingNextCall,
    placeNextDiallerCall,
    setActiveLeadId,
    setActiveCallId,
    setActiveCallIsDoubleDial,
    setActiveLeadSnapshot,
    setDiallerLeads: setLeads,
    setDiallerRunning,
    setStartingCall,
    startingCall,
    tabId,
  } = useDialerRuntime();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const callbackCalledAtRef = useRef<Date | null>(null);
  const doubleDialRetryRef = useRef<{ leadId: string; remaining: number } | null>(null);
  const placeCurrentCallRef = useRef<((options?: PlaceCallOptions) => Promise<void>) | null>(null);
  const hydratedLeadIdRef = useRef<string | null>(null);
  const callWasConnectedRef = useRef(false);

  const [dialerAccess, setDialerAccess] = useState<DialerAccessResponse | null>(null);
  const [dialerAccessLoading, setDialerAccessLoading] = useState(true);
  const [selectedDisposition, setSelectedDisposition] = useState<DiallerLeadDisposition>('interested');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [phoneMarket, setPhoneMarket] = useState<SupportedPhoneMarket>('US');
  const [leadListOptions, setLeadListOptions] = useState<DiallerListOption[]>([]);
  const [loadingLeadLists, setLoadingLeadLists] = useState(false);
  const [addingLeadListId, setAddingLeadListId] = useState<string | null>(null);
  const [followUpName, setFollowUpName] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [followUpChoice, setFollowUpChoice] = useState<'today' | 'tomorrow' | 'custom'>('today');
  const [textBody, setTextBody] = useState('');
  const [selectedDemoAudience, setSelectedDemoAudience] = useState<DemoAudience>('team');
  const [sendingText, setSendingText] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingTestLead, setLoadingTestLead] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [sendingDemoEmail, setSendingDemoEmail] = useState(false);
  const [removingList, setRemovingList] = useState(false);
  const [starringLeadId, setStarringLeadId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isIphone, setIsIphone] = useState(false);

  const focusedLeadIds = useMemo(
    () => parseFocusedLeadIds(searchParams.get('leadIds')),
    [searchParams]
  );
  const focusedListName = searchParams.get('listName')?.trim() || '';
  const focusedWorkspaceId = searchParams.get('workspaceId')?.trim() || '';
  const hasFocusedDialerList = focusedLeadIds.length > 0;
  const pendingLeads = useMemo(
    () => leads.filter((lead) => statusForLead(lead) === 'pending'),
    [leads]
  );
  const completedLeads = useMemo(
    () => leads.filter((lead) => statusForLead(lead) !== 'pending'),
    [leads]
  );

  const activeLead = useMemo(
    () =>
      leads.find((lead) => lead.id === activeLeadId) ??
      pendingLeads[0] ??
      leads[0] ??
      null,
    [activeLeadId, leads, pendingLeads]
  );
  const hasActiveLead = Boolean(activeLead);
  const activeRecordingExportHref = getLeadRecordingExportHref(activeLead, currentWorkspaceId);
  const activeRecordingDuration = formatRecordingDuration(activeLead?.latest_call_recording?.duration_seconds);
  const calledCount = completedLeads.length;
  const connectedCount = completedLeads.filter((lead) => statusForLead(lead) === 'answered').length;
  const remainingCount = pendingLeads.length;
  const repFirstName = getRepFirstName(dialerAccess);
  const micLevelPercent = Math.round(device.micLevel * 100);
  const micSignalActive = device.micLevel > 0.03;
  const micDiagnosticLabel = device.micTrackLabel || device.selectedMicrophone?.label || 'No microphone stream';
  const micDiagnosticStatus =
    device.micTrackState === 'live'
      ? micSignalActive
        ? 'Signal'
        : 'Listening'
      : device.micTrackState === 'muted'
        ? 'Muted'
        : device.micTrackState === 'ended'
          ? 'Ended'
          : device.micTrackState === 'error'
            ? 'Meter unavailable'
            : 'Idle';

  const statusChecks = [
    { label: 'Workspace selected', ok: Boolean(currentWorkspaceId) },
    { label: 'Microphone granted', ok: device.microphoneGranted },
    { label: `${device.provider === 'telnyx' ? 'Telnyx' : 'Legacy'} device ready`, ok: device.isReady },
    { label: 'Shared caller ID', ok: Boolean(dialerAccess?.sharedDefaultDialingEnabled || dialerAccess?.settings?.dedicatedFromNumber) },
  ];

  const loadDiallerLeads = useCallback(async (options?: { silent?: boolean }) => {
    if (!currentWorkspaceId) return;
    if (!options?.silent) setLoadingLeads(true);
    if (!options?.silent) setError(null);

    try {
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId });
      if (focusedLeadIds.length > 0) params.set('leadIds', focusedLeadIds.join(','));

      const response = await fetch(`/api/dialer/leads?${params.toString()}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as {
        leads?: DiallerLead[];
        focusedLeadIds?: string[];
        resolvedWorkspaceId?: string;
        error?: string;
      };
      if (!response.ok) {
        setLeads([]);
        setActiveLeadId(null);
        setError(data.error || `Failed to load dialler leads (${response.status}).`);
        return;
      }

      const nextLeads = data.leads ?? [];
      if (data.resolvedWorkspaceId && data.resolvedWorkspaceId !== currentWorkspaceId) {
        setCurrentWorkspaceId(data.resolvedWorkspaceId);
      }
      setLeads(nextLeads);
      setActiveLeadId((currentId) => {
        if (currentId && nextLeads.some((lead) => lead.id === currentId)) return currentId;
        return nextLeads.find((lead) => statusForLead(lead) === 'pending')?.id ?? nextLeads[0]?.id ?? null;
      });
      if (focusedLeadIds.length > 0) {
        setMessage(
          nextLeads.length > 0
            ? `Loaded ${nextLeads.length} lead${nextLeads.length === 1 ? '' : 's'} from ${focusedListName || 'the selected list'}.`
            : 'No matching dialler leads were found for that list.'
        );
      }
    } catch {
      if (!options?.silent) {
        setLeads([]);
        setActiveLeadId(null);
        setError('Failed to load dialler leads.');
      }
    } finally {
      if (!options?.silent) setLoadingLeads(false);
    }
  }, [currentWorkspaceId, focusedLeadIds, focusedListName, setActiveLeadId, setCurrentWorkspaceId, setLeads]);

  useEffect(() => {
    if (!currentWorkspaceId || leads.length === 0) return;
    if (!activeCallId && !diallerRunning && device.callPhase !== 'ended') return;

    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void loadDiallerLeads({ silent: true });
    };

    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCallId, currentWorkspaceId, device.callPhase, diallerRunning, leads.length, loadDiallerLeads]);

  useEffect(() => {
    if (!activeCallId) {
      callWasConnectedRef.current = false;
      return;
    }
    if (device.callPhase === 'connected') {
      callWasConnectedRef.current = true;
    }
  }, [activeCallId, device.callPhase]);

  useEffect(() => {
    const userAgent = window.navigator.userAgent;
    const platform = window.navigator.platform;
    setIsIphone(/iPhone/.test(userAgent) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1));
  }, []);

  useEffect(() => {
    if (!focusedWorkspaceId || focusedWorkspaceId === currentWorkspaceId) return;
    setCurrentWorkspaceId(focusedWorkspaceId);
  }, [currentWorkspaceId, focusedWorkspaceId, setCurrentWorkspaceId]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/profile', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as { country_code?: string | null };
        if (!cancelled) setPhoneMarket(phoneMarketFromCountryCode(data.country_code));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
  }, [currentWorkspaceId, loadDiallerLeads, setActiveLeadId, setLeads]);

  useEffect(() => {
    if (!activeLead) {
      hydratedLeadIdRef.current = null;
      setNotes('');
      setEmail('');
      setTextBody('');
      setSelectedDisposition('interested');
      setSelectedDemoAudience('team');
      return;
    }
    if (hydratedLeadIdRef.current === activeLead.id) return;
    hydratedLeadIdRef.current = activeLead.id;
    setNotes(activeLead.notes ?? '');
    setEmail(activeLead.email ?? '');
    setTextBody(buildTextDropBody(activeLead, repFirstName));
    setSelectedDisposition(activeLead.disposition ?? 'interested');
    setSelectedDemoAudience(inferDemoAudience(activeLead));
  }, [activeLead, repFirstName]);

  useEffect(() => {
    setActiveLeadSnapshot(
      activeLead
        ? {
            id: activeLead.id,
            name: activeLead.name ?? null,
            phone: activeLead.phone ?? null,
            company: activeLead.company ?? null,
          }
        : null
    );
  }, [activeLead, setActiveLeadSnapshot]);

  const handleInitializeDevice = async () => {
    if (!currentWorkspaceId) return;
    setError(null);
    await device.initialize(currentWorkspaceId, tabId);
  };

  const handleToggleLeadStar = async (lead: DiallerLead) => {
    if (!currentWorkspaceId || starringLeadId) return;
    const nextStarred = !lead.is_starred;
    setStarringLeadId(lead.id);
    setLeads((currentLeads) =>
      currentLeads.map((currentLead) =>
        currentLead.id === lead.id ? { ...currentLead, is_starred: nextStarred } : currentLead
      )
    );
    setError(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: lead.id,
          isStarred: nextStarred,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { lead?: DiallerLead; error?: string };
      if (!response.ok || !data.lead) {
        throw new Error(data.error || 'Failed to update lead star.');
      }
      setLeads((currentLeads) =>
        currentLeads.map((currentLead) =>
          currentLead.id === lead.id ? { ...currentLead, is_starred: data.lead!.is_starred } : currentLead
        )
      );
      setMessage(nextStarred ? 'Lead starred for recordings.' : 'Lead removed from starred recordings.');
    } catch (toggleError) {
      setLeads((currentLeads) =>
        currentLeads.map((currentLead) =>
          currentLead.id === lead.id ? { ...currentLead, is_starred: lead.is_starred } : currentLead
        )
      );
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update lead star.');
    } finally {
      setStarringLeadId(null);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const loadLeadListOptions = async () => {
    if (!currentWorkspaceId) {
      setError('Select a workspace before adding a list.');
      return;
    }

    setLoadingLeadLists(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Sign in before adding a Leads list.');

      const [contactsData, campaignsData, farmsData, smartListsData] = await Promise.all([
        ContactsService.fetchContacts(user.id, currentWorkspaceId),
        CampaignsService.fetchCampaignsV2(user.id, currentWorkspaceId).catch(() => [] as CampaignV2[]),
        FarmService.fetchFarms(user.id, currentWorkspaceId).catch(() => [] as Farm[]),
        SmartListsService.fetchUserWorkspaceSmartLists(currentWorkspaceId, user.id).catch(() => []),
      ]);
      const userContacts = contactsData.filter((contact) => contact.user_id === user.id);

      const smartListOptions = [
        buildDiallerAllLeadsList(),
        ...[...campaignsData]
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(buildDiallerCampaignListOption),
        ...[...farmsData]
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(buildDiallerFarmListOption),
        ...smartListsData.map((list) => buildCustomSmartListOption(list)),
      ];

      const nextOptions = smartListOptions
        .map((list) => {
          const contactsForList =
            list.id === ALL_LEADS_LIST_ID
              ? userContacts.filter(isWorkedContact)
              : filterContactsBySmartList(userContacts, list);
          const areaOptions = buildAreaOptions(contactsForList, phoneMarket);
          return {
            ...list,
            contacts: sortContactsByPhoneArea(contactsForList, phoneMarket),
            count: contactsForList.length,
            dialableCount: areaOptions.reduce((total, area) => total + area.dialableCount, 0),
            areaOptions,
          };
        })
        .filter((list) => list.count > 0);

      setLeadListOptions(nextOptions);
      setListPickerOpen(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Leads lists.');
    } finally {
      setLoadingLeadLists(false);
    }
  };

  const handleAddListFromLeads = () => {
    setListPickerOpen(true);
    void loadLeadListOptions();
  };

  const handleAddLeadListToDialler = async (list: DiallerListOption, area?: DiallerAreaOption) => {
    const contactsForImport = area?.contacts ?? list.contacts;
    const dialableContacts = sortContactsByPhoneArea(contactsForImport, phoneMarket)
      .map((contact) => ({ contact, phone: getContactPhoneMetadata(contact, phoneMarket) }))
      .filter((entry) => entry.phone.e164);
    if (!currentWorkspaceId || dialableContacts.length === 0) return;

    setAddingLeadListId(area ? `${list.id}:${area.id}` : list.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          phoneMarket,
          leads: dialableContacts.map(({ contact, phone }) => ({
            name: contact.full_name?.trim() || 'Lead',
            phone: phone.e164 || contact.phone?.trim() || '',
            company: contact.address?.trim() || null,
            email: contact.email?.trim() || null,
          })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as DiallerImportResponse;
      if (!response.ok) throw new Error(data.error || 'Failed to add this list to the dialler.');

      const importedLeads = data.leads ?? [];
      setLeads((currentLeads) => [...currentLeads, ...importedLeads]);
      setActiveLeadId((currentId) => currentId ?? importedLeads[0]?.id ?? null);
      setMessage(`${data.importedCount ?? importedLeads.length} leads added from ${area ? `${list.name} - ${area.label}` : list.name}.`);
      setListPickerOpen(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Failed to add this list to the dialler.');
    } finally {
      setAddingLeadListId(null);
    }
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file || !currentWorkspaceId) return;

    setImporting(true);
    setError(null);
    setMessage(null);

    try {
      const text = await file.text();
      const parsedLeads = leadsFromCsv(text, phoneMarket);
      if (parsedLeads.length === 0) {
        throw new Error('CSV must include phone plus optional name and company columns.');
      }

      const response = await fetch('/api/dialer/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          phoneMarket,
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

  const handleLoadTestLead = async () => {
    if (!currentWorkspaceId) return;

    const testPhone = normalizePhoneNumber(TEST_LEAD.phone, 'CA').e164;
    const existingTestLead = leads.find(
      (lead) => normalizePhoneNumber(lead.phone).e164 === testPhone && statusForLead(lead) === 'pending'
    );
    if (existingTestLead) {
      setActiveLeadId(existingTestLead.id);
      setError(null);
      setMessage('Test lead selected.');
      return;
    }

    setLoadingTestLead(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/dialer/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          phoneMarket: 'CA',
          testLead: true,
          leads: [TEST_LEAD],
        }),
      });
      const data = (await response.json().catch(() => ({}))) as DiallerImportResponse;
      if (!response.ok) throw new Error(data.error || 'Failed to add test lead.');

      const testLead = data.leads?.[0];
      if (!testLead) throw new Error('Failed to add test lead.');

      setLeads((currentLeads) => [...currentLeads, testLead]);
      setActiveLeadId(testLead.id);
      setMessage('Test lead loaded.');
    } catch (testLeadError) {
      setError(testLeadError instanceof Error ? testLeadError.message : 'Failed to add test lead.');
    } finally {
      setLoadingTestLead(false);
    }
  };

  const markLeadCalledInDiallerQueue = useCallback(async (
    leadId: string,
    options?: { silent?: boolean; callId?: string | null; connected?: boolean }
  ): Promise<boolean> => {
    if (!currentWorkspaceId) return false;

    try {
      let updatedCall: DialerCall | null = null;
      if (options?.callId) {
        const callResponse = await fetch(`/api/dialer/calls/${encodeURIComponent(options.callId)}/hangup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            outcome: options.connected ? 'connected' : 'completed',
          }),
        });
        const callData = (await callResponse.json().catch(() => ({}))) as { call?: DialerCall };
        if (callResponse.ok && callData.call) {
          updatedCall = callData.call;
        }
      }

      const response = await fetch('/api/dialer/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: leadId,
          markCalled: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { lead?: DiallerLead; error?: string };
      if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to mark lead completed.');

      setLeads((currentLeads) => {
        const currentIndex = currentLeads.findIndex((lead) => lead.id === leadId);
        const nextLeads = currentLeads.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                ...data.lead,
                latest_call_id: updatedCall?.id ?? lead.latest_call_id,
                latest_call_status: updatedCall?.status ?? lead.latest_call_status,
                latest_call_outcome: options?.connected
                  ? 'answered'
                  : updatedCall
                  ? updatedCall.answered_at || updatedCall.status === 'answered' || updatedCall.status === 'in-progress'
                    ? 'answered'
                    : updatedCall.status === 'completed'
                      ? updatedCall.answered_at
                        ? 'answered'
                        : 'no_answer'
                      : ['no-answer', 'busy', 'failed', 'canceled'].includes(updatedCall.status ?? '')
                        ? 'no_answer'
                        : lead.latest_call_outcome
                  : lead.latest_call_outcome,
                latest_call_answered_at: updatedCall?.answered_at ?? lead.latest_call_answered_at,
                latest_call_ended_at: updatedCall?.ended_at ?? lead.latest_call_ended_at,
                latest_call_created_at: updatedCall?.created_at ?? lead.latest_call_created_at,
              }
            : lead
        );
        setActiveLeadId((currentId) => {
          if (currentId && currentId !== leadId && nextLeads.some((lead) => lead.id === currentId)) return currentId;
          const laterPending = nextLeads.slice(Math.max(currentIndex + 1, 0)).find((lead) => statusForLead(lead) === 'pending');
          const firstPending = nextLeads.find((lead) => statusForLead(lead) === 'pending');
          return laterPending?.id ?? firstPending?.id ?? nextLeads[0]?.id ?? null;
        });
        return nextLeads;
      });
      return true;
    } catch (removeError) {
      if (!options?.silent) {
        setError(removeError instanceof Error ? removeError.message : 'Failed to mark lead completed.');
      }
      return false;
    }
  }, [currentWorkspaceId, setActiveLeadId, setLeads]);

  const advanceToNextLead = useCallback((updatedLeads: DiallerLead[], currentLeadId: string) => {
    const currentIndex = updatedLeads.findIndex((lead) => lead.id === currentLeadId);
    const laterPending = updatedLeads.slice(Math.max(currentIndex + 1, 0)).find((lead) => statusForLead(lead) === 'pending');
    const firstPending = updatedLeads.find((lead) => statusForLead(lead) === 'pending');
    setActiveLeadId(laterPending?.id ?? firstPending?.id ?? updatedLeads[currentIndex + 1]?.id ?? updatedLeads[0]?.id ?? null);
  }, [setActiveLeadId]);

  const saveLeadDisposition = async ({
    disposition,
    sendLink = false,
    notesOverride,
    followUpNameOverride,
    followUpAt,
    createNotification = false,
    forceAdvance = false,
    suppressAutoAdvance = false,
    successMessage,
    leadOverride,
  }: {
    disposition: DiallerLeadDisposition;
    sendLink?: boolean;
    notesOverride?: string;
    followUpNameOverride?: string | null;
    followUpAt?: string | null;
    createNotification?: boolean;
    forceAdvance?: boolean;
    suppressAutoAdvance?: boolean;
    successMessage: string;
    leadOverride?: DiallerLead;
  }) => {
    const targetLead = leadOverride ?? activeLead;
    if (!targetLead || !currentWorkspaceId) return false;

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
          id: targetLead.id,
          disposition,
          notes: notesOverride ?? (targetLead.id === activeLead?.id ? notes : targetLead.notes ?? ''),
          email: targetLead.id === activeLead?.id ? email : targetLead.email ?? '',
          sendLink,
          demoAudience: targetLead.id === activeLead?.id ? selectedDemoAudience : inferDemoAudience(targetLead),
          followUpName: followUpNameOverride,
          followUpAt,
          createNotification,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { lead?: DiallerLead; error?: string; warning?: string | null };
      if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to save lead.');

      setLeads((currentLeads) => {
        const updatedLeads = currentLeads.map((lead) => (lead.id === data.lead!.id ? data.lead! : lead));
        if (!suppressAutoAdvance || forceAdvance) {
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
    const firstPending = updatedLeads.find(
      (lead) => lead.id !== currentLeadId && statusForLead(lead) === 'pending' && hasDialablePhone(lead.phone)
    );
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
    doubleDialRetryRef.current = null;
    setSelectedDisposition(disposition);
    const successMessage =
      disposition === 'interested'
        ? 'Interested saved. Text link sent.'
        : disposition === 'callback'
          ? 'Follow-up saved.'
          : disposition === 'dnc'
            ? 'Do not call saved.'
            : 'Not interested saved.';
    await saveLeadDisposition({
      disposition,
      sendLink: disposition === 'interested',
      forceAdvance: disposition === 'not_now' || disposition === 'dnc',
      successMessage,
    });
  };

  const handleFollowUp = async () => {
    doubleDialRetryRef.current = null;
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

  const placeCurrentCall = async ({
    doubleDial = false,
    forceLeadId,
    redialAfterEnd = false,
  }: PlaceCallOptions = {}) => {
    const requestedLead = forceLeadId ? leads.find((lead) => lead.id === forceLeadId) ?? null : activeLead;
    if (!requestedLead || !currentWorkspaceId) return;
    if (device.isInCall) {
      setMessage('A call is already active.');
      return;
    }

    setStartingCall(true);
    setError(null);
    setMessage(null);

    try {
      const { updatedLeads, skippedCount } = await skipInvalidPendingLeads();
      const requestedLeadFromQueue = updatedLeads.find((lead) => lead.id === requestedLead.id);
      const leadToCall =
        requestedLeadFromQueue && statusForLead(requestedLeadFromQueue) === 'pending' && hasDialablePhone(requestedLeadFromQueue.phone)
          ? requestedLeadFromQueue
          : forceLeadId
            ? null
            : findNextDialableLead(updatedLeads, requestedLead.id);

      if (!leadToCall) {
        setActiveLeadId(updatedLeads.find((lead) => statusForLead(lead) === 'pending')?.id ?? updatedLeads[0]?.id ?? null);
        setMessage(
          forceLeadId
            ? 'Could not redial this lead. It is no longer pending or dialable.'
            : skippedCount > 0
              ? `Skipped ${skippedCount} invalid phone numbers. No valid pending leads left.`
              : 'No valid pending leads left.'
        );
        return;
      }
      setActiveLeadId(leadToCall.id);

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
      if (!response.ok || !data.call) throw new Error(data.error || 'Failed to place the outbound call.');

      if (redialAfterEnd) {
        doubleDialRetryRef.current = { leadId: leadToCall.id, remaining: 1 };
      }
      setActiveCallId(data.call.id);
      setDiallerRunning(true);
      setActiveCallIsDoubleDial(doubleDial);
      setMessage(
        doubleDial
          ? (redialAfterEnd ? 'Double dial started. Will redial this lead once.' : 'Redial started.')
          : 'Call started.'
      );
      if (!device.isReady) {
        await device.initialize(currentWorkspaceId, tabId);
      }
      await device.startCall(data.call.call_request_id, {
        toNumber: data.call.to_number_e164,
        fromNumber: data.call.from_number_e164,
      });
    } catch (callError) {
      if (redialAfterEnd) {
        doubleDialRetryRef.current = null;
      }
      setDiallerRunning(false);
      setActiveCallId(null);
      setActiveCallIsDoubleDial(false);
      setError(callError instanceof Error ? callError.message : 'Failed to place the outbound call.');
    } finally {
      setStartingCall(false);
    }
  };
  placeCurrentCallRef.current = placeCurrentCall;

  useEffect(() => {
    if (device.callPhase !== 'ended' || !activeCallId) return;

    const retry = doubleDialRetryRef.current;
    const endedLeadId = activeLeadId;
    const shouldKeepDiallerRunning = diallerRunning;
    const wasConnected = callWasConnectedRef.current;
    setActiveCallId(null);
    setActiveCallIsDoubleDial(false);
    callWasConnectedRef.current = false;
    device.resetEndedPhase();

    if (retry && retry.remaining > 0) {
      const retryLead = leads.find((lead) => lead.id === retry.leadId);
      doubleDialRetryRef.current = null;

      if (retryLead && statusForLead(retryLead) === 'pending' && hasDialablePhone(retryLead.phone)) {
        setMessage('Redialing same lead...');
        window.setTimeout(() => {
          void placeCurrentCallRef.current?.({ doubleDial: true, forceLeadId: retry.leadId });
        }, AUTO_NEXT_CALL_DELAY_MS);
        return;
      }

      setDiallerRunning(false);
      setMessage('Double dial stopped. Lead is no longer pending or dialable.');
      return;
    }

    const nextLead = endedLeadId ? findNextDialableLead(leads, endedLeadId) : null;
    if (endedLeadId) {
      void markLeadCalledInDiallerQueue(endedLeadId, { silent: true, callId: activeCallId, connected: wasConnected });
    }

    if (shouldKeepDiallerRunning) {
      if (nextLead) {
        setMessage(`Calling ${nextLead.name || 'next lead'}...`);
        window.setTimeout(() => {
          void placeCurrentCallRef.current?.({ forceLeadId: nextLead.id });
        }, AUTO_NEXT_CALL_DELAY_MS);
        return;
      }

      setDiallerRunning(false);
      setMessage('No valid pending leads left.');
      return;
    }

    setMessage((currentMessage) => currentMessage ?? 'Call ended.');
  }, [
    activeCallId,
    activeLeadId,
    device,
    diallerRunning,
    leads,
    markLeadCalledInDiallerQueue,
    setActiveCallId,
    setActiveCallIsDoubleDial,
    setDiallerRunning,
  ]);

  const handleTextDrop = async () => {
    if (!activeLead || !currentWorkspaceId) return;

    doubleDialRetryRef.current = null;
    const body = textBody.trim();
    if (!body) {
      setError('Write a text before sending it.');
      return;
    }

    const followUpAt = getTwoDayFollowUpAt();
    const followUpLabel = `Follow up with ${activeLead.name || 'lead'}`;
    const nextNotes = [
      notes.trim(),
      `Text drop sent: ${body}`,
      `Follow up: ${followUpLabel} | When: ${new Date(followUpAt).toLocaleString()}`,
    ].filter(Boolean).join('\n');

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
      if (!response.ok) throw new Error(data.error || 'Failed to send text drop.');

      setSelectedDisposition('callback');
      const saved = await saveLeadDisposition({
        disposition: 'callback',
        notesOverride: nextNotes,
        followUpNameOverride: followUpLabel,
        followUpAt,
        createNotification: true,
        suppressAutoAdvance: true,
        successMessage: data.warning ?? 'Text drop sent. Follow-up set for two days from now.',
      });
      if (saved) {
        const nextCall = await placeNextDiallerCall();
        if (nextCall.ok) {
          setError(null);
          setMessage(`${data.warning ?? 'Text drop sent. Follow-up set for two days from now.'} ${nextCall.message}`);
        } else {
          setMessage(data.warning ?? 'Text drop sent. Follow-up set for two days from now.');
          setError(nextCall.message);
        }
      }
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : 'Failed to send text drop.');
    } finally {
      setSendingText(false);
    }
  };

  const handleTextBodyChange = (body: string) => {
    setTextBody(body.slice(0, 1000));
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

  const handleSaveAndSendDemo = async () => {
    if (!activeLead || !currentWorkspaceId) return;

    if (!email.trim()) {
      setError('Add an email before sending the demo.');
      return;
    }

    setSendingDemoEmail(true);
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
          sendDemoEmail: true,
          demoAudience: selectedDemoAudience,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        lead?: DiallerLead;
        contact?: unknown;
        warning?: string | null;
        error?: string;
      };
      if (!response.ok || !data.lead) throw new Error(data.error || 'Failed to send demo email.');

      setLeads((currentLeads) => currentLeads.map((lead) => (lead.id === data.lead!.id ? data.lead! : lead)));
      setMessage(data.warning ?? 'Contact saved. Demo email sent.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to send demo email.');
    } finally {
      setSendingDemoEmail(false);
    }
  };

  const handleRemoveList = async () => {
    if (!currentWorkspaceId || leads.length === 0) return;
    if (!window.confirm('Remove this list from the dialler queue? Your saved Contacts list will not be deleted.')) return;

    doubleDialRetryRef.current = null;
    if (device.isInCall) {
      device.hangUp();
    }

    setRemovingList(true);
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
          ids: hasFocusedDialerList ? leads.map((lead) => lead.id) : undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { deletedCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to remove list from the dialler.');

      setLeads([]);
      setActiveLeadId(null);
      setNotes('');
      setEmail('');
      setDiallerRunning(false);
      setActiveCallId(null);
      setActiveCallIsDoubleDial(false);
      setMessage(`Removed ${data.deletedCount ?? leads.length} leads from the dialler queue.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to remove list from the dialler.');
    } finally {
      setRemovingList(false);
    }
  };

  const handleStartPause = async () => {
    if (!diallerRunning) {
      doubleDialRetryRef.current = null;
      await placeCurrentCall();
      return;
    }

    doubleDialRetryRef.current = null;
    if (device.isInCall) {
      device.hangUp();
    }
    setDiallerRunning(false);
    setActiveCallId(null);
    setActiveCallIsDoubleDial(false);
    setMessage('Dialler paused.');
  };

  const handleNextCall = async () => {
    if (!activeLead) return;

    doubleDialRetryRef.current = null;
    if (statusForLead(activeLead) === 'pending') {
      await markLeadCalledInDiallerQueue(activeLead.id, {
        silent: true,
        callId: activeCallId,
        connected: callWasConnectedRef.current,
      });
    }
    const result = await placeNextDiallerCall();
    if (result.ok) {
      setError(null);
      setMessage(result.message);
      return;
    }
    setMessage(null);
    setError(result.message);
  };

  const handleHangUp = () => {
    doubleDialRetryRef.current = null;
    const leadToComplete = activeLead;
    const callIdToComplete = activeCallId;
    const wasConnected = callWasConnectedRef.current || device.callPhase === 'connected';
    if (device.isInCall) {
      device.hangUp();
    }
    if (leadToComplete && statusForLead(leadToComplete) === 'pending') {
      void markLeadCalledInDiallerQueue(leadToComplete.id, {
        silent: true,
        callId: callIdToComplete,
        connected: wasConnected,
      });
    } else if (callIdToComplete && currentWorkspaceId) {
      void fetch(`/api/dialer/calls/${encodeURIComponent(callIdToComplete)}/hangup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          outcome: wasConnected ? 'connected' : 'completed',
        }),
      }).catch((error) => {
        console.warn('[power-dialer] failed to hang up backend call', error);
      });
    }
    setDiallerRunning(false);
    setActiveCallId(null);
    setActiveCallIsDoubleDial(false);
    callWasConnectedRef.current = false;
    setMessage('Call hung up.');
  };

  const renderLeadRow = (lead: DiallerLead) => {
    const status = statusForLead(lead);
    const isActive = lead.id === activeLead?.id;
    const recordingHref = getLeadRecordingExportHref(lead, currentWorkspaceId);
    const recordingDuration = formatRecordingDuration(lead.latest_call_recording?.duration_seconds);
    return (
      <div
        key={lead.id}
        className={cn(
          'grid min-h-[64px] w-full gap-1.5 px-3 py-3 text-left transition hover:bg-muted/70 sm:grid-cols-[auto_1.2fr_1fr_0.9fr_auto_auto] sm:items-center sm:gap-2 sm:px-4',
          isActive && 'bg-muted'
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleToggleLeadStar(lead)}
          disabled={starringLeadId !== null}
          className="h-8 w-8 justify-self-start text-muted-foreground hover:text-foreground"
          title={lead.is_starred ? 'Remove from starred recordings' : 'Star lead for recordings'}
          aria-label={lead.is_starred ? 'Remove from starred recordings' : 'Star lead for recordings'}
        >
          {starringLeadId === lead.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Star className={cn('h-4 w-4', lead.is_starred && 'fill-amber-400 text-amber-500')} />
          )}
        </Button>
        <button
          type="button"
          onClick={() => setActiveLeadId(lead.id)}
          className="min-w-0 truncate text-left text-sm font-medium text-foreground"
        >
          {lead.name || 'Lead'}
        </button>
        <button
          type="button"
          onClick={() => setActiveLeadId(lead.id)}
          className="min-w-0 truncate text-left text-sm text-muted-foreground"
        >
          {lead.company || '-'}
        </button>
        <button
          type="button"
          onClick={() => setActiveLeadId(lead.id)}
          className="text-left text-sm text-muted-foreground"
        >
          {formatPhoneDisplay(lead.phone)}
        </button>
        <Badge
          variant="outline"
          className={cn('w-fit sm:justify-self-end', leadStatusPillClass(status))}
        >
          {leadStatusLabel(status)}
        </Badge>
        {recordingHref ? (
          <Button
            asChild
            variant="outline"
            size="icon-sm"
            className={cn('h-8 w-8 sm:justify-self-end', DIALER_OUTLINE_BUTTON_CLASS)}
          >
            <a
              href={recordingHref}
              download
              title={recordingDuration ? `Export recording (${recordingDuration})` : 'Export recording'}
              aria-label={recordingDuration ? `Export recording (${recordingDuration})` : 'Export recording'}
            >
              <Download className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <span className="hidden h-8 w-8 sm:block" aria-hidden="true" />
        )}
      </div>
    );
  };

  return (
    <div
      data-device={isIphone ? 'iphone' : undefined}
      className="min-h-[100svh] overflow-x-hidden bg-background px-3 pb-[calc(env(safe-area-inset-bottom)+4rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] text-foreground sm:px-6 sm:pt-4 lg:px-8"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4">
        <div className="-mx-3 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-w-full items-center gap-2">
            {statusChecks.map((check) => (
              <span
                key={check.label}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground shadow-sm shadow-neutral-200/40 dark:shadow-black/20"
              >
                {check.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
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
              className={cn('h-7 shrink-0 touch-manipulation px-2.5 text-[11px]', DIALER_OUTLINE_BUTTON_CLASS)}
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

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-5 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-left sm:text-sm">
          <span><span className="block text-base font-semibold leading-none text-foreground sm:inline sm:text-sm">{calledCount}</span> calls</span>
          <span><span className="block text-base font-semibold leading-none text-foreground sm:inline sm:text-sm">{connectedCount}</span> connected</span>
          <span><span className="block text-base font-semibold leading-none text-foreground sm:inline sm:text-sm">{remainingCount}</span> left</span>
          {dialerAccessLoading || loadingLeads ? (
            <span className="col-span-3 inline-flex items-center justify-center gap-1.5 text-xs sm:col-span-1 sm:justify-start">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing
            </span>
          ) : null}
        </div>

        {(device.microphoneGranted || device.selectedMicrophone) && (
          <div className="grid gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
            <div className="flex min-w-0 items-center gap-2">
              <Mic className="h-4 w-4 shrink-0 text-foreground" />
              <span className="truncate font-medium text-foreground">{micDiagnosticLabel}</span>
              <span className="shrink-0 text-muted-foreground">{micDiagnosticStatus}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-[width]', micSignalActive ? 'bg-foreground' : 'bg-muted-foreground/40')}
                style={{ width: `${Math.max(device.micLevel > 0 ? 6 : 0, micLevelPercent)}%` }}
              />
            </div>
          </div>
        )}

        {(message || error || device.deviceError || device.deviceWarning) && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              error || device.deviceError
                ? 'border-border bg-muted text-foreground'
                : device.deviceWarning
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-border bg-card text-foreground'
            }`}
          >
            {error || device.deviceError || device.deviceWarning || message}
          </div>
        )}

        <section className="rounded-xl border border-border bg-card p-4 shadow-xl shadow-neutral-200/70 dark:shadow-black/30 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {activeLead?.company?.trim() || '—'}
              </div>
              <div className="mt-2 truncate text-[26px] font-semibold leading-tight text-foreground sm:text-[28px]">
                {activeLead?.name?.trim() || '—'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-base text-muted-foreground">
                <span>{activeLead?.phone ? formatPhoneDisplay(activeLead.phone) : '—'}</span>
                {activeCallIsDoubleDial ? (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase leading-none tracking-wide text-foreground">
                    Double dial
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {activeLead ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => void handleToggleLeadStar(activeLead)}
                  disabled={starringLeadId !== null}
                  className={cn('h-10 w-10 touch-manipulation sm:h-9 sm:w-9', DIALER_OUTLINE_BUTTON_CLASS)}
                  title={activeLead.is_starred ? 'Remove from starred recordings' : 'Star lead for recordings'}
                  aria-label={activeLead.is_starred ? 'Remove from starred recordings' : 'Star lead for recordings'}
                >
                  {starringLeadId === activeLead.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Star className={cn('h-4 w-4', activeLead.is_starred && 'fill-amber-400 text-amber-500')} />
                  )}
                </Button>
              ) : null}
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1"
                role="group"
                aria-label="Demo audience"
              >
                {DEMO_AUDIENCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedDemoAudience(option.value)}
                    disabled={!hasActiveLead || saving || savingContact || sendingDemoEmail || startingCall}
                    aria-pressed={selectedDemoAudience === option.value}
                    title={`${option.label} - ${option.description}`}
                    className={cn(
                      'h-8 min-w-16 rounded px-2 text-xs font-bold transition-colors',
                      'text-muted-foreground hover:bg-background hover:text-foreground',
                      'disabled:pointer-events-none disabled:opacity-60',
                      selectedDemoAudience === option.value &&
                        'bg-red-700 text-white shadow-sm ring-1 ring-red-400 hover:bg-red-700 hover:text-white'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {activeRecordingExportHref ? (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn('h-10 touch-manipulation px-3 text-xs font-semibold sm:h-9', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  <a href={activeRecordingExportHref} download>
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Export audio</span>
                    <span className="sm:hidden">Export</span>
                    {activeRecordingDuration ? (
                      <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
                        {activeRecordingDuration}
                      </span>
                    ) : null}
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleLoadTestLead()}
                disabled={!currentWorkspaceId || loadingTestLead || startingCall || isPlacingNextCall}
                className={cn('h-10 touch-manipulation px-3 text-xs font-semibold sm:h-9', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                {loadingTestLead ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Test
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleNextCall()}
                disabled={!hasActiveLead || device.setupState === 'initializing' || startingCall || isPlacingNextCall}
                className={cn('h-10 touch-manipulation px-3 text-xs font-semibold sm:h-9', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                {startingCall || isPlacingNextCall ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                Next call
              </Button>
              <div className="min-w-[46px] text-right font-mono text-xs text-muted-foreground">{formatCallClock(callSeconds)}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={() => void handleDispositionAction('interested')}
              className={cn(
                'h-[58px] touch-manipulation justify-center text-[15px] sm:h-14 sm:text-base',
                DIALER_OUTLINE_BUTTON_CLASS,
                selectedDisposition === 'interested' && DIALER_SELECTED_BUTTON_CLASS
              )}
            >
              {saving && selectedDisposition === 'interested' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Text link
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={openFollowUpTask}
              className={cn(
                'h-[58px] touch-manipulation justify-center text-[15px] sm:h-14 sm:text-base',
                DIALER_OUTLINE_BUTTON_CLASS,
                selectedDisposition === 'callback' && DIALER_SELECTED_BUTTON_CLASS
              )}
            >
              <Clock className="h-4 w-4" />
              Follow up
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={() => void handleDispositionAction('not_now')}
              className={cn(
                'h-[58px] touch-manipulation justify-center text-[15px] sm:h-14 sm:text-base',
                DIALER_OUTLINE_BUTTON_CLASS,
                selectedDisposition === 'not_now' && DIALER_SELECTED_BUTTON_CLASS
              )}
            >
              {saving && selectedDisposition === 'not_now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Not interested
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveLead || saving || startingCall}
              onClick={() => void handleDispositionAction('dnc')}
              className={cn(
                'h-[58px] touch-manipulation justify-center text-[15px] sm:h-14 sm:text-base',
                DIALER_OUTLINE_BUTTON_CLASS,
                selectedDisposition === 'dnc' && DIALER_SELECTED_BUTTON_CLASS
              )}
            >
              {saving && selectedDisposition === 'dnc' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
              Do not call
            </Button>
          </div>

          <div className="mt-3 grid gap-2 sm:mt-4">
            <div className="grid gap-2">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_112px_172px]">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={!hasActiveLead || saving || savingContact || sendingDemoEmail}
                    placeholder="Add email"
                    className={cn('h-12 pl-9 text-base', DIALER_INPUT_CLASS)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 lg:contents">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSaveContact()}
                    disabled={!hasActiveLead || savingContact || saving || sendingDemoEmail || startingCall}
                    className={cn('h-12 touch-manipulation text-sm font-semibold', DIALER_OUTLINE_BUTTON_CLASS)}
                  >
                    {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSaveAndSendDemo()}
                    disabled={!hasActiveLead || savingContact || saving || sendingDemoEmail || startingCall || !email.trim()}
                    className={cn('h-12 touch-manipulation text-sm font-semibold', DIALER_OUTLINE_BUTTON_CLASS)}
                  >
                    {sendingDemoEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    <span className="hidden sm:inline">Save & Send Demo</span>
                    <span className="sm:hidden">Send Demo</span>
                  </Button>
                </div>
              </div>
              <div className="relative">
                <MessageSquare className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={!hasActiveLead || saving || savingContact || sendingDemoEmail}
                  placeholder="Add note"
                  className={cn('min-h-[88px] resize-y pl-9 text-base leading-6', DIALER_INPUT_CLASS)}
                />
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted px-3 py-2">
              <div className="grid min-h-12 gap-2 sm:grid-cols-[minmax(0,1fr)_132px] sm:items-start">
                <label className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                  <span className="shrink-0 pt-2 text-xs font-medium uppercase text-muted-foreground">Text drop</span>
                  <textarea
                    value={textBody}
                    onChange={(event) => handleTextBodyChange(event.target.value)}
                    disabled={!hasActiveLead || sendingText || saving}
                    placeholder={activeLead ? 'Write a text message...' : `Hey there, its ${repFirstName || 'your FLYR rep'} with FLYR can you give me a call back when you get a chance !`}
                    rows={3}
                    className="min-h-[72px] w-full resize-y overflow-y-auto border-0 bg-transparent p-0 py-2 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-100"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleTextDrop()}
                  disabled={!hasActiveLead || sendingText || saving || startingCall || !textBody.trim()}
                  className={cn('h-10 touch-manipulation text-sm font-semibold', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  {sendingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                  Text drop
                </Button>
              </div>
            </div>
          </div>

          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-20 mt-4 sm:static">
            {device.hasIncomingCall ? (
              <div className="mb-2 grid gap-2 rounded-lg border border-border bg-card p-2 shadow-lg shadow-neutral-200/60 sm:grid-cols-[1fr_140px_140px] dark:shadow-black/20">
                <div className="min-w-0 px-2 py-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Incoming call</div>
                  <div className="truncate text-sm font-semibold text-foreground">
                    {device.incomingCall?.name?.trim() || device.incomingCall?.number || 'Telnyx caller'}
                  </div>
                  {device.incomingCall?.number ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {formatPhoneDisplay(device.incomingCall.number)}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  onClick={() => void device.answerIncomingCall()}
                  className={cn('h-[44px] min-h-[44px] touch-manipulation text-base font-semibold', DIALER_PRIMARY_BUTTON_CLASS)}
                >
                  <PhoneIncoming className="h-4 w-4" />
                  Answer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={device.rejectIncomingCall}
                  className={cn('h-[44px] min-h-[44px] touch-manipulation text-base font-semibold', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  <PhoneOff className="h-4 w-4" />
                  Decline
                </Button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_140px_140px]">
              <Button
                type="button"
                onClick={() => void handleStartPause()}
                disabled={device.hasIncomingCall || !hasActiveLead || device.setupState === 'initializing' || startingCall}
                className={cn('h-[52px] min-h-[52px] w-full touch-manipulation text-base font-semibold shadow-lg shadow-neutral-300/70 dark:shadow-black/25 sm:h-12 sm:min-h-12', DIALER_PRIMARY_BUTTON_CLASS)}
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
                onClick={handleHangUp}
                disabled={!device.isInCall && !activeCallId}
                className={cn('h-[52px] min-h-[52px] touch-manipulation text-base font-semibold sm:h-12 sm:min-h-12', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                <PhoneOff className="h-4 w-4" />
                <span className="sm:hidden">End</span>
                <span className="hidden sm:inline">Hang up</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSaveContact()}
                disabled={!hasActiveLead || savingContact || saving || sendingDemoEmail || startingCall}
                className={cn('h-[52px] min-h-[52px] touch-manipulation text-base font-semibold sm:h-12 sm:min-h-12', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </section>

        <Dialog open={listPickerOpen} onOpenChange={setListPickerOpen}>
          <DialogContent
            className="max-w-[calc(100%-1.5rem)] border-border bg-card p-0 text-foreground sm:max-w-2xl"
            showCloseButton={false}
          >
            <DialogHeader className="border-b border-border px-4 py-4 text-left sm:px-5">
              <DialogTitle className="text-xl font-semibold text-foreground">Add list</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto px-4 py-4 sm:px-5">
              {loadingLeadLists ? (
                <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading lists
                </div>
              ) : leadListOptions.length === 0 ? (
                <div className="rounded-lg border border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
                  No Leads lists with contacts found.
                </div>
              ) : (
                <div className="grid gap-2">
                  {leadListOptions.map((list) => {
                    const isAdding = addingLeadListId === list.id;
                    const showAreaOptions = list.areaOptions.length > 1;
                    return (
                      <div key={list.id} className="rounded-lg border border-border bg-background p-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleAddLeadListToDialler(list)}
                          disabled={addingLeadListId !== null || list.dialableCount === 0}
                          className={cn(
                            'h-auto min-h-[64px] w-full justify-between gap-3 px-3 py-3 text-left',
                            DIALER_OUTLINE_BUTTON_CLASS
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">{list.name}</span>
                            <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                              {showAreaOptions ? 'All areas' : list.description}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                            {list.dialableCount}/{list.count}
                          </span>
                        </Button>
                        {showAreaOptions ? (
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                            {list.areaOptions.map((area) => {
                              const areaAdding = addingLeadListId === `${list.id}:${area.id}`;
                              return (
                                <Button
                                  key={area.id}
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleAddLeadListToDialler(list, area)}
                                  disabled={addingLeadListId !== null || area.dialableCount === 0}
                                  className={cn('h-auto min-h-11 justify-between gap-2 px-3 py-2 text-left text-xs', DIALER_OUTLINE_BUTTON_CLASS)}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate font-semibold text-foreground">{area.label}</span>
                                    <span className="block truncate font-normal text-muted-foreground">{area.description}</span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1.5 font-semibold text-muted-foreground">
                                    {areaAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
                                    {area.dialableCount}
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <DialogFooter className="border-t border-border px-4 py-4 sm:flex-row sm:px-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setListPickerOpen(false)}
                disabled={addingLeadListId !== null}
                className={cn('h-11', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
          <DialogContent
            className="max-w-[calc(100%-1.5rem)] border-border bg-card p-0 text-foreground sm:max-w-xl"
            showCloseButton={false}
          >
            <DialogHeader className="border-b border-border px-4 py-4 text-left sm:px-5">
              <DialogTitle className="text-xl font-semibold text-foreground">Callback follow-up</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 px-4 py-4 sm:px-5">
              <Input
                value={followUpName}
                onChange={(event) => setFollowUpName(event.target.value)}
                placeholder="Callback name"
                aria-label="Follow up name"
                className={cn('h-12 text-base', DIALER_INPUT_CLASS)}
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
                    className={cn(
                      'h-11',
                      DIALER_OUTLINE_BUTTON_CLASS,
                      followUpChoice === choice && DIALER_SELECTED_BUTTON_CLASS
                    )}
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
                    className={cn('h-12 text-base', DIALER_INPUT_CLASS)}
                  />
                ) : null}
                <Input
                  type="time"
                  value={followUpTime}
                  onChange={(event) => setFollowUpTime(event.target.value)}
                  aria-label="Follow up time"
                  className={cn('h-12 text-base', DIALER_INPUT_CLASS)}
                />
              </div>
            </div>
            <DialogFooter className="border-t border-border px-4 py-4 sm:flex-row sm:px-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFollowUpOpen(false)}
                disabled={saving}
                className={cn('h-11', DIALER_OUTLINE_BUTTON_CLASS)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleFollowUp()}
                disabled={!hasActiveLead || saving}
                className={cn('h-11', DIALER_PRIMARY_BUTTON_CLASS)}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Create callback
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section className="mt-2">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">People</h2>
                <p className="text-sm text-muted-foreground">
                  {leads.length > 0
                    ? `${pendingLeads.length} pending, ${completedLeads.length} completed.`
                    : 'Add a Leads list or import a CSV to begin.'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
                />
                <Select value={phoneMarket} onValueChange={(value) => setPhoneMarket(value as SupportedPhoneMarket)}>
                  <SelectTrigger aria-label="Phone market" className={cn('h-11 w-[150px]', DIALER_OUTLINE_BUTTON_CLASS)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_PHONE_MARKETS.map((market) => (
                      <SelectItem key={market} value={market}>
                        {PHONE_MARKET_LABELS[market]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddListFromLeads}
                  disabled={!currentWorkspaceId || loadingLeadLists}
                  className={cn('min-h-11 touch-manipulation', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  {loadingLeadLists ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                  <span className="hidden sm:inline">Add List</span>
                  <span className="sm:hidden">Add</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleImportClick}
                  disabled={!currentWorkspaceId || importing}
                  className={cn('min-h-11 touch-manipulation', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <span className="hidden sm:inline">Import List</span>
                  <span className="sm:hidden">Import</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRemoveList()}
                  disabled={!currentWorkspaceId || leads.length === 0 || removingList || importing}
                  className={cn('min-h-11 touch-manipulation', DIALER_OUTLINE_BUTTON_CLASS)}
                >
                  {removingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  <span className="hidden sm:inline">Remove List</span>
                  <span className="sm:hidden">Remove</span>
                </Button>
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-border bg-card">
              {leads.length === 0 ? (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  No leads loaded.
                </div>
              ) : (
                <div>
                  <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Pending calls ({pendingLeads.length})
                  </div>
                  {pendingLeads.length > 0 ? (
                    <div className="divide-y divide-border">
                      {pendingLeads.map(renderLeadRow)}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-sm text-muted-foreground">
                      No pending calls.
                    </div>
                  )}

                  <div className="border-y border-border bg-background px-4 py-3">
                    <div className="h-px bg-border" />
                  </div>

                  <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Completed calls ({completedLeads.length})
                  </div>
                  {completedLeads.length > 0 ? (
                    <div className="divide-y divide-border">
                      {completedLeads.map(renderLeadRow)}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-sm text-muted-foreground">
                      Completed calls will appear here.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
      </div>
    </div>
  );
}
