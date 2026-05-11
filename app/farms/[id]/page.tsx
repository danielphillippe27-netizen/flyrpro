'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DollarSign,
  FileText,
  Home,
  ListTodo,
  Mailbox,
  Megaphone,
  MapPinned,
  Paperclip,
  PlayCircle,
  Plus,
  Search,
  Settings2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { FarmService, FarmTouchService, FarmLeadService, FarmTouchOutcomeService } from '@/lib/services/FarmService';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { ContactsService } from '@/lib/services/ContactsService';
import { FinanceService } from '@/lib/services/FinanceService';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import type {
  CampaignAddress,
  CampaignV2,
  Contact,
  FinanceEntry,
  Farm,
  FarmAddress,
  FarmGoalType,
  FarmTouchAddress,
  FarmLead,
  FarmTouch,
  FarmSessionMode,
  FarmTouchInterval,
  FarmTouchType,
} from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { FarmTouchTypePicker } from '@/components/farms/FarmTouchTypePicker';
import { FarmMapView } from '@/components/farms/FarmMapView';
import { FarmMetaAdsPanel } from '@/components/farms/FarmMetaAdsPanel';
import { FinancePanel } from '@/components/finance/FinancePanel';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';
import { PaywallGuard } from '@/components/PaywallGuard';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import {
  FARM_GOAL_TYPE_OPTIONS,
  FARM_TOUCH_INTERVAL_OPTIONS,
  formatFarmBudget,
  formatFarmCadence,
  formatFarmGoal,
  formatFarmTouchTypeLabel,
  getFarmGoalTarget,
  getFarmGoalType,
  normalizeFarmTouchTypes,
} from '@/lib/farms/config';
import { buildFarmDashboardAnalytics } from '@/lib/farms/analytics';
import { formatDateInput } from '@/lib/farms/plan';
import {
  buildLegacyCampaignText,
  isMissingCampaignColumnErrorMessage,
  parseLegacyCampaignText,
} from '@/lib/campaignLegacyFields';

const MODE_LABELS: Record<FarmSessionMode, string> = {
  doorknock: 'Doorknock',
  flyer: 'Flyer',
  canada_post: 'Canada Post',
  pop_by: 'Pop by',
  letter: 'Letter',
  phone_call: 'Phone call',
  social_ad: 'Social media ad',
  event: 'Event',
};

type ActivityItem =
  | { id: string; type: 'session'; timestamp: string; title: string; description: string; touchId: string }
  | { id: string; type: 'lead'; timestamp: string; title: string; description: string; touchId?: string | null }
  | { id: string; type: 'contact'; timestamp: string; title: string; description: string; touchId?: string | null };

type DashboardScope = 'current_cycle' | 'all_time';
type MapLayerScope = 'all_time' | 'cycle';
type CampaignWithLegacyDescription = CampaignV2 & {
  description?: string | null;
};

const FARM_NOTE_TIMELINE_PREFIX = '__FLYR_FARM_NOTE_TIMELINE_V1__';

type FarmNoteAttachment = {
  name: string;
  url: string;
  type: 'pdf';
};

type FarmNoteEntry = {
  id: string;
  body: string;
  createdAt: string;
  attachment?: FarmNoteAttachment;
};

type FarmNoteTimeline = {
  entries: FarmNoteEntry[];
};

function isFarmNotePlaceholder(value: string): boolean {
  return /^\[farm:[0-9a-f-]+\]$/i.test(value.trim());
}

function isFarmNoteAttachment(value: unknown): value is FarmNoteAttachment {
  const candidate = value as FarmNoteAttachment | null;
  return (
    Boolean(candidate) &&
    candidate?.type === 'pdf' &&
    typeof candidate.name === 'string' &&
    typeof candidate.url === 'string'
  );
}

function parseFarmNoteTimeline(value: string | null | undefined, legacyCreatedAt?: string | null): FarmNoteTimeline {
  const raw = value?.trim();
  if (!raw || isFarmNotePlaceholder(raw)) return { entries: [] };

  if (!raw.startsWith(FARM_NOTE_TIMELINE_PREFIX)) {
    return {
      entries: [
        {
          id: 'legacy-note',
          body: raw,
          createdAt: legacyCreatedAt ?? new Date(0).toISOString(),
        },
      ],
    };
  }

  try {
    const parsed = JSON.parse(raw.slice(FARM_NOTE_TIMELINE_PREFIX.length)) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry): FarmNoteEntry | null => {
            const candidate = entry as Partial<FarmNoteEntry> | null;
            if (
              !candidate ||
              typeof candidate.id !== 'string' ||
              typeof candidate.createdAt !== 'string' ||
              typeof candidate.body !== 'string'
            ) {
              return null;
            }

            return {
              id: candidate.id,
              body: candidate.body,
              createdAt: candidate.createdAt,
              attachment: isFarmNoteAttachment(candidate.attachment) ? candidate.attachment : undefined,
            };
          })
          .filter((entry): entry is FarmNoteEntry => entry !== null)
      : [];

    return { entries };
  } catch {
    return { entries: [] };
  }
}

function buildFarmNoteTimeline(entries: FarmNoteEntry[]): string {
  if (entries.length === 0) return '';
  return `${FARM_NOTE_TIMELINE_PREFIX}${JSON.stringify({ entries })}`;
}

function formatFarmNoteTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Timestamp unavailable';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const percentage = value * 100;
  const digits = percentage < 10 ? 1 : 0;
  return `${percentage.toFixed(digits)}%`;
}

function formatMetricValue(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value >= 10 ? value.toFixed(0) : value.toFixed(digits);
}

