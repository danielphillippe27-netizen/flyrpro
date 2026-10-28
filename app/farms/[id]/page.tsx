'use client';

import { ContactOutreach } from '@/components/outreach/ContactOutreach';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FarmActivityCalendar } from '@/components/farms/FarmActivityCalendar';
import { useParams } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  Clock3,
  DollarSign,
  ListTodo,
  Plus,
  Settings2,
  TrendingUp,
  Users,
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
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { FarmNavigation } from '@/components/farms/FarmNavigation';
import { Textarea } from '@/components/ui/textarea';
import { FarmBusinessCardMetrics } from '@/components/farms/FarmBusinessCardMetrics';
import { FarmPerformanceDashboard } from '@/components/farms/FarmPerformanceDashboard';
import { FarmTouchTypePicker } from '@/components/farms/FarmTouchTypePicker';
import { FarmMapView } from '@/components/farms/FarmMapView';
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
import { localPlanDate, saveTouchPlan } from '@/lib/farms/touch-plan';
import { FarmTouchPlan, type PlannerTouchDraft } from '@/components/farms/FarmTouchPlan';
import { FarmDoorPlanner } from '@/components/farms/FarmDoorPlanner';
import { FarmPlanModes } from '@/components/farms/FarmPlanModes';
import settingsStyles from '@/components/farms/FarmSettings.module.css';
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
  social_ad: 'Social ad',
  event: 'Event',
};

type DashboardScope = 'current_cycle' | 'all_time';
type MapLayerScope = 'all_time' | 'cycle';
type PlannerTouchSlot = PlannerTouchDraft;

type CampaignWithLegacyDescription = CampaignV2 & {
  description?: string | null;
};

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

function getFarmAddressText(address: FarmAddress): string {
  if (address.house_number && address.street_name) {
    return `${address.house_number} ${address.street_name}`;
  }
  return address.formatted || '—';
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
  const [loadError, setLoadError] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'plan') setActiveTab('overview');
  }, []);
  const [overviewScope, setOverviewScope] = useState<DashboardScope>('current_cycle');
  const [chartSessionIds, setChartSessionIds] = useState<string[] | null>(null);
  const [mapLayerScope, setMapLayerScope] = useState<MapLayerScope>('all_time');
  const [selectedMapCycleNumber, setSelectedMapCycleNumber] = useState<string>('latest');
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
  const [savingPlan, setSavingPlan] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const [planError, setPlanError] = useState('');
  const pendingPlanCreations = useRef(new Map<string, FarmTouch>());
  const [planDrafts, setPlanDrafts] = useState<PlannerTouchDraft[]>([]);
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
  const [leadsSearchQuery, setLeadsSearchQuery] = useState('');
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [selectedHomeContactAddress, setSelectedHomeContactAddress] = useState<{
    address: string;
    addressId?: string;
  } | null>(null);
  const [creatingLinkedCampaign, setCreatingLinkedCampaign] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [farmCampaignNotes, setFarmCampaignNotes] = useState('');
  const [isSavingCampaignNotes, setIsSavingCampaignNotes] = useState(false);
  const [campaignNotesDirty, setCampaignNotesDirty] = useState(false);
  const [farmScripts, setFarmScripts] = useState('');
  const [scriptsDirty, setScriptsDirty] = useState(false);
  const [isSavingScripts, setIsSavingScripts] = useState(false);
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
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

  const loadData = useCallback(async (resolvedUserId?: string | null) => {
    setLoadError(false);
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
        FarmTouchOutcomeService.fetchOutcomes(farmId),
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
      setLoadError(true);
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
    setCampaignNotesDirty(false);
  }, [legacyCampaignText.notes, linkedCampaign?.notes]);

  useEffect(() => {
    if (linkedCampaign?.scripts !== undefined) {
      setFarmScripts(linkedCampaign.scripts ?? '');
    } else {
      setFarmScripts(legacyCampaignText.scripts ?? '');
    }
    setScriptsDirty(false);
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

  const defaultPlannedHomesTarget = useMemo(() => {
    if (!farm || getFarmGoalType(farm) !== 'homes_per_cycle') return '';
    return String(getFarmGoalTarget(farm));
  }, [farm]);

  const plannerSlots = useMemo<PlannerTouchSlot[]>(() => {
    if (!farm) return [];

    const scheduledTouches = resolvedTouches
      .filter((touch) => touch.status === 'scheduled')
      .sort(
        (left, right) =>
          new Date(left.scheduled_date).getTime() - new Date(right.scheduled_date).getTime()
      );

    return scheduledTouches.map((touch, index) => ({
      slotId: touch.id, touchId: touch.id, sequenceNumber: index + 1,
      cycleNumber: touch.resolvedCycleNumber,
      suggestedDate: formatDateInput(touch.scheduled_date),
      scheduledDate: formatDateInput(touch.scheduled_date),
      mode: touch.mode ?? 'doorknock', title: touch.title ?? '', notes: touch.notes ?? '',
      homesTarget: touch.homes_target != null ? String(touch.homes_target) : defaultPlannedHomesTarget,
    }));
  }, [defaultPlannedHomesTarget, farm, resolvedTouches]);

  useEffect(() => {
    setPlanDrafts(plannerSlots);
  }, [plannerSlots]);

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

  const filteredFarmLeads = useMemo(() => {
    const query = leadsSearchQuery.trim().toLowerCase();
    const rows = [
      ...contacts.map((contact) => ({
        key: `contact-${contact.id}`,
        contactId: contact.id,
        name: contact.full_name,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        lastContacted: contact.last_contacted,
        status: contact.status,
      })),
      ...leads.map((lead) => ({
        key: `lead-${lead.id}`,
        contactId: undefined,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        lastContacted: undefined,
        status: undefined,
      })),
    ];
    return rows.filter((row) => !query || [row.name, row.phone, row.email, row.address]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [contacts, leads, leadsSearchQuery]);

  const handleDeleteFarmContact = async (contactId: string) => {
    if (!confirm('Delete this contact?')) return;
    try {
      await ContactsService.deleteContact(contactId);
      await loadData(userId);
    } catch (error) {
      console.error('Delete farm contact:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete contact');
    }
  };

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
      await loadData(userId);
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

  const handleSaveCampaignNotes = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;

    setIsSavingCampaignNotes(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ notes: farmCampaignNotes || null })
        .eq('id', campaignId);

      if (error) {
        if (isMissingCampaignColumnError(error, 'notes')) {
          await saveLegacyCampaignText(campaignId, { notes: farmCampaignNotes });
        } else {
          throw error;
        }
      }

      setCampaignNotesDirty(false);
      await loadData(userId);
    } catch (error) {
      alert(formatSupabaseError(error, 'Failed to save farm notes'));
    } finally {
      setIsSavingCampaignNotes(false);
    }
  }, [farmCampaignNotes, handleCreateLinkedCampaign, linkedCampaignId, loadData, saveLegacyCampaignText, userId]);

  const handleSaveScripts = useCallback(async () => {
    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) return;

    setIsSavingScripts(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ scripts: farmScripts || null })
        .eq('id', campaignId);

      if (error) {
        if (isMissingCampaignColumnError(error, 'scripts')) {
          await saveLegacyCampaignText(campaignId, { scripts: farmScripts });
        } else {
          throw error;
        }
      }

      setScriptsDirty(false);
      await loadData(userId);
    } catch (error) {
      alert(formatSupabaseError(error, 'Failed to save scripts'));
    } finally {
      setIsSavingScripts(false);
    }
  }, [farmScripts, handleCreateLinkedCampaign, linkedCampaignId, loadData, saveLegacyCampaignText, userId]);

  const handleFlyerUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const campaignId = linkedCampaignId ?? (await handleCreateLinkedCampaign());
    if (!campaignId) {
      event.target.value = '';
      return;
    }

    const allowedTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
    ]);

    setUploadingFlyer(true);
    try {
      if (!allowedTypes.has(file.type)) {
        throw new Error('Invalid file type. Use image (JPEG, PNG, WebP, GIF) or PDF.');
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('File too large. Maximum size is 10MB.');
      }

      const supabase = createClient();
      const rawExt =
        file.type === 'application/pdf'
          ? 'pdf'
          : (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'].includes(rawExt.toLowerCase())
        ? rawExt.toLowerCase()
        : 'jpg';
      const path = `campaign-flyers/${campaignId}/${crypto.randomUUID()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage.from('flyers').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('flyers').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('campaigns')
        .update({ flyer_url: urlData.publicUrl })
        .eq('id', campaignId);

      if (updateError) {
        if (isMissingCampaignColumnError(updateError, 'flyer_url')) {
          await saveLegacyCampaignText(campaignId, { flyerUrl: urlData.publicUrl });
        } else {
          throw updateError;
        }
      }

      await loadData(userId);
    } catch (error) {
      alert(formatSupabaseError(error, 'Failed to upload flyer'));
    } finally {
      setUploadingFlyer(false);
      event.target.value = '';
    }
  }, [handleCreateLinkedCampaign, linkedCampaignId, loadData, saveLegacyCampaignText, userId]);

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
          baseUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://wolfgrid.app'}/api/scan`,
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

  const handlePlanDraftChange = useCallback(
    (slotId: string, field: keyof Omit<PlannerTouchDraft, 'slotId' | 'touchId' | 'sequenceNumber' | 'cycleNumber' | 'suggestedDate'>, value: string) => {
      setPlanMessage('');
      setPlanError('');
      setPlanDrafts((current) =>
        current.map((draft) => (draft.slotId === slotId ? { ...draft, [field]: value } : draft))
      );
    },
    []
  );

  const handleResetPlan = useCallback(() => {
    setPlanDrafts(plannerSlots);
    setPlanMessage('');
    setPlanError('');
  }, [plannerSlots]);

  const handleSavePlan = useCallback(async () => {
    if (!farm) return;

    setSavingPlan(true);
    setPlanMessage('');
    setPlanError('');
    try {
      await saveTouchPlan({
        drafts: planDrafts, farmId: farm.id,
        workspaceId: farm.workspace_id ?? currentWorkspaceId,
        originalTouches: [...touches, ...pendingPlanCreations.current.values()],
        writer: FarmTouchService,
        onCreated: (slotId, created) => {
          pendingPlanCreations.current.set(created.id, created);
          setPlanDrafts(current => current.map(item => item.slotId === slotId ? { ...item, touchId: created.id } : item));
        },
      });
      // Refresh this plan explicitly; a failed refresh must not announce success.
      const refreshed = await FarmTouchService.fetchTouches(farm.id);
      setTouches(refreshed);
      pendingPlanCreations.current.clear();
      setPlanMessage('Plan saved. Your timeline is up to date.');
    } catch (error) {
      console.error('Save farm plan:', error);
      setPlanError(`${error instanceof Error ? error.message : 'Unable to save the plan.'} Your edits are still here; try saving again.`);
    } finally {
      setSavingPlan(false);
    }
  }, [currentWorkspaceId, farm, planDrafts, touches]);

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

  if (loadError) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-foreground">Failed to load farm</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          There was a problem loading this farm. Please try again.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => void loadData(userId)}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/farms">Back to farms</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!farm) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Farm not found</div>;
  }

  return (
    <div className={`bg-muted/30 dark:bg-background relative ${activeTab === 'map' ? 'h-full overflow-hidden' : 'min-h-full'}`}>
      <main className={`w-full p-2 sm:p-3 ${activeTab === 'map' ? 'flex h-full flex-col' : ''}`}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className={`w-full ${activeTab === 'map' ? 'min-h-0 flex-1' : ''}`}>
        <FarmNavigation />

        <TabsContent value="overview" className="mt-1 space-y-4">
          <FarmPerformanceDashboard
            name={farm.name}
            addresses={addresses}
            touches={resolvedTouches}
            outcomes={touchOutcomes}
            leads={leads}
            currentCycle={analytics.currentCycleNumber}
            scope={overviewScope}
            onScopeChange={setOverviewScope}
          />
          <FarmPlanModes farmId={farm.id} addresses={addresses} touches={touches} outcomes={touchOutcomes} onAddContact={handleOpenCreateContact}>
          <FarmTouchPlan
            drafts={planDrafts}
            touches={resolvedTouches.map(touch => ({ ...touch, cycle_number: touch.resolvedCycleNumber }))}
            saving={savingPlan}
            message={planMessage}
            error={planError}
            onChange={handlePlanDraftChange}
            onReset={handleResetPlan}
            onSave={handleSavePlan}
            onRemove={(slotId) => { setPlanMessage(''); setPlanError(''); setPlanDrafts(current => current.filter(draft => draft.slotId !== slotId)); }}
            onAdd={() => {
              setPlanMessage('');
              setPlanError('');
              setPlanDrafts(current => {
                const cycle = Math.max(0, ...resolvedTouches.map(touch => touch.resolvedCycleNumber), ...current.map(draft => draft.cycleNumber)) + 1;
                const date = localPlanDate();
                return [...current, { slotId: crypto.randomUUID(), touchId: null, sequenceNumber: cycle, cycleNumber: cycle,
                  suggestedDate: date, scheduledDate: date, mode: 'doorknock', title: '', notes: '', homesTarget: defaultPlannedHomesTarget }];
              });
            }}
          />
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Daily door assignments</summary>
            <div className="mt-4"><FarmDoorPlanner farmId={farm.id} addresses={addresses} onHomesImported={() => loadData(userId)} onAddContact={handleOpenCreateContact} /></div>
          </details>
          </FarmPlanModes>

          <details className="rounded-2xl border border-border/60 bg-card p-5">
            <summary className="cursor-pointer text-sm font-medium">More analytics <span className="ml-2 text-xs font-normal text-muted-foreground">Cards, sessions, spend & cadence</span></summary>
            <div className="mt-5 space-y-4">
              <FarmBusinessCardMetrics farmId={farm.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ListTodo className="w-4 h-4" />
                Sessions
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">{overviewSnapshot.sessions.toLocaleString()}</div>
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
              <div className="mt-4 text-2xl font-semibold text-foreground">{formatMetricValue(overviewSnapshot.avgHomesPerSession)}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewScope === 'all_time'
                  ? `${formatMetricValue(kpis.cycleAvgHomesPerSession)} this cycle`
                  : `${formatMetricValue(kpis.avgHomesPerSession)} all time`}
              </p>
            </div>
            <div className="bg-card p-4 rounded-xl border border-border">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="w-4 h-4" />
                Contact Rate
              </p>
              <div className="mt-4 text-2xl font-semibold text-foreground">
                {formatPercentage(overviewSnapshot.contactRate)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {overviewSnapshot.visits.toLocaleString()} farm touches / {overviewSnapshot.contacts.toLocaleString()} contacts
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

            </div>
          </details>

        </TabsContent>



        <TabsContent value="map" className="mt-1 min-h-0 overflow-hidden rounded-xl border border-border bg-card">
            <FarmMapView
              key={`${farm.id}:${mapTabVersion}:${mapLayerScope}:${selectedMapCycleNumber}`}
              farm={farm}
              addresses={addresses}
              linkedCampaignId={linkedCampaignId}
              linkedCampaign={linkedCampaign}
              layerScope={mapLayerScope}
              cycleTouchIds={selectedMapCycleTouchIds}
              touchOutcomes={touchOutcomes}
              contacts={contacts}
              onDataChanged={() => loadData(userId)}
              className="h-full rounded-none border-0"
              toolbarContent={
                <div className="flex flex-wrap items-center gap-2" aria-label="Farm map layers">
                <div className="inline-flex rounded-lg border border-border bg-background/95 p-1">
                  <button
                    type="button"
                    aria-pressed={mapLayerScope === 'all_time'}
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
                    aria-pressed={mapLayerScope === 'cycle'}
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
                    <SelectTrigger aria-label={`Map cycle: ${selectedMapCycleLabel}`} className="w-[180px] bg-background/95">
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
                </div>
              }
              showOutcomeControls={false}
            />
        </TabsContent>

        <TabsContent value="activity" className="mt-1 space-y-4">
          {chartSessionIds && <section className="rounded-xl border border-border bg-card p-5 space-y-4" aria-label="Sessions from selected chart period">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Sessions from selected chart period</h2>
              <Button size="sm" variant="outline" onClick={() => setChartSessionIds(null)}>Show all activity</Button>
            </div>
            {resolvedTouches.filter(touch => chartSessionIds.includes(touch.id)).map(touch => <div key={touch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
              <div><p className="text-sm font-medium">{touch.title || MODE_LABELS[touch.mode ?? 'doorknock']}</p><p className="mt-1 text-xs text-muted-foreground">Cycle {touch.resolvedCycleNumber} · {formatDateLabel(touch.started_at ?? touch.scheduled_date)}</p></div>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{touch.status.replace('_', ' ')}</Badge>{touch.status === 'scheduled' && <Button size="sm" variant="outline" onClick={() => void handleStartSession(touch)}>Start session</Button>}{touch.status === 'in_progress' && <Button size="sm" variant="outline" onClick={() => handleOpenComplete(touch)}>Complete session</Button>}</div>
            </div>)}
          </section>}
          <div className="bg-card p-4 rounded-xl border border-border space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-1">Farm activity</h2>
              <p className="text-sm text-muted-foreground">Your daily canvassing habit, one square at a time.</p>
              <Link href="/activity" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline mt-2">
                View all workspace activity
              </Link>
            </div>
            <FarmActivityCalendar campaignId={linkedCampaignId} createdAt={farm.created_at} />
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-1">
          <div className="bg-card p-4 rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Farm Leads</h2>
                <Badge variant="secondary" className="text-xs">{leads.length + contacts.length}</Badge>
              </div>
              <Button size="sm" disabled={!userId} onClick={() => {
                setSelectedHomeContactAddress(null);
                setCreateContactOpen(true);
              }}>
                <Plus className="w-4 h-4 mr-1" />
                Add contact
              </Button>
            </div>
            <div className="mb-4"><ContactOutreach contacts={contacts} /></div>
            <div className="relative mb-4">
              <input
                type="text"
                aria-label="Search farm leads"
                placeholder="Search by name, phone, email, or address..."
                value={leadsSearchQuery}
                onChange={(event) => setLeadsSearchQuery(event.target.value)}
                className="w-full pl-3 pr-3 py-2 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {filteredFarmLeads.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">
                  {leadsSearchQuery.trim() ? 'No contacts match your search.' : 'No contacts yet. Add a contact to get started.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Name</th>
                      <th className="pb-2 pr-3 font-medium">Phone</th>
                      <th className="pb-2 pr-3 font-medium">Email</th>
                      <th className="pb-2 pr-3 font-medium">Address</th>
                      <th className="pb-2 pr-3 font-medium">Last contacted</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 w-16 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFarmLeads.map((lead) => (
                      <tr key={lead.key} className="border-b border-border/50">
                        <td className="py-2 pr-3 text-foreground">{lead.name || '—'}</td>
                        <td className="py-2 pr-3 text-foreground">{lead.phone || '—'}</td>
                        <td className="py-2 pr-3 text-foreground">{lead.email || '—'}</td>
                        <td className="py-2 pr-3 text-foreground max-w-[180px] truncate" title={lead.address || undefined}>{lead.address || '—'}</td>
                        <td className="py-2 pr-3 text-foreground">{lead.lastContacted ? formatDateLabel(lead.lastContacted) : '—'}</td>
                        <td className="py-2 pr-3 text-foreground">{lead.status || '—'}</td>
                        <td className="py-2">
                          {lead.contactId ? (
                            <button
                              type="button"
                              onClick={() => void handleDeleteFarmContact(lead.contactId!)}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted text-xs"
                              aria-label={`Delete ${lead.name || 'contact'}`}
                            >
                              Delete
                            </button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="finance" className="mt-1 space-y-4">
          <FinancePanel
            targetType="farm"
            targetId={farm.id}
            workspaceId={farm.workspace_id ?? currentWorkspaceId}
            addresses={addresses}
          />
        </TabsContent>

        <TabsContent value="qr" className="mt-1 space-y-4">
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

              <div className="grid gap-4 lg:grid-cols-2">
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

        <TabsContent value="notes" className="mt-1 space-y-4">
          {!linkedCampaignId ? (
            <div className="rounded-xl border border-border bg-card p-6 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Linked campaign required</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Farm notes, scripts, and flyer assets are saved on the farm&apos;s linked campaign so the print and QR setup stay together.
                </p>
              </div>
              <Button onClick={() => void handleCreateLinkedCampaign()} disabled={creatingLinkedCampaign}>
                {creatingLinkedCampaign ? 'Creating...' : 'Create linked campaign'}
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Farm notes</h2>
                <p className="mb-2 text-xs text-muted-foreground">
                  Free-form notes for this farm&apos;s linked campaign (territory, goals, follow-ups, and print context).
                </p>
                <Textarea
                  className="min-h-[200px] resize-y font-mono"
                  placeholder="Add notes..."
                  value={farmCampaignNotes}
                  onChange={(event) => {
                    setFarmCampaignNotes(event.target.value);
                    setCampaignNotesDirty(true);
                  }}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveCampaignNotes()}
                    disabled={!campaignNotesDirty || isSavingCampaignNotes}
                  >
                    {isSavingCampaignNotes ? 'Saving...' : 'Save notes'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Scripts</h2>
                <p className="mb-2 text-xs text-muted-foreground">
                  Script or dialogue to use when working this farm or talking to leads.
                </p>
                <Textarea
                  className="min-h-[160px] resize-y font-mono"
                  placeholder="Add scripts..."
                  value={farmScripts}
                  onChange={(event) => {
                    setFarmScripts(event.target.value);
                    setScriptsDirty(true);
                  }}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveScripts()}
                    disabled={!scriptsDirty || isSavingScripts}
                  >
                    {isSavingScripts ? 'Saving...' : 'Save scripts'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Flyer used</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Upload a photo or PDF of the flyer used for this farm.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-block cursor-pointer">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                      className="sr-only"
                      onChange={(event) => void handleFlyerUpload(event)}
                      disabled={uploadingFlyer}
                    />
                    <span className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                      {uploadingFlyer ? 'Uploading...' : 'Choose photo or PDF'}
                    </span>
                  </label>
                  {currentFlyerUrl ? (
                    <a
                      href={currentFlyerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View current flyer
                    </a>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="configure" className={`mt-1 space-y-4 ${settingsStyles.settings}`}>
          <Card>
            <CardHeader className="border-b border-border pb-5">
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Settings2 className="w-4 h-4" />
                Farm settings
              </CardTitle>
              <p className="text-sm text-muted-foreground">Manage your farm details, outreach schedule, and goals.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-6">
                  <section className={settingsStyles.section} aria-labelledby="farm-details-heading">
                    <h3 id="farm-details-heading">Farm details</h3>
                    <p className={settingsStyles.description}>Give this farm a clear name and description.</p>
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

                  </section>
                  <section className={settingsStyles.section} aria-labelledby="farm-schedule-heading">
                    <h3 id="farm-schedule-heading">Schedule &amp; coverage</h3>
                    <p className={settingsStyles.description}>Choose when to start and how many homes to reach each cycle.</p>
                  <div className="space-y-2">
                    <Label htmlFor="configStartDate">Start date</Label>
                    <Input
                      id="configStartDate"
                      type="date"
                      value={configStartDate}
                      onChange={(e) => setConfigStartDate(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
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
                      <Label htmlFor="configCadence">Repeat cycle</Label>
                      <Select
                        value={configTouchesInterval}
                        onValueChange={(value) =>
                          setConfigTouchesInterval(value as FarmTouchInterval)
                        }
                      >
                        <SelectTrigger id="configCadence">
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

                  </section>
                  <section className={settingsStyles.section} aria-labelledby="farm-goals-heading">
                    <div className="space-y-1">
                      <h3 id="farm-goals-heading">Goal tracking</h3>
                      <p className="text-sm text-muted-foreground">
                        One cycle equals one planned area hit. Track either homes reached or session volume against that cycle.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                      <div className="space-y-2">
                        <Label htmlFor="configGoalType">Goal type</Label>
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
                          <SelectTrigger id="configGoalType">
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
                        <Label htmlFor="configGoalTarget">Goal target</Label>
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
                  </section>

                  <section className={settingsStyles.section} aria-labelledby="farm-outreach-heading">
                    <h3 id="farm-outreach-heading">Outreach &amp; budget</h3>
                    <p className={settingsStyles.description}>Select your outreach methods and optional annual budget.</p>
                  <div className="space-y-2">
                    <Label>Outreach methods</Label>
                    <FarmTouchTypePicker
                      value={configTouchTypes}
                      onChange={setConfigTouchTypes}
                      disabled={savingConfig}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="configAnnualBudget">Annual budget ($)</Label>
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
                  </section>
                </div>

                <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Farm status</h3>
                        <p className="text-sm text-muted-foreground">
                          Toggle whether this farm is still active.
                        </p>
                      </div>
                      <Switch aria-label="Farm active" checked={configActive} onCheckedChange={setConfigActive} />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
                    <h3 className="text-base font-semibold text-foreground">Plan summary</h3>
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