function formatCurrencyFromCents(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return 'No activity yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No activity yet';
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

function getFarmAddressText(address: FarmAddress): string {
  if (address.house_number && address.street_name) {
    return `${address.house_number} ${address.street_name}`;
  }
  return address.formatted || '—';
}

function getFarmAddressSearchCandidates(address: FarmAddress): string[] {
  const primaryAddress = getFarmAddressText(address);
  const fullAddress = [
    primaryAddress,
    address.formatted,
    address.locality,
    address.region,
    address.postal_code,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  return Array.from(
    new Set([primaryAddress, address.formatted, fullAddress].map(normalizeSearchText).filter(Boolean))
  );
}

function formatRelativeDueLabel(daysFromNow: number | null): string {
  if (daysFromNow == null) return 'No completed session yet';
  if (daysFromNow < 0) return `Overdue by ${Math.abs(daysFromNow)} day${Math.abs(daysFromNow) === 1 ? '' : 's'}`;
  if (daysFromNow === 0) return 'Due today';
  return `Due in ${daysFromNow} day${daysFromNow === 1 ? '' : 's'}`;
}

function formatCadenceStatusLabel(status: 'on_track' | 'behind' | 'new'): string {
  if (status === 'behind') return 'Behind';
  if (status === 'on_track') return 'On track';
  return 'Building rhythm';
}

function formatEveryDaysLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Not enough data yet';
  const rounded = Math.round(value);
  return `Every ${rounded} day${rounded === 1 ? '' : 's'}`;
}

function formatAgeLabel(days: number | null): string {
  if (days == null) return 'Age unavailable';
  if (days <= 0) return 'Starts today';
  if (days === 1) return '1 day old';
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} old`;
}

function formatSupabaseError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  const candidate = error as {
    message?: string;
    details?: string | null;
    hint?: string | null;
    code?: string;
  } | null;

  const parts = [
    candidate?.message,
    candidate?.details,
    candidate?.hint ? `Hint: ${candidate.hint}` : undefined,
    candidate?.code ? `Code: ${candidate.code}` : undefined,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return parts.length > 0 ? parts.join('\n') : fallback;
}

function isMissingCampaignColumnError(error: unknown, column: 'notes' | 'scripts' | 'flyer_url'): boolean {
  const message = formatSupabaseError(error, '').toLowerCase();
  return isMissingCampaignColumnErrorMessage(message, column);
}

export default function FarmPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const farmId = params.id as string;
  const { currentWorkspaceId } = useWorkspace();
  const [farm, setFarm] = useState<Farm | null>(null);
  const [linkedCampaignId, setLinkedCampaignId] = useState<string | null>(null);
  const [linkedCampaign, setLinkedCampaign] = useState<CampaignV2 | null>(null);
  const [linkedCampaignAddresses, setLinkedCampaignAddresses] = useState<CampaignAddress[]>([]);
  const [addresses, setAddresses] = useState<FarmAddress[]>([]);
  const [touches, setTouches] = useState<FarmTouch[]>([]);
  const [leads, setLeads] = useState<FarmLead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [financeEntries, setFinanceEntries] = useState<FinanceEntry[]>([]);
  const [touchOutcomes, setTouchOutcomes] = useState<FarmTouchAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [overviewScope, setOverviewScope] = useState<DashboardScope>('current_cycle');
  const [mapLayerScope, setMapLayerScope] = useState<MapLayerScope>('all_time');
  const [showMapContactsOverlay, setShowMapContactsOverlay] = useState(true);
  const [selectedMapCycleNumber, setSelectedMapCycleNumber] = useState<string>('latest');
  const [selectedCycleFilter, setSelectedCycleFilter] = useState<string>('all');
  const [selectedTouchFilter, setSelectedTouchFilter] = useState<string>('all');
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [selectedTouch, setSelectedTouch] = useState<FarmTouch | null>(null);
  const [sessionMode, setSessionMode] = useState<FarmSessionMode>('doorknock');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [homesTarget, setHomesTarget] = useState('');
  const [completeNotes, setCompleteNotes] = useState('');
  const [homesReached, setHomesReached] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [mapTabVersion, setMapTabVersion] = useState(0);
  const [configName, setConfigName] = useState('');
  const [configDescription, setConfigDescription] = useState('');
  const [configStartDate, setConfigStartDate] = useState('');
  const [configTouchesPerInterval, setConfigTouchesPerInterval] = useState(500);
  const [configTouchesInterval, setConfigTouchesInterval] = useState<FarmTouchInterval>('month');
  const [configGoalType, setConfigGoalType] = useState<FarmGoalType>('homes_per_cycle');
  const [configGoalTarget, setConfigGoalTarget] = useState(500);
  const [configCycleCompletionWindowDays, setConfigCycleCompletionWindowDays] = useState('');
  const [configTouchTypes, setConfigTouchTypes] = useState<FarmTouchType[]>([]);
  const [configAnnualBudget, setConfigAnnualBudget] = useState('');
  const [configActive, setConfigActive] = useState(true);
  const [homesSearchQuery, setHomesSearchQuery] = useState('');
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [selectedHomeContactAddress, setSelectedHomeContactAddress] = useState<{
    address: string;
    addressId?: string;
  } | null>(null);
  const [creatingLinkedCampaign, setCreatingLinkedCampaign] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [farmCampaignNotes, setFarmCampaignNotes] = useState('');
  const [farmNoteDraft, setFarmNoteDraft] = useState('');
  const [farmNotePdf, setFarmNotePdf] = useState<File | null>(null);
  const [farmNotePdfInputKey, setFarmNotePdfInputKey] = useState(0);
  const [isSavingCampaignNotes, setIsSavingCampaignNotes] = useState(false);
  const [farmScripts, setFarmScripts] = useState('');
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [basicQrBase64, setBasicQrBase64] = useState<string | null>(null);
  const [generatingBasicQr, setGeneratingBasicQr] = useState(false);
  const [generatingQrCodes, setGeneratingQrCodes] = useState(false);
  const [qrScanEventsCount, setQrScanEventsCount] = useState<number | null>(null);
  const legacyCampaignText = parseLegacyCampaignText(
    (linkedCampaign as CampaignWithLegacyDescription | null)?.description
  );
  const currentFlyerUrl = linkedCampaign?.flyer_url ?? legacyCampaignText.flyerUrl ?? null;
  const farmNoteTimeline = useMemo(
    () => parseFarmNoteTimeline(farmCampaignNotes, linkedCampaign?.created_at ?? farm?.created_at),
    [farm?.created_at, farmCampaignNotes, linkedCampaign?.created_at]
  );
  const sortedFarmNoteEntries = useMemo(
    () =>
      [...farmNoteTimeline.entries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [farmNoteTimeline.entries]
  );
  const canAddFarmNote = farmNoteDraft.trim().length > 0 || farmNotePdf !== null;

  const loadData = useCallback(async (resolvedUserId?: string | null) => {
    try {
      const [farmData, addressData, touchData, leadData, contactData, financeData, outcomeData, linkedCampaignResponse] = await Promise.all([
        FarmService.fetchFarm(farmId),
        FarmService.fetchAddresses(farmId),
        FarmTouchService.fetchTouches(farmId),
        FarmLeadService.fetchLeads(farmId),
        resolvedUserId
          ? ContactsService.fetchContacts(resolvedUserId, currentWorkspaceId, { farmId })
          : Promise.resolve([]),
        FinanceService.fetchEntriesForTarget({ farmId }).catch(() => []),
        FarmTouchOutcomeService.fetchOutcomes(farmId).catch(() => []),
        fetch(`/api/farms/${farmId}/campaign`, {
          credentials: 'include',
        })
          .then(async (response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ]);

      setFarm(farmData);
      const resolvedLinkedCampaignId =
        linkedCampaignResponse?.linked_campaign_id ?? farmData?.linked_campaign_id ?? null;
      setLinkedCampaignId(resolvedLinkedCampaignId);
      setAddresses(addressData);
      setTouches(touchData);
      setLeads(leadData);
      setContacts(contactData);
      setFinanceEntries(financeData);
      setTouchOutcomes(outcomeData);

      if (resolvedLinkedCampaignId) {
        try {
          const supabase = createClient();
          const [campaignData, campaignAddressData, scanEventsRes] = await Promise.all([
            CampaignsService.fetchCampaign(resolvedLinkedCampaignId),
            CampaignsService.fetchAddresses(resolvedLinkedCampaignId),
            supabase
              .from('scan_events')
              .select('id', { count: 'exact', head: true })
              .eq('campaign_id', resolvedLinkedCampaignId),
          ]);

          setLinkedCampaign(campaignData);
          setLinkedCampaignAddresses(campaignAddressData);
          setQrScanEventsCount(scanEventsRes.error ? null : (scanEventsRes.count ?? 0));
        } catch (campaignError) {
          console.error('Error loading linked campaign:', campaignError);
          setLinkedCampaign(null);
          setLinkedCampaignAddresses([]);
          setQrScanEventsCount(null);
        }
      } else {
        setLinkedCampaign(null);
        setLinkedCampaignAddresses([]);
        setQrScanEventsCount(null);
      }
    } catch (error) {
      console.error('Error loading farm:', error);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, farmId]);

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const nextUserId = user?.id ?? null;
      setUserId(nextUserId);
      await loadData(nextUserId);
    };
    run();
  }, [currentWorkspaceId, farmId, loadData]);

  useEffect(() => {
    const status = linkedCampaign?.parcel_enrichment_status;
    if (!linkedCampaignId || (status !== 'queued' && status !== 'processing')) return;

    const interval = setInterval(() => {
      void loadData(userId);
    }, 5000);

    return () => clearInterval(interval);
  }, [linkedCampaign?.parcel_enrichment_status, linkedCampaignId, loadData, userId]);

  useEffect(() => {
    if (activeTab === 'map') {
      setMapTabVersion((current) => current + 1);
    }
  }, [activeTab]);

  useEffect(() => {
    if (searchParams.get('tab') === 'social-ads') {
      setActiveTab('social-ads');
    }
  }, [searchParams]);

  const analytics = useMemo(
    () =>
      buildFarmDashboardAnalytics({
        farm,
        addresses,
        touches,
        leads,
        contacts,
        financeEntries,
        touchOutcomes,
      }),
    [addresses, contacts, farm, financeEntries, leads, touchOutcomes, touches]
  );

  const resolvedTouches = analytics.touches;
  const cycleFilterOptions = useMemo(
    () =>
      Array.from(new Set(resolvedTouches.map((touch) => touch.resolvedCycleNumber)))
        .sort((left, right) => right - left)
        .map((cycleNumber) => ({
          value: String(cycleNumber),
          label: `Cycle ${cycleNumber}`,
        })),
    [resolvedTouches]
  );
  const filteredTouches = useMemo(
    () =>
      selectedCycleFilter === 'all'
        ? resolvedTouches
        : resolvedTouches.filter((touch) => String(touch.resolvedCycleNumber) === selectedCycleFilter),
    [resolvedTouches, selectedCycleFilter]
  );
  const completedActivityTouches = useMemo(
    () =>
      filteredTouches.filter((touch) => touch.status === 'completed' || Boolean(touch.completed_date)),
    [filteredTouches]
  );
  const plannedSessionTouches = useMemo(
    () =>
      resolvedTouches
        .filter((touch) => touch.status !== 'completed' && !touch.completed_date)
        .sort((left, right) => new Date(left.scheduled_date).getTime() - new Date(right.scheduled_date).getTime()),
    [resolvedTouches]
  );

  useEffect(() => {
    if (!farm) return;
    setConfigName(farm.name ?? '');
    setConfigDescription(farm.description ?? '');
    setConfigStartDate(formatDateInput(farm.start_date));
    const resolvedGoalType = getFarmGoalType(farm);
    const resolvedGoalTarget = getFarmGoalTarget(farm);
    setConfigTouchesPerInterval(
      resolvedGoalType === 'homes_per_cycle'
        ? resolvedGoalTarget
        : Math.max(1, farm.touches_per_interval ?? farm.frequency ?? 1)
    );
    setConfigTouchesInterval(farm.touches_interval === 'year' ? 'year' : 'month');
    setConfigGoalType(resolvedGoalType);
    setConfigGoalTarget(resolvedGoalTarget);
    setConfigCycleCompletionWindowDays(
      typeof farm.cycle_completion_window_days === 'number'
        ? String(farm.cycle_completion_window_days)
        : ''
    );
    setConfigTouchTypes(normalizeFarmTouchTypes(farm.touch_types));
    setConfigAnnualBudget(
      typeof farm.annual_budget_cents === 'number'
        ? String(farm.annual_budget_cents / 100)
        : ''
    );
    setConfigActive(farm.is_active !== false);
  }, [farm]);

  useEffect(() => {
    setDestinationUrl(linkedCampaign?.video_url ?? '');
  }, [linkedCampaign?.video_url]);

  useEffect(() => {
    if (linkedCampaign?.notes !== undefined) {
      setFarmCampaignNotes(linkedCampaign.notes ?? '');
    } else {
      setFarmCampaignNotes(legacyCampaignText.notes ?? '');
    }
  }, [legacyCampaignText.notes, linkedCampaign?.notes]);

  useEffect(() => {
    if (linkedCampaign?.scripts !== undefined) {
      setFarmScripts(linkedCampaign.scripts ?? '');
    } else {
      setFarmScripts(legacyCampaignText.scripts ?? '');
    }
  }, [legacyCampaignText.scripts, linkedCampaign?.scripts]);

  const saveLegacyCampaignText = useCallback(
    async (campaignId: string, updates: { notes?: string; scripts?: string; flyerUrl?: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({
          description: buildLegacyCampaignText({
            notes: updates.notes ?? farmCampaignNotes,
            scripts: updates.scripts ?? farmScripts,
            flyerUrl: updates.flyerUrl ?? currentFlyerUrl ?? undefined,
          }),
        })
        .eq('id', campaignId);

      if (error) throw error;
    },
    [currentFlyerUrl, farmCampaignNotes, farmScripts]
  );

  const activityItems = useMemo<ActivityItem[]>(() => {
    const allowedTouchIds =
      selectedCycleFilter === 'all' ? null : new Set(completedActivityTouches.map((touch) => touch.id));
    const sessionItems: ActivityItem[] = completedActivityTouches.map((touch) => ({
      id: `${touch.id}:completed`,
      type: 'session',
      timestamp: touch.completed_date ?? touch.effectiveDate ?? touch.scheduled_date,
      title: `${MODE_LABELS[touch.mode ?? 'doorknock']} session completed`,
      description:
        touch.homes_reached != null
          ? `${touch.homes_reached} homes reached`
          : touch.notes || 'Completed without a recorded home count.',
      touchId: touch.id,
    }));

    return sessionItems
      .filter((item) => (allowedTouchIds ? (item.touchId ? allowedTouchIds.has(item.touchId) : false) : true))
      .filter((item) => selectedTouchFilter === 'all' || item.touchId === selectedTouchFilter)
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  }, [completedActivityTouches, selectedCycleFilter, selectedTouchFilter]);

  useEffect(() => {
    if (selectedTouchFilter === 'all') return;
    if (completedActivityTouches.some((touch) => touch.id === selectedTouchFilter)) return;
    setSelectedTouchFilter('all');
  }, [completedActivityTouches, selectedTouchFilter]);

  useEffect(() => {
    if (resolvedTouches.length === 0) {
      setSelectedMapCycleNumber('latest');
      return;
    }

    const latestCycleNumber = String(Math.max(...resolvedTouches.map((touch) => touch.resolvedCycleNumber), 1));

    if (
      selectedMapCycleNumber === 'latest' ||
      !resolvedTouches.some((touch) => String(touch.resolvedCycleNumber) === selectedMapCycleNumber)
    ) {
      setSelectedMapCycleNumber(latestCycleNumber);
    }
  }, [resolvedTouches, selectedMapCycleNumber]);

  const kpis = useMemo(() => {
    return {
      ...analytics,
      cycleTouches: analytics.currentCycleTouches,
      cycleVisits: analytics.currentCycleVisits,
      cycleContacts: analytics.currentCycleContacts,
      cycleContactRate: analytics.currentCycleContactRate,
      cycleUniqueVisitedHomes: analytics.currentCycleCoverageCount,
      cycleCoverageRate: analytics.currentCycleCoverageRate,
      cycleSpendCents: analytics.currentCycleSpendCents,
      cycleCostPerContactCents: analytics.currentCycleCostPerContactCents,
      cycleAvgHomesPerSession: analytics.currentCycleAvgHomesPerSession,
    };
  }, [analytics]);

  const selectedMapCycleTouches = useMemo(
    () =>
      resolvedTouches.filter((touch) => String(touch.resolvedCycleNumber) === selectedMapCycleNumber),
    [resolvedTouches, selectedMapCycleNumber]
  );
  const selectedMapCycleTouchIds = useMemo(
    () => selectedMapCycleTouches.map((touch) => touch.id),
    [selectedMapCycleTouches]
  );
  const selectedMapCycleLabel = useMemo(() => {
    if (selectedMapCycleTouches[0]) {
      return `Cycle ${selectedMapCycleTouches[0].resolvedCycleNumber}`;
    }
    if (selectedMapCycleNumber !== 'latest') {
      return `Cycle ${selectedMapCycleNumber}`;
    }
    return kpis.currentCycleLabel;
  }, [kpis.currentCycleLabel, selectedMapCycleNumber, selectedMapCycleTouches]);
  const selectedMapCycleSelectValue = useMemo(() => {
    if (cycleFilterOptions.some((cycle) => cycle.value === selectedMapCycleNumber)) {
      return selectedMapCycleNumber;
    }
    return cycleFilterOptions[0]?.value ?? '';
  }, [cycleFilterOptions, selectedMapCycleNumber]);

  const overviewSnapshot = useMemo(() => {
    if (overviewScope === 'all_time') {
      return {
        label: 'All Time',
        supportingLabel: analytics.currentCycleLabel,
        coverageRate: kpis.allTimeCoverageRate,
        coverageCount: kpis.allTimeUniqueVisitedHomes,
        visits: kpis.totalVisits,
        contacts: kpis.totalContacts,
        contactRate: kpis.totalContactRate,
        sessions: kpis.allSessionCount,
        avgHomesPerSession: kpis.avgHomesPerSession,
        spendCents: kpis.totalSpendCents,
        costPerContactCents: kpis.costPerContactCents,
      };
    }

    return {
      label: analytics.currentCycleLabel,
      supportingLabel: 'All Time',
      coverageRate: kpis.cycleCoverageRate,
      coverageCount: kpis.cycleUniqueVisitedHomes,
      visits: kpis.cycleVisits,
      contacts: kpis.cycleContacts,
      contactRate: kpis.cycleContactRate,
      sessions: kpis.cycleTouches.length,
      avgHomesPerSession: kpis.cycleAvgHomesPerSession,
      spendCents: kpis.cycleSpendCents,
      costPerContactCents: kpis.cycleCostPerContactCents,
    };
  }, [analytics.currentCycleLabel, kpis, overviewScope]);

  const planningSummary = useMemo(() => {
    if (!farm) {
      return {
        farmAge: 'Age unavailable',
        completedSinceLaunch: 0,
        goal: 'No goal set',
        pace: 'No pace data yet',
        cycleWindow: 'No completion window set',
      };
    }

    const goalType = getFarmGoalType(farm);
    const goalTarget = getFarmGoalTarget(farm);
    const startDate = new Date(farm.start_date);
    const hasValidStartDate = !Number.isNaN(startDate.getTime());
    const ageDays = hasValidStartDate
      ? Math.max(0, Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)))
      : null;
    const completedSinceLaunch = resolvedTouches.filter((touch) => {
      if (touch.status !== 'completed' || !touch.effectiveDate || !hasValidStartDate) return false;
      return new Date(touch.effectiveDate).getTime() >= startDate.getTime();
    }).length;

    let pace = 'No pace data yet';
    if (goalType === 'touches_per_year') {
      if (ageDays != null) {
        const annualizedTouches = ageDays === 0 ? completedSinceLaunch : (completedSinceLaunch / ageDays) * 365;
        pace = `${formatMetricValue(annualizedTouches)} / ${goalTarget} touches per year pace`;
      }
    } else if (goalType === 'touches_per_cycle') {
      pace = `${kpis.cycleTouches.length.toLocaleString()} / ${goalTarget.toLocaleString()} touches in ${kpis.currentCycleLabel.toLowerCase()}`;
    } else {
      pace = `${kpis.cycleVisits.toLocaleString()} / ${goalTarget.toLocaleString()} homes in ${kpis.currentCycleLabel.toLowerCase()}`;
    }

    return {
      farmAge: formatAgeLabel(ageDays),
      completedSinceLaunch,
      goal: formatFarmGoal(farm),
      pace,
      cycleWindow:
        farm.cycle_completion_window_days != null
          ? `Complete each cycle within ${farm.cycle_completion_window_days} day${farm.cycle_completion_window_days === 1 ? '' : 's'}`
          : 'No completion window set',
    };
  }, [farm, kpis, resolvedTouches]);

  const homesWithContacts = useMemo(() => {
    const farmAddressIdByCampaignAddressId = new Map<string, string>();
    const farmAddressIdsByCandidate = new Map<string, Set<string>>();

    for (const address of addresses) {
      if (address.campaign_address_id) {
        farmAddressIdByCampaignAddressId.set(address.campaign_address_id, address.id);
      }

      for (const candidate of getFarmAddressSearchCandidates(address)) {
        const ids = farmAddressIdsByCandidate.get(candidate) ?? new Set<string>();
        ids.add(address.id);
        farmAddressIdsByCandidate.set(candidate, ids);
      }
    }

    const contactsByAddressId = new Map<string, Contact[]>();

    for (const contact of contacts) {
      const matchedAddressIds = new Set<string>();

      if (contact.address_id) {
        const farmAddressId = farmAddressIdByCampaignAddressId.get(contact.address_id);
        if (farmAddressId) {
          matchedAddressIds.add(farmAddressId);
        }
      }

      const normalizedContactAddress = normalizeSearchText(contact.address);
      if (normalizedContactAddress) {
        farmAddressIdsByCandidate.get(normalizedContactAddress)?.forEach((addressId) => {
          matchedAddressIds.add(addressId);
        });
      }

      matchedAddressIds.forEach((addressId) => {
        const existing = contactsByAddressId.get(addressId) ?? [];
        if (!existing.some((entry) => entry.id === contact.id)) {
          existing.push(contact);
          contactsByAddressId.set(addressId, existing);
        }
      });
    }

    return addresses.map((address) => ({
      ...address,
      matchedContacts: contactsByAddressId.get(address.id) ?? [],
    }));
  }, [addresses, contacts]);

  const filteredHomes = useMemo(() => {
    const query = normalizeSearchText(homesSearchQuery);
    if (!query) return homesWithContacts;

    return homesWithContacts.filter((address) => {
      const searchText = [
        getFarmAddressText(address),
        address.formatted,
        address.postal_code,
        address.street_name,
        address.locality,
        address.region,
        ...address.matchedContacts.flatMap((contact) => [
          contact.full_name,
          contact.phone,
          contact.email,
          contact.address,
        ]),
      ]
        .map(normalizeSearchText)
        .join(' ');

      return searchText.includes(query);
    });
  }, [homesSearchQuery, homesWithContacts]);

  const visibleHomes = useMemo(() => filteredHomes.slice(0, 500), [filteredHomes]);

  const dedupedLinkedCampaignAddresses = useMemo(() => {
    const logicalAddresses = new Map<string, CampaignAddress>();
    const addressKey = (address: CampaignAddress) =>
      `${(address.formatted || address.address || '').trim().toLowerCase()}|${(address.postal_code || '').trim().toLowerCase()}`;

    for (const address of linkedCampaignAddresses) {
      const key = addressKey(address);
      const existing = logicalAddresses.get(key);
      const addressScans = address.scans ?? 0;
      const existingScans = existing?.scans ?? 0;

      if (!existing || addressScans > existingScans) {
        logicalAddresses.set(key, address);
        continue;
      }

      if (addressScans === existingScans) {
        const addressTime = address.last_scanned_at ? new Date(address.last_scanned_at).getTime() : 0;
        const existingTime = existing.last_scanned_at ? new Date(existing.last_scanned_at).getTime() : 0;
        if (addressTime > existingTime || (addressTime === existingTime && address.id < existing.id)) {
          logicalAddresses.set(key, address);
        }
      }
    }

    return Array.from(logicalAddresses.values());
  }, [linkedCampaignAddresses]);

  const homesWithQrScans = useMemo(
    () => dedupedLinkedCampaignAddresses.filter((address) => (address.scans || 0) > 0).length,
    [dedupedLinkedCampaignAddresses]
  );

  const totalQrScans = useMemo(() => {
    const fallbackTotal = Math.max(
      dedupedLinkedCampaignAddresses.reduce((total, address) => total + (address.scans || 0), 0),
      linkedCampaign?.scans || 0
    );
    return Math.max(qrScanEventsCount ?? 0, fallbackTotal);
  }, [dedupedLinkedCampaignAddresses, linkedCampaign?.scans, qrScanEventsCount]);

  const advancedHomesScanned = useMemo(
    () =>
      dedupedLinkedCampaignAddresses
        .filter((address) => (address.scans || 0) > 0)
        .sort((left, right) => {
          const leftTime = left.last_scanned_at ? new Date(left.last_scanned_at).getTime() : 0;
          const rightTime = right.last_scanned_at ? new Date(right.last_scanned_at).getTime() : 0;
          if (rightTime !== leftTime) return rightTime - leftTime;
          return (right.scans || 0) - (left.scans || 0);
        })
        .slice(0, 10),
    [dedupedLinkedCampaignAddresses]
  );

  const handleOpenCreateContact = useCallback((address: FarmAddress) => {
    setSelectedHomeContactAddress({
      address: address.formatted || getFarmAddressText(address),
      addressId: address.campaign_address_id ?? undefined,
    });
    setCreateContactOpen(true);
  }, []);

  const handleCreateLinkedCampaign = useCallback(async (): Promise<string | null> => {
    if (!farm) return null;
    if (linkedCampaignId) return linkedCampaignId;

    setCreatingLinkedCampaign(true);
    try {
      const response = await fetch(`/api/farms/${farm.id}/campaign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to create linked campaign');
      }

      const payload = await response.json();
      const nextCampaignId = payload.linked_campaign_id as string | undefined;
      if (!nextCampaignId) {
        throw new Error('Linked campaign id was not returned');
      }

      setLinkedCampaignId(nextCampaignId);
      let postCreateWarning: string | null = null;

      try {
        const provisionResponse = await fetch('/api/campaigns/provision', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: nextCampaignId,
          }),
        });

        if (!provisionResponse.ok) {
          const payload = await provisionResponse.json().catch(() => null);
          throw new Error(payload?.error || 'Linked campaign provisioning failed');
        }
      } catch (error) {
        postCreateWarning =
          error instanceof Error
            ? error.message
            : 'Linked campaign was created, but provisioning did not finish.';
      }

      try {
        const syncResponse = await fetch(`/api/farms/${farm.id}/sync-addresses`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!syncResponse.ok) {
          const payload = await syncResponse.json().catch(() => null);
          throw new Error(payload?.error || 'Farm home sync failed');
        }
      } catch (error) {
        postCreateWarning =
          postCreateWarning ??
          (error instanceof Error
            ? error.message
            : 'Linked campaign was created, but farm homes did not sync.');
      }

      await loadData(userId);
      if (postCreateWarning) {
        alert(postCreateWarning);
      }
      return nextCampaignId;
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create linked campaign');
      return null;
    } finally {
      setCreatingLinkedCampaign(false);
    }
  }, [farm, linkedCampaignId, loadData, userId]);

  const handleSaveUrl = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;

    setIsSavingUrl(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ video_url: destinationUrl || null })
        .eq('id', campaignId);

      if (error) throw error;

      await loadData(userId);
      alert('Destination URL saved. Farm QR codes now point here.');
    } catch (error) {
      alert(formatSupabaseError(error, 'Failed to save destination URL'));
    } finally {
      setIsSavingUrl(false);
    }
  }, [destinationUrl, handleCreateLinkedCampaign, linkedCampaignId, loadData, userId]);

  const handleAddFarmNote = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;

    const noteBody = farmNoteDraft.trim();
    const attachmentFile = farmNotePdf;
    if (!noteBody && !attachmentFile) return;

    setIsSavingCampaignNotes(true);
    try {
      let attachment: FarmNoteAttachment | undefined;
      const supabase = createClient();

      if (attachmentFile) {
        if (attachmentFile.type !== 'application/pdf') {
          throw new Error('Invalid file type. Use a PDF.');
        }
        if (attachmentFile.size > 10 * 1024 * 1024) {
          throw new Error('File too large. Maximum size is 10MB.');
        }

        const path = `farm-note-attachments/${campaignId}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await supabase.storage.from('flyers').upload(path, attachmentFile, {
          contentType: attachmentFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('flyers').getPublicUrl(path);
        attachment = {
          name: attachmentFile.name,
          url: urlData.publicUrl,
          type: 'pdf',
        };
      }

      const existingEntries = parseFarmNoteTimeline(
        farmCampaignNotes,
        linkedCampaign?.created_at ?? farm?.created_at
      ).entries;
      const nextEntry: FarmNoteEntry = {
        id: crypto.randomUUID(),
        body: noteBody,
        createdAt: new Date().toISOString(),
        attachment,
      };
      const nextNotes = buildFarmNoteTimeline([...existingEntries, nextEntry]);
      const { error } = await supabase.from('campaigns').update({ notes: nextNotes || null }).eq('id', campaignId);

      if (error) {
        if (isMissingCampaignColumnError(error, 'notes')) {
          await saveLegacyCampaignText(campaignId, { notes: nextNotes });
        } else {
          throw error;
        }
      }

      setFarmCampaignNotes(nextNotes);
      setFarmNoteDraft('');
      setFarmNotePdf(null);
      setFarmNotePdfInputKey((value) => value + 1);
      await loadData(userId);
    } catch (error) {
      alert(formatSupabaseError(error, 'Failed to save farm notes'));
    } finally {
      setIsSavingCampaignNotes(false);
    }
  }, [
    farm?.created_at,
    farmCampaignNotes,
    farmNoteDraft,
    farmNotePdf,
    handleCreateLinkedCampaign,
    linkedCampaign?.created_at,
    linkedCampaignId,
    loadData,
    saveLegacyCampaignText,
    userId,
  ]);

  const handleGenerateBasicQr = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;

    setGeneratingBasicQr(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const response = await fetch(`/api/campaigns/${campaignId}/generate-basic-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      const { qrBase64 } = await response.json();
      setBasicQrBase64(qrBase64 ?? null);

      if (qrBase64) {
        const link = document.createElement('a');
        link.href = qrBase64;
        link.download = `farm-${farm?.id ?? campaignId}-basic-qr.png`;
        link.click();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to generate QR code');
    } finally {
      setGeneratingBasicQr(false);
    }
  }, [farm?.id, handleCreateLinkedCampaign, linkedCampaignId]);

  const handleDownloadBasicQr = useCallback(() => {
    if (!basicQrBase64) return;
    const link = document.createElement('a');
    link.href = basicQrBase64;
    link.download = `farm-${farm?.id ?? 'qr'}-basic-qr.png`;
    link.click();
  }, [basicQrBase64, farm?.id]);

  const handleGenerateAdvancedQrs = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;
    if (dedupedLinkedCampaignAddresses.length === 0) {
      alert('No homes are available on the linked campaign yet.');
      return;
    }

    setGeneratingQrCodes(true);
    try {
      const response = await fetch('/api/generate-qrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          trackable: true,
          baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          forceRegenerate: true,
        }),
      });
      const payload = await response.json();

      if (payload.needsUpgrade) {
        setShowPaywall(true);
        return;
      }
      if (!response.ok) {
        if (payload.error === 'MISSING_QR') {
          setMissingQRFlyerId(payload.flyerId || null);
          setShowMissingQRModal(true);
          return;
        }
        throw new Error(payload.error || payload.message || 'Generation failed');
      }

      const rows = dedupedLinkedCampaignAddresses.map((address) => {
        const parts = (address.formatted || address.address || '').split(', ');
        return {
          AddressLine: address.address || parts[0] || '',
          City: address.locality || parts[1] || '',
          Province: address.region || parts[2] || '',
          PostalCode: address.postal_code || '',
        };
      });

      const canvaResponse = await fetch('/api/canva/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          baseUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://flyrpro.app'}/api/scan`,
          rows,
        }),
      });

      if (!canvaResponse.ok) {
        const errorData = await canvaResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to download QR package (HTTP ${canvaResponse.status})`);
      }

      const contentDisposition = canvaResponse.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `farm_qr_${campaignId}.zip`;

      const blob = await canvaResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);

      await loadData(userId);
      alert(`Generated ${payload.count} QR codes and downloaded the full farm QR package.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to generate QR codes');
    } finally {
      setGeneratingQrCodes(false);
    }
  }, [dedupedLinkedCampaignAddresses, handleCreateLinkedCampaign, linkedCampaignId, loadData, userId]);

  const handleAddQR = useCallback(async () => {
    if (!missingQRFlyerId) {
      setShowMissingQRModal(false);
      return;
    }

    try {
      const response = await fetch(`/api/flyers/${missingQRFlyerId}/add-qr`, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to add QR element');
      }

      setShowMissingQRModal(false);
      setMissingQRFlyerId(null);
      await handleGenerateAdvancedQrs();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add QR element');
    }
  }, [handleGenerateAdvancedQrs, missingQRFlyerId]);

  const handleCreateSession = async () => {
    if (!farm) return;
    setSaving(true);
    try {
      await FarmTouchService.createSession({
        farmId: farm.id,
        workspaceId: farm.workspace_id ?? currentWorkspaceId,
        cycleNumber: kpis.currentCycleTouches.length === 0 && kpis.currentCycleNumber === 1
          ? 1
          : kpis.currentCycleNumber + 1,
        mode: sessionMode,
        title: sessionTitle || undefined,
        scheduledDate: new Date(`${sessionDate}T12:00:00`).toISOString(),
        notes: sessionNotes || undefined,
        homesTarget: homesTarget ? Number(homesTarget) : null,
      });
      setSessionDialogOpen(false);
      setSessionTitle('');
      setSessionNotes('');
      setHomesTarget('');
      await loadData(userId);
    } catch (error) {
      console.error('Create farm session:', error);
      alert(error instanceof Error ? error.message : 'Failed to create farm session');
    } finally {
      setSaving(false);
    }
  };

  const handleStartSession = async (touch: FarmTouch) => {
    try {
      await FarmTouchService.startTouch(touch.id);
      await loadData(userId);
    } catch (error) {
      console.error('Start farm session:', error);
      alert(error instanceof Error ? error.message : 'Failed to start farm session');
    }
  };

  const handleOpenComplete = (touch: FarmTouch) => {
    setSelectedTouch(touch);
    setCompleteNotes(touch.notes || '');
    setHomesReached(touch.homes_reached != null ? String(touch.homes_reached) : '');
    setCompleteDialogOpen(true);
  };

  const handleCompleteSession = async () => {
    if (!selectedTouch) return;
    setSaving(true);
    try {
      await FarmTouchService.completeTouch(selectedTouch.id, {
        notes: completeNotes || undefined,
        homesReached: homesReached ? Number(homesReached) : null,
      });
      setCompleteDialogOpen(false);
      setSelectedTouch(null);
      await loadData(userId);
    } catch (error) {
      console.error('Complete farm session:', error);
      alert(error instanceof Error ? error.message : 'Failed to complete farm session');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfiguration = async () => {
    if (!farm) return;
    if (!configName.trim()) {
      alert('Please enter a farm name.');
      return;
    }
    if (!configStartDate) {
      alert('Please choose a start date.');
      return;
    }
    if (!Number.isFinite(configTouchesPerInterval) || configTouchesPerInterval < 1) {
      alert('Please enter at least 1 target home.');
      return;
    }
    if (!Number.isFinite(configGoalTarget) || configGoalTarget < 1) {
      alert('Please enter a valid goal target.');
      return;
    }

    const trimmedBudget = configAnnualBudget.trim();
    const annualBudgetCents = trimmedBudget
      ? Math.round(Number(trimmedBudget.replace(/,/g, '')) * 100)
      : null;
    const trimmedCycleWindow = configCycleCompletionWindowDays.trim();
    const parsedCycleWindow = trimmedCycleWindow ? parseInt(trimmedCycleWindow, 10) : null;
    if (
      trimmedBudget &&
      (!Number.isFinite(annualBudgetCents ?? Number.NaN) || (annualBudgetCents ?? 0) < 0)
    ) {
      alert('Please enter a valid yearly budget.');
      return;
    }
    if (
      trimmedCycleWindow &&
      (!Number.isFinite(parsedCycleWindow ?? Number.NaN) || (parsedCycleWindow ?? 0) < 1)
    ) {
      alert('Please enter a valid completion window in days.');
      return;
    }

    setSavingConfig(true);
    try {
      let campaignSyncError: string | null = null;
      const currentStartDate = new Date(farm.start_date);
      const currentEndDate = new Date(farm.end_date);
      const hasValidFarmRange =
        !Number.isNaN(currentStartDate.getTime()) &&
        !Number.isNaN(currentEndDate.getTime()) &&
        currentEndDate.getTime() > currentStartDate.getTime();
      const durationMs = hasValidFarmRange
        ? currentEndDate.getTime() - currentStartDate.getTime()
        : 365 * 24 * 60 * 60 * 1000;
      const nextEndDate = new Date(new Date(`${configStartDate}T12:00:00`).getTime() + durationMs);

      const resolvedGoalTarget = configGoalType === 'homes_per_cycle' ? configTouchesPerInterval : configGoalTarget;

      await FarmService.updateFarm(farm.id, {
        name: configName.trim(),
        description: configDescription.trim() || null,
        start_date: configStartDate,
        end_date: formatDateInput(nextEndDate),
        frequency: 1,
        touches_per_interval: 1,
        touches_interval: configTouchesInterval,
        goal_type: configGoalType,
        goal_target: resolvedGoalTarget,
        cycle_completion_window_days: parsedCycleWindow,
        touch_types: configTouchTypes,
        annual_budget_cents: annualBudgetCents,
        is_active: configActive,
      });

      if (linkedCampaignId) {
        const campaignSyncResponse = await fetch(`/api/farms/${farm.id}/campaign`, {
          method: 'PATCH',
          credentials: 'include',
        });

        if (!campaignSyncResponse.ok) {
          const payload = await campaignSyncResponse.json().catch(() => null);
          campaignSyncError =
            payload?.error || 'Farm saved, but the linked campaign could not be updated.';
        }
      }

      await loadData(userId);
      if (campaignSyncError) {
        alert(campaignSyncError);
      }
    } catch (error) {
      console.error('Save farm configuration:', error);
      alert(error instanceof Error ? error.message : 'Failed to save farm configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Loading farm...</div>;
  }

  if (!farm) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Farm not found</div>;
  }

  return (
    <div className="min-h-full bg-muted/30 dark:bg-background relative">
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Dashboard</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="homes">Homes</TabsTrigger>
          <TabsTrigger value="leads">Contacts</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="social-ads">Meta Ads</TabsTrigger>
          <TabsTrigger value="qr">QR Codes</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="configure">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">{overviewSnapshot.label}</p>
                  <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
                    <button
                      type="button"
                      onClick={() => setOverviewScope('current_cycle')}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                        overviewScope === 'current_cycle'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {kpis.currentCycleLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewScope('all_time')}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                        overviewScope === 'all_time'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      All Time
                    </button>
                  </div>
                </div>
                <h2 className="text-2xl font-semibold text-foreground">
                  This farm is {formatPercentage(overviewSnapshot.coverageRate)} covered
                </h2>
                <p className="text-sm text-muted-foreground">
                  {overviewSnapshot.contacts.toLocaleString()} contacts made across {overviewSnapshot.sessions.toLocaleString()} sessions.
                  Current contact rate: {formatPercentage(overviewSnapshot.contactRate)}.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                  Coverage: {overviewSnapshot.coverageCount.toLocaleString()} / {kpis.totalHomes.toLocaleString()} homes
                </div>
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                  Efficiency: {formatMetricValue(overviewSnapshot.contacts / Math.max(overviewSnapshot.sessions, 1))} contacts / session
                </div>
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                  Conversion: {formatPercentage(overviewSnapshot.contactRate)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Home className="w-4 h-4" />
                Homes
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{kpis.totalHomes.toLocaleString()}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${kpis.allTimeUniqueVisitedHomes.toLocaleString()} visited all time`
                  : `${kpis.cycleUniqueVisitedHomes.toLocaleString()} visited in ${kpis.currentCycleLabel.toLowerCase()}`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Homes Visited
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{overviewSnapshot.visits.toLocaleString()}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${kpis.cycleVisits.toLocaleString()} in ${kpis.currentCycleLabel.toLowerCase()}`
                  : `${kpis.totalVisits.toLocaleString()} all time`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Contacts Made
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{overviewSnapshot.contacts.toLocaleString()}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${kpis.cycleContacts.toLocaleString()} in ${kpis.currentCycleLabel.toLowerCase()}`
                  : `${kpis.totalContacts.toLocaleString()} all time`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Contact Rate
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{formatPercentage(overviewSnapshot.contactRate)}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${formatPercentage(kpis.cycleContactRate)} in ${kpis.currentCycleLabel.toLowerCase()}`
                  : `${formatPercentage(kpis.totalContactRate)} all time`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ListTodo className="w-4 h-4" />
                Sessions
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{overviewSnapshot.sessions.toLocaleString()}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${kpis.cycleTouches.length.toLocaleString()} in ${kpis.currentCycleLabel}`
                  : `${kpis.allSessionCount.toLocaleString()} all time`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Avg Homes / Session
              </p>
              <div className="mt-4 text-3xl font-semibold text-foreground">{formatMetricValue(overviewSnapshot.avgHomesPerSession)}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${formatMetricValue(kpis.cycleAvgHomesPerSession)} this cycle`
                  : `${formatMetricValue(kpis.avgHomesPerSession)} all time`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Answer Rate
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">
                {formatPercentage(overviewSnapshot.contactRate)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewSnapshot.visits.toLocaleString()} doors / {overviewSnapshot.contacts.toLocaleString()} conversations
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Total Spend
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">{formatCurrencyFromCents(overviewSnapshot.spendCents)}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewSnapshot.spendCents > 0 && overviewSnapshot.costPerContactCents != null
                  ? `${formatCurrencyFromCents(overviewSnapshot.costPerContactCents)} per contact`
                  : 'Add finance entries to track efficiency'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4" />
                Next Touch Due
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">
                {formatDateLabel(kpis.nextTouchDueAt)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatRelativeDueLabel(kpis.nextTouchDaysFromNow)}
              </p>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock3 className="w-4 h-4" />
                Cadence Health
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">
                {formatCadenceStatusLabel(kpis.cadenceStatus)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Target: {formatFarmCadence(farm)}. Actual: {formatEveryDaysLabel(kpis.actualCadenceDays)}.
              </p>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Best Session
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">
                {kpis.bestSession
                  ? `${kpis.bestSession.homes.toLocaleString()} homes`
                  : 'No completed session'}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {kpis.bestSession
                  ? `${kpis.bestSession.contacts.toLocaleString()} contacts in ${kpis.bestSession.touch.title || MODE_LABELS[kpis.bestSession.touch.mode ?? 'doorknock']}`
                  : 'Complete a session to unlock this stat'}
              </p>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Cost Efficiency
              </p>
              <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                <p>Cost / Home: {formatCurrencyFromCents(kpis.costPerHomeVisitedCents)}</p>
                <p>Cost / Contact: {formatCurrencyFromCents(kpis.costPerContactCents)}</p>
                <p>Spend This Month: {formatCurrencyFromCents(kpis.monthSpendCents)}</p>
              </div>
            </div>
          </div>

        </TabsContent>

        <TabsContent value="plan" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Planning outlook</p>
                <h2 className="text-2xl font-semibold text-foreground">Plan the next cycle with pace and timing</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use the farm goal, cadence, and start date to map the next cycles.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                  Next due: {formatDateLabel(kpis.nextTouchDueAt)}
                </div>
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                  Pace: {planningSummary.pace}
                </div>
              </div>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTodo className="w-4 h-4" />
                Planned sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {plannedSessionTouches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No planned sessions waiting to be completed.</p>
              ) : (
                plannedSessionTouches.map((touch) => (
                  <div key={touch.id} className="rounded-xl border border-border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{touch.title || MODE_LABELS[touch.mode ?? 'doorknock']}</p>
                          <Badge variant="secondary">Cycle {touch.resolvedCycleNumber}</Badge>
                          <Badge variant="outline">{MODE_LABELS[touch.mode ?? 'doorknock']}</Badge>
                          <Badge variant={touch.status === 'in_progress' ? 'default' : 'outline'}>
                            {touch.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Scheduled {new Date(touch.scheduled_date).toLocaleString()}
                        </p>
                        {touch.notes ? (
                          <p className="text-sm text-muted-foreground">{touch.notes}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {touch.status === 'scheduled' ? (
                          <Button variant="outline" size="sm" onClick={() => void handleStartSession(touch)}>
                            <PlayCircle className="w-4 h-4 mr-2" />
                            Start
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => handleOpenComplete(touch)}>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Complete
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>Target: {touch.homes_target ?? '—'}</span>
                      <span>Reached: {touch.homes_reached ?? '—'}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <div className="mb-4 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Master Farm Map</h2>
                <p className="text-sm text-muted-foreground">
                  Use the master map as the farm&apos;s long-term memory, then slice it by cycle when you need the operational view.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
                  <button
                    type="button"
                    onClick={() => setMapLayerScope('all_time')}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      mapLayerScope === 'all_time'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Master
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapLayerScope('cycle')}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      mapLayerScope === 'cycle'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Cycle
                  </button>
                </div>
                {mapLayerScope === 'cycle' ? (
                  <Select value={selectedMapCycleSelectValue} onValueChange={setSelectedMapCycleNumber}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Select cycle" />
                    </SelectTrigger>
                    <SelectContent>
                      {cycleFilterOptions.map((cycle) => (
                        <SelectItem key={cycle.value} value={cycle.value}>
                          {cycle.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <Switch
                    id="farm-map-contacts-overlay"
                    checked={showMapContactsOverlay}
                    onCheckedChange={setShowMapContactsOverlay}
                  />
                  <Label htmlFor="farm-map-contacts-overlay" className="cursor-pointer text-sm">
                    Contact overlay
                  </Label>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {mapLayerScope === 'cycle'
                ? `Showing homes last touched during ${selectedMapCycleLabel.toLowerCase()}.`
                : 'Showing cumulative visit state across the farm, with optional contact pins layered on top.'}
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: '560px' }}>
            <FarmMapView
              key={`${farm.id}:${mapTabVersion}:${mapLayerScope}:${selectedMapCycleNumber}`}
              farm={farm}
              addresses={addresses}
              campaignAddresses={linkedCampaignAddresses}
              linkedCampaignId={linkedCampaignId}
              linkedCampaign={linkedCampaign}
              layerScope={mapLayerScope}
              cycleTouchIds={selectedMapCycleTouchIds}
              touchOutcomes={touchOutcomes}
              contacts={contacts}
              showContactsOverlay={showMapContactsOverlay}
              onDataChanged={() => loadData(userId)}
              showOutcomeControls={false}
            />
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-4">
          <div className="bg-card p-4 rounded-xl border border-border space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="cycleFilter">Cycle filter</Label>
                  <Select value={selectedCycleFilter} onValueChange={setSelectedCycleFilter}>
                    <SelectTrigger id="cycleFilter" className="w-[220px]">
                      <SelectValue placeholder="All cycles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All cycles</SelectItem>
                      {cycleFilterOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sessionFilter">Session filter</Label>
                  <Select value={selectedTouchFilter} onValueChange={setSelectedTouchFilter}>
                    <SelectTrigger id="sessionFilter" className="w-[260px]">
                      <SelectValue placeholder="All sessions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sessions</SelectItem>
                      {completedActivityTouches.map((touch) => (
                        <SelectItem key={touch.id} value={touch.id}>
                          {touch.title || MODE_LABELS[touch.mode ?? 'doorknock']} • Cycle {touch.resolvedCycleNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {activityItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed sessions yet for this selection.</p>
              ) : (
                activityItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTodo className="w-4 h-4" />
                Completed sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {completedActivityTouches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed sessions yet for this selection.</p>
              ) : (
                completedActivityTouches.map((touch) => (
                  <div key={touch.id} className="rounded-xl border border-border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{touch.title || MODE_LABELS[touch.mode ?? 'doorknock']}</p>
                          <Badge variant="secondary">Cycle {touch.resolvedCycleNumber}</Badge>
                          <Badge variant="outline">{MODE_LABELS[touch.mode ?? 'doorknock']}</Badge>
                          <Badge variant={touch.status === 'completed' ? 'secondary' : touch.status === 'in_progress' ? 'default' : 'outline'}>
                            {touch.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Scheduled {new Date(touch.scheduled_date).toLocaleString()}
                        </p>
                        {touch.notes ? (
                          <p className="text-sm text-muted-foreground">{touch.notes}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedTouchFilter(touch.id);
                          }}
                        >
                          Filter activity
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span>Target: {touch.homes_target ?? '—'}</span>
                      <span>Reached: {touch.homes_reached ?? '—'}</span>
                      <span>Completed: {touch.completed_date ? new Date(touch.completed_date).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="homes" className="mt-4">
          <div className="bg-card p-4 rounded-xl border border-border">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <MapPinned className="w-4 h-4" />
                  Homes In Farm
                  <Badge variant="secondary" className="text-xs">
                    {addresses.length}
                  </Badge>
                </h2>
                <p className="text-xs text-muted-foreground">
                  Search by address, postal code, or linked contacts.
                </p>
              </div>
              <div className="relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={homesSearchQuery}
                  onChange={(event) => setHomesSearchQuery(event.target.value)}
                  placeholder="Search homes, postal codes, or contacts..."
                  className="pl-9"
                  aria-label="Search homes"
                />
              </div>
            </div>
            {addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No homes have been generated for this farm yet.</p>
            ) : visibleHomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No homes match your search.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Address</th>
                      <th className="pb-2 pr-3 font-medium">Contacts</th>
                      <th className="pb-2 pr-3 font-medium">Postal code</th>
                      <th className="pb-2 pr-3 font-medium">Street</th>
                      <th className="pb-2 pr-3 font-medium">Visits</th>
                      {userId ? <th className="pb-2 pr-3 font-medium">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHomes.map((address) => {
                      const contactsText =
                        address.matchedContacts
                          .map((contact) => contact.full_name || contact.email || contact.phone || 'Unnamed contact')
                          .join(', ') || '—';

                      return (
                        <tr key={address.id} className="border-b border-border/50">
                          <td className="py-2 pr-3">{address.formatted}</td>
                          <td className="py-2 pr-3 max-w-[280px] truncate text-muted-foreground" title={contactsText}>
                            {contactsText}
                          </td>
                          <td className="py-2 pr-3">{address.postal_code || '—'}</td>
                          <td className="py-2 pr-3">{address.street_name || '—'}</td>
                          <td className="py-2 pr-3">{address.visited_count ?? 0}</td>
                          {userId ? (
                            <td className="py-2 pr-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenCreateContact(address)}
                              >
                                Add contact
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filteredHomes.length > visibleHomes.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the first {visibleHomes.length} matching homes.
              </p>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mailbox className="w-4 h-4" />
                Farm Leads
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {leads.length === 0 && contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No farm-linked leads or contacts yet.</p>
              ) : null}

              {leads.length > 0 ? (
                <div className="space-y-3">
                  {leads.map((lead) => (
                    <div key={lead.id} className="rounded-xl border border-border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{lead.name || 'Unnamed lead'}</p>
                          <p className="text-sm text-muted-foreground">Source: {lead.lead_source}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {contacts.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Contacts</p>
                  {contacts.map((contact) => (
                    <div key={contact.id} className="rounded-xl border border-border p-4">
                      <p className="font-medium">{contact.full_name}</p>
                      <p className="text-sm text-muted-foreground">{contact.address || 'No address provided'}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance" className="mt-4 space-y-4">
          <FinancePanel
            targetType="farm"
            targetId={farm.id}
            workspaceId={farm.workspace_id ?? currentWorkspaceId}
            addresses={addresses}
          />
        </TabsContent>

        <TabsContent value="social-ads" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Megaphone className="h-4 w-4" />
                  Meta Ads
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Read-only Meta campaign analytics for Facebook and Instagram ads linked to this farm.
                </p>
              </div>
            </div>
          </div>
          <FarmMetaAdsPanel
            farmId={farm.id}
            workspaceId={farm.workspace_id ?? currentWorkspaceId}
          />
        </TabsContent>

        <TabsContent value="qr" className="mt-4 space-y-4">
          {!linkedCampaignId ? (
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Linked campaign required</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Farm QR codes are stored on this farm&apos;s linked campaign. Create it once to unlock QR generation and analytics.
                </p>
              </div>
              <Button onClick={() => void handleCreateLinkedCampaign()} disabled={creatingLinkedCampaign}>
                {creatingLinkedCampaign ? 'Creating...' : 'Create linked campaign'}
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">QR Destination</h3>
                <div className="flex flex-wrap gap-3">
                  <Input
                    type="url"
                    id="farm-destination-url"
                    placeholder="https://youtube.com/watch?v=..."
                    className="min-w-[200px] flex-1"
                    value={destinationUrl}
                    onChange={(event) => setDestinationUrl(event.target.value)}
                  />
                  <Button onClick={handleSaveUrl} disabled={isSavingUrl} size="sm">
                    {isSavingUrl ? 'Saving...' : 'Link URL'}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Where people go after scanning a farm QR code. Leave empty to use the default welcome page.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Basic QR Code</h3>
                    <p className="max-w-md text-xs text-muted-foreground">
                      One QR code for the whole farm. Scans count toward farm totals, but not a specific home.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={handleGenerateBasicQr} disabled={generatingBasicQr}>
                        {generatingBasicQr ? 'Generating...' : 'Generate QR'}
                      </Button>
                    </div>
                  </div>
                  {basicQrBase64 ? (
                    <div className="flex shrink-0 flex-col items-center gap-2">
                      <img
                        src={basicQrBase64}
                        alt="Farm basic QR code"
                        className="h-48 w-48 rounded-lg border border-border bg-white object-contain"
                      />
                      <button
                        type="button"
                        onClick={handleDownloadBasicQr}
                        className="text-sm font-medium text-red-600 underline underline-offset-2 hover:text-red-500"
                      >
                        Download PNG
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Advanced QR Codes</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Unique QR codes for each home in this farm. Scans are tied to addresses for print matching and follow-up tracking.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void handleGenerateAdvancedQrs()}
                    disabled={generatingQrCodes || dedupedLinkedCampaignAddresses.length === 0}
                  >
                    {generatingQrCodes ? 'Generating...' : 'Generate QR Codes'}
                  </Button>
                  {dedupedLinkedCampaignAddresses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No linked campaign homes are available yet.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">QR Analytics</h2>
                    <p className="text-xs text-muted-foreground">
                      Simple scan totals for this farm&apos;s linked campaign.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void loadData(userId)}>
                    Refresh
                  </Button>
                </div>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Basic QR scans count toward total scans, not homes scanned.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Homes in farm</p>
                    <p className="text-2xl font-semibold text-foreground">
                      {(addresses.length || dedupedLinkedCampaignAddresses.length).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Homes scanned (Advanced QR)</p>
                    <p className="text-2xl font-semibold text-foreground">{homesWithQrScans.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Total QR scans</p>
                    <p className="text-2xl font-semibold text-foreground">{totalQrScans.toLocaleString()}</p>
                  </div>
                </div>
                {qrScanEventsCount === null ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Total scans shown with a fallback estimate when event logs are unavailable.
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Homes Scanned (Advanced)</h3>
                <p className="mt-1 mb-3 text-xs text-muted-foreground">
                  Most recent homes that scanned an advanced farm QR code.
                </p>
                {advancedHomesScanned.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No advanced QR scans yet.</p>
                ) : (
                  <div className="space-y-2">
                    {advancedHomesScanned.map((address) => {
                      const addressText =
                        address.house_number && address.street_name
                          ? `${address.house_number} ${address.street_name}`
                          : (address.address || address.formatted || 'Unknown address');
                      const lastScanned = address.last_scanned_at
                        ? new Date(address.last_scanned_at).toLocaleString()
                        : 'Unknown';
                      return (
                        <div
                          key={address.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{addressText}</p>
                            <p className="text-[11px] text-muted-foreground">Last scan: {lastScanned}</p>
                          </div>
                          <p className="whitespace-nowrap text-xs font-medium text-foreground">
                            {(address.scans || 0).toLocaleString()} scan{(address.scans || 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-4 space-y-4">
          {!linkedCampaignId ? (
            <div className="rounded-lg border border-border bg-card p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Linked campaign required</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Farm notes are saved on the farm&apos;s linked campaign.
                </p>
              </div>
              <Button onClick={() => void handleCreateLinkedCampaign()} disabled={creatingLinkedCampaign}>
                {creatingLinkedCampaign ? 'Creating...' : 'Create linked campaign'}
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Farm notes</h2>
                <Textarea
                  className="min-h-[120px] resize-y"
                  placeholder="Write a note..."
                  value={farmNoteDraft}
                  onChange={(event) => setFarmNoteDraft(event.target.value)}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        key={farmNotePdfInputKey}
                        type="file"
                        accept="application/pdf"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          if (file && file.type !== 'application/pdf') {
                            alert('Invalid file type. Use a PDF.');
                            setFarmNotePdf(null);
                            setFarmNotePdfInputKey((value) => value + 1);
                            return;
                          }
                          setFarmNotePdf(file);
                        }}
                        disabled={isSavingCampaignNotes}
                      />
                      <span className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                        <Paperclip className="h-4 w-4" />
                        Add PDF
                      </span>
                    </label>
                    {farmNotePdf ? (
                      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-[220px] truncate">{farmNotePdf.name}</span>
                        <button
                          type="button"
                          className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Remove PDF"
                          onClick={() => {
                            setFarmNotePdf(null);
                            setFarmNotePdfInputKey((value) => value + 1);
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleAddFarmNote()}
                    disabled={!canAddFarmNote || isSavingCampaignNotes}
                  >
                    <Plus className="h-4 w-4" />
                    {isSavingCampaignNotes ? 'Saving...' : 'Add note'}
                  </Button>
                </div>
              </div>

              {sortedFarmNoteEntries.length > 0 ? (
                <div className="space-y-0">
                  {sortedFarmNoteEntries.map((entry, index) => (
                    <div key={entry.id} className="relative pl-7 pb-5 last:pb-0">
                      {index < sortedFarmNoteEntries.length - 1 ? (
                        <span className="absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px bg-border" />
                      ) : null}
                      <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-primary bg-background" />
                      <div className="rounded-lg border border-border bg-card p-4">
                        <time className="font-mono text-xs text-muted-foreground">
                          {formatFarmNoteTimestamp(entry.createdAt)}
                        </time>
                        {entry.body ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{entry.body}</p>
                        ) : null}
                        {entry.attachment ? (
                          <a
                            href={entry.attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-primary hover:bg-accent hover:text-accent-foreground"
                          >
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate">{entry.attachment.name}</span>
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-card/60 p-6 text-sm text-muted-foreground">
                  No notes yet.
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="configure" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Farm Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),280px]">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="configName">Farm name</Label>
                    <Input
                      id="configName"
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                      placeholder="Downtown Repeat Farm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="configDescription">Description</Label>
                    <Textarea
                      id="configDescription"
                      value={configDescription}
                      onChange={(e) => setConfigDescription(e.target.value)}
                      rows={4}
                      placeholder="What makes this farm valuable?"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="configStartDate">Start date</Label>
                    <Input
                      id="configStartDate"
                      type="date"
                      value={configStartDate}
                      onChange={(e) => setConfigStartDate(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),180px]">
                    <div className="space-y-2">
                      <Label htmlFor="configTouchesPerInterval">Target homes per cycle</Label>
                      <Input
                        id="configTouchesPerInterval"
                        type="number"
                        min="1"
                        value={configTouchesPerInterval < 1 ? '' : String(configTouchesPerInterval)}
                        onChange={(e) => {
                          if (e.target.value === '') {
                            setConfigTouchesPerInterval(0);
                            return;
                          }

                          const parsed = parseInt(e.target.value, 10);
                          const nextValue = Number.isFinite(parsed) ? Math.max(1, parsed) : 0;
                          setConfigTouchesPerInterval(nextValue);
                          if (configGoalType === 'homes_per_cycle') {
                            setConfigGoalTarget(nextValue);
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Cadence</Label>
                      <Select
                        value={configTouchesInterval}
                        onValueChange={(value) =>
                          setConfigTouchesInterval(value as FarmTouchInterval)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FARM_TOUCH_INTERVAL_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">Goal tracking</p>
                      <p className="text-sm text-muted-foreground">
                        One cycle equals one planned area hit. Track either homes reached or session volume against that cycle.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),140px]">
                      <div className="space-y-2">
                        <Label>Goal type</Label>
                        <Select
                          value={configGoalType}
                          onValueChange={(value) => {
                            const nextValue = value as FarmGoalType;
                            setConfigGoalType(nextValue);
                            if (nextValue === 'homes_per_cycle') {
                              setConfigGoalTarget(configTouchesPerInterval);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FARM_GOAL_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="configGoalTarget">Target</Label>
                        <Input
                          id="configGoalTarget"
                          type="number"
                          min="1"
                          value={configGoalTarget < 1 ? '' : String(configGoalTarget)}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              setConfigGoalTarget(0);
                              if (configGoalType === 'homes_per_cycle') {
                                setConfigTouchesPerInterval(0);
                              }
                              return;
                            }

                            const parsed = parseInt(e.target.value, 10);
                            const nextValue = Number.isFinite(parsed) ? Math.max(1, parsed) : 0;
                            setConfigGoalTarget(nextValue);
                            if (configGoalType === 'homes_per_cycle') {
                              setConfigTouchesPerInterval(nextValue);
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="configCycleCompletionWindowDays">Target completion window</Label>
                      <Input
                        id="configCycleCompletionWindowDays"
                        type="number"
                        min="1"
                        value={configCycleCompletionWindowDays}
                        onChange={(e) => setConfigCycleCompletionWindowDays(e.target.value)}
                        placeholder="Optional, e.g. 14 days"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Type of touches</Label>
                    <FarmTouchTypePicker
                      value={configTouchTypes}
                      onChange={setConfigTouchTypes}
                      disabled={savingConfig}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="configAnnualBudget">Budget for year</Label>
                    <Input
                      id="configAnnualBudget"
                      type="number"
                      min="0"
                      step="0.01"
                      value={configAnnualBudget}
                      onChange={(e) => setConfigAnnualBudget(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">Farm status</p>
                        <p className="text-sm text-muted-foreground">
                          Toggle whether this farm is still active.
                        </p>
                      </div>
                      <Switch checked={configActive} onCheckedChange={setConfigActive} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                    <p className="font-medium text-foreground">Preview</p>
                    <p className="text-muted-foreground">
                      {configStartDate
                        ? `Launches ${new Date(`${configStartDate}T12:00:00`).toLocaleDateString()}`
                        : 'No start date selected'}
                    </p>
                    <p className="text-muted-foreground">
                      {`1 cycle / ${configTouchesInterval}`}
                    </p>
                    <p className="text-muted-foreground">
                      {formatFarmGoal({
                        goal_type: configGoalType,
                        goal_target: configGoalType === 'homes_per_cycle' ? configTouchesPerInterval : configGoalTarget,
                        touches_per_interval: 1,
                        touches_interval: configTouchesInterval,
                        frequency: 1,
                      })}
                    </p>
                    <p className="text-muted-foreground">
                      {configTouchTypes.length > 0
                        ? configTouchTypes.map(formatFarmTouchTypeLabel).join(', ')
                        : 'No touch types selected'}
                    </p>
                    <p className="text-muted-foreground">
                      {configCycleCompletionWindowDays.trim()
                        ? `Complete each cycle within ${configCycleCompletionWindowDays.trim()} day${configCycleCompletionWindowDays.trim() === '1' ? '' : 's'}`
                        : 'No completion window set'}
                    </p>
                    <p className="text-muted-foreground">
                      {formatFarmBudget(
                        configAnnualBudget.trim()
                          ? Math.round(Number(configAnnualBudget.replace(/,/g, '')) * 100)
                          : null
                      ) || 'No annual budget set'}
                    </p>
                  </div>

                  <Button
                    onClick={handleSaveConfiguration}
                    disabled={savingConfig || !configName.trim()}
                    className="w-full"
                  >
                    {savingConfig ? 'Saving...' : 'Save Configuration'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </main>

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create farm cycle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Touch type</Label>
              <Select value={sessionMode} onValueChange={(value) => setSessionMode(value as FarmSessionMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="doorknock">Doorknock</SelectItem>
                  <SelectItem value="flyer">Flyer</SelectItem>
                  <SelectItem value="canada_post">Canada Post</SelectItem>
                  <SelectItem value="pop_by">Pop by</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                  <SelectItem value="phone_call">Phone call</SelectItem>
                  <SelectItem value="social_ad">Social media ad</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sessionTitle">Title</Label>
              <Input
                id="sessionTitle"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="Cycle 1 Canada Post"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sessionDate">Scheduled date</Label>
                <Input id="sessionDate" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="homesTarget">Target homes</Label>
                <Input
                  id="homesTarget"
                  type="number"
                  min="0"
                  value={homesTarget}
                  onChange={(e) => setHomesTarget(e.target.value)}
                  placeholder="500"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sessionNotes">Notes</Label>
              <Textarea
                id="sessionNotes"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                rows={4}
                placeholder="Optional notes about this run or delivery mode."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreateSession} disabled={saving}>
              {saving ? 'Saving...' : 'Create session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="homesReached">Homes reached</Label>
              <Input
                id="homesReached"
                type="number"
                min="0"
                value={homesReached}
                onChange={(e) => setHomesReached(e.target.value)}
                placeholder="275"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="completeNotes">Completion notes</Label>
              <Textarea
                id="completeNotes"
                value={completeNotes}
                onChange={(e) => setCompleteNotes(e.target.value)}
                rows={4}
                placeholder="What happened during this session?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCompleteSession} disabled={saving}>
              {saving ? 'Saving...' : 'Complete session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {userId ? (
        <CreateContactDialog
          open={createContactOpen}
          onClose={() => {
            setCreateContactOpen(false);
            setSelectedHomeContactAddress(null);
          }}
          onSuccess={() => {
            setCreateContactOpen(false);
            setSelectedHomeContactAddress(null);
            void loadData(userId);
          }}
          userId={userId}
          workspaceId={currentWorkspaceId ?? undefined}
          initialAddress={selectedHomeContactAddress?.address}
          initialAddressId={selectedHomeContactAddress?.addressId}
          initialCampaignId={linkedCampaignId ?? undefined}
          initialFarmId={farm.id}
        />
      ) : null}

      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
      <MissingQRModal
        open={showMissingQRModal}
        onClose={() => {
          setShowMissingQRModal(false);
          setMissingQRFlyerId(null);
        }}
        onAddQR={() => void handleAddQR()}
      />
    </div>
  );
}
