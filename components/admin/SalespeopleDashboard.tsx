'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/lib/workspace-context';

type SalespersonStatus = 'active' | 'paused' | 'inactive';

type Salesperson = {
  id: string;
  createdAt: string;
  updatedAt: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string | null;
  territory: string | null;
  referralCode: string | null;
  commissionRateBps: number;
  commissionDurationMonths: number;
  status: SalespersonStatus;
  notes: string | null;
  stripeConnectAccountId: string | null;
  stripeOnboardingCompleted: boolean;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  workspaceId: string | null;
  inviteUrl: string | null;
  invitedAt: string | null;
  onboardingCompletedAt: string | null;
  userId: string | null;
  isLive: boolean;
  lastActiveAt: string | null;
  currentSessionStartedAt: string | null;
  currentSessionDurationSeconds: number;
  dialerNumber: {
    phoneNumber: string | null;
    smsFromNumber: string | null;
    inboundForwardTo: string | null;
    twilioIncomingPhoneNumberSid: string | null;
    numberStatus: 'unassigned' | 'active' | 'released';
    numberAssignedAt: string | null;
  };
};

type SalespeoplePayload = {
  setupRequired: boolean;
  kpis: {
    total: number;
    active: number;
    stripeLinked: number;
    payoutsReady: number;
  };
  salespeople: Salesperson[];
  payoutQueue: {
    readyTotals: Array<{ currency: string; amountCents: number; commissionCount: number }>;
    pendingSetupTotals: Array<{ currency: string; amountCents: number; commissionCount: number }>;
    readyCommissionCount: number;
    pendingSetupCommissionCount: number;
    readyBySalesperson: Array<{
      salespersonId: string;
      fullName: string;
      email: string;
      referralCode: string | null;
      currency: string;
      openCommissionCount: number;
      totalCommissionCents: number;
      totalRevenueCents: number;
      oldestEarnedAt: string;
    }>;
    recentCommissions: Array<{
      id: string;
      salespersonId: string;
      salespersonName: string;
      salespersonEmail: string | null;
      referralCode: string | null;
      referredWorkspaceId: string;
      referredUserId: string;
      stripeInvoiceId: string;
      revenueAmountCents: number;
      commissionAmountCents: number;
      commissionRateBps: number;
      currency: string;
      earnedAt: string;
      status: 'pending' | 'paid' | 'voided';
      payoutsEnabled: boolean;
    }>;
    payoutHistory: Array<{
      id: string;
      salespersonId: string | null;
      salespersonName: string;
      salespersonEmail: string | null;
      referralCode: string | null;
      currency: string;
      totalCommissionCents: number;
      status: 'draft' | 'processing' | 'paid' | 'failed';
      createdAt: string;
      paidAt: string | null;
      stripeTransferId: string | null;
      failureReason: string | null;
    }>;
  };
};

type SalespersonDraft = {
  fullName: string;
  email: string;
  phone: string;
  role: string;
  territory: string;
  referralCode: string;
  commissionRatePercent: string;
  status: SalespersonStatus;
  notes: string;
};

type SalespersonSettingsDraft = {
  referralCode: string;
  commissionRatePercent: string;
  commissionDurationMonths: string;
  status: SalespersonStatus;
  role: string;
  territory: string;
};

type GooglePlacesProspect = {
  placeId: string;
  name: string;
  city: string;
  query: string;
  queryTerm: string;
  formattedAddress: string;
  primaryType: string;
  phone: string;
  website: string;
  websiteDomain: string;
  googleMapsUrl: string;
  rating: number | null;
  userRatingCount: number | null;
  latitude: number | null;
  longitude: number | null;
  businessStatus: string | null;
  prospectKind: 'agent_or_team' | 'brokerage_or_office' | 'maybe_irrelevant';
  confidenceScore: number;
};

type GooglePlacesPayload = {
  ok?: boolean;
  startedAt?: string;
  completedAt?: string;
  queryCount?: number;
  rawResultCount?: number;
  uniqueResultCount?: number;
  prospects?: GooglePlacesProspect[];
  error?: string;
};

const emptyDraft: SalespersonDraft = {
  fullName: '',
  email: '',
  phone: '',
  role: 'Closer',
  territory: '',
  referralCode: '',
  commissionRatePercent: '25',
  status: 'active',
  notes: '',
};

type CreateSalespersonResult = {
  salesperson?: {
    inviteUrl?: string | null;
    referralCode?: string | null;
  };
  salespersonInviteEmailSent?: boolean;
  salespersonInviteEmailError?: string | null;
  error?: string;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Request failed: ${response.status}`);
  }
  return payload as T;
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value || typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the textarea approach.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '-9999px';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'No activity yet';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'No activity yet';

  const elapsedMs = Date.now() - then.getTime();
  if (elapsedMs < 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(elapsedMs / (60 * 1000)))}m ago`;
  }
  if (elapsedMs < 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(elapsedMs / (60 * 60 * 1000)))}h ago`;
  }

  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatCommissionRate(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format((amountCents ?? 0) / 100);
  } catch {
    return `${((amountCents ?? 0) / 100).toFixed(2)} ${currency || 'USD'}`;
  }
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPlacesProspectsCsv(prospects: GooglePlacesProspect[]): string {
  const headers = [
    'name',
    'city',
    'phone',
    'website',
    'google_maps_url',
    'formatted_address',
    'rating',
    'user_rating_count',
    'prospect_kind',
    'confidence_score',
    'query',
    'place_id',
  ];
  const rows = prospects.map((prospect) => [
    prospect.name,
    prospect.city,
    prospect.phone,
    prospect.website,
    prospect.googleMapsUrl,
    prospect.formattedAddress,
    prospect.rating,
    prospect.userRatingCount,
    prospect.prospectKind,
    prospect.confidenceScore,
    prospect.query,
    prospect.placeId,
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function prospectKindLabel(kind: GooglePlacesProspect['prospectKind']): string {
  if (kind === 'agent_or_team') return 'Agent/team';
  if (kind === 'brokerage_or_office') return 'Brokerage';
  return 'Review';
}

function statusVariant(status: SalespersonStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'paused') return 'secondary';
  return 'outline';
}

export function SalespeopleDashboard({ stripeNotice }: { stripeNotice: string | null }) {
  const { currentWorkspace, currentWorkspaceId } = useWorkspace();
  const [payload, setPayload] = useState<SalespeoplePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(stripeNotice);
  const [draft, setDraft] = useState<SalespersonDraft>(emptyDraft);
  const [settingsDrafts, setSettingsDrafts] = useState<
    Record<string, SalespersonSettingsDraft>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [actionState, setActionState] = useState<Record<string, string>>({});
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [numberAreaCodes, setNumberAreaCodes] = useState<Record<string, string>>({});
  const [placesCityPreset, setPlacesCityPreset] = useState<'major' | 'all'>('major');
  const [placesMaxQueries, setPlacesMaxQueries] = useState('40');
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [placesSummary, setPlacesSummary] = useState<{
    queryCount: number;
    rawResultCount: number;
    uniqueResultCount: number;
    completedAt: string | null;
  } | null>(null);
  const [placesProspects, setPlacesProspects] = useState<GooglePlacesProspect[]>([]);

  const loadSalespeople = useCallback(async () => {
    const data = await readJson<SalespeoplePayload>('/api/admin/salespeople?limit=100');
    setPayload(data);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadSalespeople();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load salespeople.');
    } finally {
      setLoading(false);
    }
  }, [loadSalespeople]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!payload?.salespeople.length) return;
    setSettingsDrafts((current) => {
      const next = { ...current };
      for (const salesperson of payload.salespeople) {
        next[salesperson.id] = {
          referralCode: salesperson.referralCode ?? '',
          commissionRatePercent: String(salesperson.commissionRateBps / 100),
          commissionDurationMonths: String(salesperson.commissionDurationMonths ?? 12),
          status: salesperson.status,
          role: salesperson.role ?? '',
          territory: salesperson.territory ?? '',
        };
      }
      return next;
    });
  }, [payload]);

  const setActionLoading = useCallback((salespersonId: string, label: string | null) => {
    setActionState((current) => {
      const next = { ...current };
      if (label) {
        next[salespersonId] = label;
      } else {
        delete next[salespersonId];
      }
      return next;
    });
  }, []);

  const updateDraft = useCallback((field: keyof SalespersonDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const updateSettingsDraft = useCallback(
    (salespersonId: string, field: keyof SalespersonSettingsDraft, value: string) => {
      setSettingsDrafts((current) => ({
        ...current,
        [salespersonId]: {
          referralCode: current[salespersonId]?.referralCode ?? '',
          commissionRatePercent: current[salespersonId]?.commissionRatePercent ?? '',
          commissionDurationMonths: current[salespersonId]?.commissionDurationMonths ?? '12',
          status: current[salespersonId]?.status ?? 'active',
          role: current[salespersonId]?.role ?? '',
          territory: current[salespersonId]?.territory ?? '',
          [field]: value,
        },
      }));
    },
    []
  );

  const createSalesperson = useCallback(async () => {
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const trimmedCommissionRate = draft.commissionRatePercent.trim();
      const response = await fetch('/api/admin/salespeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...draft,
          referralCode: draft.referralCode.trim() || undefined,
          commissionRateBps: trimmedCommissionRate
            ? Math.round(Number(trimmedCommissionRate) * 100)
            : undefined,
          commissionDurationMonths: 12,
          workspaceId: currentWorkspaceId ?? undefined,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as CreateSalespersonResult;
      if (!response.ok) {
        throw new Error(result.error || 'Failed to add salesperson.');
      }

      const salespersonInviteMessage = result.salespersonInviteEmailSent
        ? `Salesperson onboarding email sent to ${draft.email.trim()}.`
        : result.salespersonInviteEmailError
          ? `Salesperson was created, but the onboarding email was not sent: ${result.salespersonInviteEmailError}`
          : '';

      setDraft(emptyDraft);
      setAddDialogOpen(false);
      await loadSalespeople();
      setStatusMessage(
        `${result.salesperson?.inviteUrl
          ? `Salesperson added. Invite link ready: ${result.salesperson.inviteUrl}`
          : result.salesperson?.referralCode
            ? `Salesperson added with code ${result.salesperson.referralCode}.`
            : 'Salesperson added.'
        }${salespersonInviteMessage ? ` ${salespersonInviteMessage}` : ''}`
      );
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Failed to add salesperson.');
    } finally {
      setSubmitting(false);
    }
  }, [currentWorkspaceId, draft, loadSalespeople]);

  const saveSettings = useCallback(
    async (salespersonId: string) => {
      setActionLoading(salespersonId, 'save');
      setStatusMessage(null);
      try {
        const draftForSalesperson = settingsDrafts[salespersonId];
        const trimmedCommissionRate = draftForSalesperson?.commissionRatePercent.trim() ?? '';
        const response = await fetch(`/api/admin/salespeople/${salespersonId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            referralCode: draftForSalesperson?.referralCode.trim() || undefined,
            commissionRateBps: trimmedCommissionRate
              ? Math.round(Number(trimmedCommissionRate) * 100)
              : undefined,
            commissionDurationMonths: draftForSalesperson?.commissionDurationMonths
              ? Math.round(Number(draftForSalesperson.commissionDurationMonths))
              : undefined,
            status: draftForSalesperson?.status,
            role: draftForSalesperson?.role,
            territory: draftForSalesperson?.territory,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to save salesperson settings.');
        }
        await loadSalespeople();
        setStatusMessage('Salesperson settings saved.');
      } catch (e) {
        setStatusMessage(
          e instanceof Error ? e.message : 'Failed to save salesperson settings.'
        );
      } finally {
        setActionLoading(salespersonId, null);
      }
    },
    [loadSalespeople, setActionLoading, settingsDrafts]
  );

  const createStripeLink = useCallback(
    async (salespersonId: string) => {
      setActionLoading(salespersonId, 'stripe');
      setStatusMessage(null);
      try {
        const salesperson = payload?.salespeople.find((item) => item.id === salespersonId);
        const draftForSalesperson = settingsDrafts[salespersonId];
        const trimmedCommissionRate = draftForSalesperson?.commissionRatePercent.trim() ?? '';
        const response = await fetch(`/api/admin/salespeople/${salespersonId}/stripe-connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            referralCode: draftForSalesperson?.referralCode.trim() || undefined,
            commissionRateBps: trimmedCommissionRate
              ? Math.round(Number(trimmedCommissionRate) * 100)
              : undefined,
            commissionDurationMonths: draftForSalesperson?.commissionDurationMonths
              ? Math.round(Number(draftForSalesperson.commissionDurationMonths))
              : undefined,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to create Stripe onboarding link.');
        }

        const onboardingUrl = typeof result.onboardingUrl === 'string' ? result.onboardingUrl : '';
        const copied = onboardingUrl ? await copyTextToClipboard(onboardingUrl) : false;
        await loadSalespeople();
        const label = salesperson?.email ?? 'the salesperson';
        setStatusMessage(
          copied
            ? `Stripe onboarding link copied for ${label}.`
            : onboardingUrl
              ? `Send this Stripe onboarding link to ${label}: ${onboardingUrl}`
              : 'Stripe onboarding link created.'
        );
      } catch (e) {
        setStatusMessage(
          e instanceof Error ? e.message : 'Failed to create Stripe onboarding link.'
        );
      } finally {
        setActionLoading(salespersonId, null);
      }
    },
    [loadSalespeople, payload?.salespeople, setActionLoading, settingsDrafts]
  );

  const copyReferralCode = useCallback(async (code: string, name: string) => {
    const copied = await copyTextToClipboard(code);
    setStatusMessage(
      copied ? `${name}'s referral code copied.` : `Could not copy ${name}'s referral code.`
    );
  }, []);

  const copyInviteLink = useCallback(async (inviteUrl: string | null, name: string) => {
    if (!inviteUrl) {
      setStatusMessage(`No invite link is available for ${name}.`);
      return;
    }
    const copied = await copyTextToClipboard(inviteUrl);
    setStatusMessage(
      copied ? `${name}'s onboarding invite link copied.` : `Send this onboarding link to ${name}: ${inviteUrl}`
    );
  }, []);

  const updateNumberAreaCode = useCallback((salespersonId: string, value: string) => {
    setNumberAreaCodes((current) => ({
      ...current,
      [salespersonId]: value.replace(/\D/g, '').slice(0, 3),
    }));
  }, []);

  const provisionSalespersonNumber = useCallback(
    async (salespersonId: string) => {
      setActionLoading(salespersonId, 'number');
      setStatusMessage(null);
      try {
        const salesperson = payload?.salespeople.find((item) => item.id === salespersonId);
        const areaCode = numberAreaCodes[salespersonId]?.trim();
        const response = await fetch(`/api/admin/salespeople/${salespersonId}/dialer-number`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            areaCode: areaCode || undefined,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to buy salesperson number.');
        }
        await loadSalespeople();
        setNumberAreaCodes((current) => {
          const next = { ...current };
          delete next[salespersonId];
          return next;
        });
        const assignedNumber =
          typeof result.phoneNumber === 'string'
            ? result.phoneNumber
            : typeof result.settings?.assignedPhoneNumber === 'string'
              ? result.settings.assignedPhoneNumber
              : 'the new number';
        setStatusMessage(
          `Assigned ${assignedNumber} to ${salesperson?.fullName ?? 'salesperson'}.`
        );
      } catch (e) {
        setStatusMessage(e instanceof Error ? e.message : 'Failed to buy salesperson number.');
      } finally {
        setActionLoading(salespersonId, null);
      }
    },
    [loadSalespeople, numberAreaCodes, payload?.salespeople, setActionLoading]
  );

  const runGooglePlacesScrape = useCallback(async () => {
    setPlacesLoading(true);
    setPlacesError(null);
    setStatusMessage(null);
    try {
      const parsedMaxQueries = Number(placesMaxQueries);
      const response = await fetch('/api/admin/salespeople/google-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cityPreset: placesCityPreset,
          maxQueries: Number.isFinite(parsedMaxQueries) ? Math.round(parsedMaxQueries) : 40,
          pageSize: 20,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as GooglePlacesPayload;
      if (!response.ok) {
        throw new Error(result.error || 'Google Places scrape failed.');
      }

      const prospects = result.prospects ?? [];
      setPlacesProspects(prospects);
      setPlacesSummary({
        queryCount: result.queryCount ?? 0,
        rawResultCount: result.rawResultCount ?? 0,
        uniqueResultCount: result.uniqueResultCount ?? prospects.length,
        completedAt: result.completedAt ?? null,
      });
      setStatusMessage(
        `Google Places found ${prospects.length.toLocaleString()} deduped salesperson prospects.`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Google Places scrape failed.';
      setPlacesError(message);
      setStatusMessage(message);
    } finally {
      setPlacesLoading(false);
    }
  }, [placesCityPreset, placesMaxQueries]);

  const exportPlacesProspects = useCallback(() => {
    if (!placesProspects.length) {
      setStatusMessage('Run Google Places first, then export the prospect CSV.');
      return;
    }

    const csv = buildPlacesProspectsCsv(placesProspects);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `google-places-salesperson-prospects-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatusMessage('Google Places prospect CSV exported.');
  }, [placesProspects]);

  const loadProspectIntoDraft = useCallback((prospect: GooglePlacesProspect) => {
    setDraft({
      ...emptyDraft,
      fullName: prospect.name,
      phone: prospect.phone,
      role: 'Real estate prospect',
      territory: prospect.city,
      notes: [
        `Google Places prospect (${prospect.confidenceScore}/100 confidence).`,
        prospect.formattedAddress ? `Address: ${prospect.formattedAddress}` : '',
        prospect.website ? `Website: ${prospect.website}` : '',
        prospect.googleMapsUrl ? `Google Maps: ${prospect.googleMapsUrl}` : '',
        prospect.query ? `Source query: ${prospect.query}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    setAddDialogOpen(true);
  }, []);

  const paySalesperson = useCallback(
    async (salespersonId: string, currency: string) => {
      setActionLoading(salespersonId, 'payout');
      setStatusMessage(null);
      try {
        const response = await fetch('/api/admin/salespeople/payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ salespersonId, currency }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to pay salesperson.');
        }

        await loadSalespeople();
        const amountLabel =
          typeof result.totalCommissionCents === 'number' && typeof result.currency === 'string'
            ? formatAmount(result.totalCommissionCents, result.currency)
            : 'the payout';
        setStatusMessage(
          result.alreadyPaid
            ? `This payout was already completed in Stripe for ${amountLabel}.`
            : `Paid ${result.salespersonName || 'salesperson'} ${amountLabel}. Transfer ${result.transferId || 'created'}.`
        );
      } catch (e) {
        setStatusMessage(e instanceof Error ? e.message : 'Failed to pay salesperson.');
      } finally {
        setActionLoading(salespersonId, null);
      }
    },
    [loadSalespeople, setActionLoading]
  );

  const kpis = payload?.kpis;
  const needsSetup = payload?.setupRequired;
  const payoutQueue = payload?.payoutQueue;
  const activeSalespeople = useMemo(
    () => payload?.salespeople.filter((salesperson) => salesperson.status === 'active') ?? [],
    [payload?.salespeople]
  );
  const liveSalespeopleCount = useMemo(
    () => payload?.salespeople.filter((salesperson) => salesperson.isLive).length ?? 0,
    [payload?.salespeople]
  );
  const addButtonDisabled = submitting || !draft.fullName.trim() || !draft.email.trim();

  return (
    <div className="min-h-full bg-gray-50 p-6 dark:bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Salespeople</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Manage direct FLYR sellers, Stripe Connect payout setup, referral codes,
              and commission settings separately from ambassadors.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={() => setAddDialogOpen(true)}
            >
              <UserPlus className="h-4 w-4" />
              Add salesperson
            </Button>
            <Button asChild variant="outline">
              <Link href="/ambassadors">View ambassadors</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => void loadAll()}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </header>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add salesperson</DialogTitle>
              <DialogDescription>
                Create their referral profile and send the salesperson onboarding email.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-name">Full name</Label>
                  <Input
                    id="salesperson-dialog-name"
                    value={draft.fullName}
                    onChange={(event) => updateDraft('fullName', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-email">Email</Label>
                  <Input
                    id="salesperson-dialog-email"
                    type="email"
                    value={draft.email}
                    onChange={(event) => updateDraft('email', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-role">Sales role</Label>
                  <Input
                    id="salesperson-dialog-role"
                    value={draft.role}
                    onChange={(event) => updateDraft('role', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-territory">Territory</Label>
                  <Input
                    id="salesperson-dialog-territory"
                    value={draft.territory}
                    onChange={(event) => updateDraft('territory', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-code">Referral code</Label>
                  <Input
                    id="salesperson-dialog-code"
                    value={draft.referralCode}
                    onChange={(event) => updateDraft('referralCode', event.target.value)}
                    placeholder="Auto-generated"
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-dialog-commission">Commission %</Label>
                  <Input
                    id="salesperson-dialog-commission"
                    type="number"
                    min={1}
                    max={100}
                    step="0.5"
                    value={draft.commissionRatePercent}
                    onChange={(event) =>
                      updateDraft('commissionRatePercent', event.target.value)
                    }
                    disabled={submitting}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="salesperson-dialog-notes">Notes</Label>
                <Textarea
                  id="salesperson-dialog-notes"
                  value={draft.notes}
                  onChange={(event) => updateDraft('notes', event.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                They will join {currentWorkspace?.name ?? 'Daniel Sales Workspace'} as a member
                after completing the salesperson onboarding link.
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => void createSalesperson()}
                disabled={addButtonDisabled}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Add and invite
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {statusMessage ? <div className="rounded-md border p-3 text-sm">{statusMessage}</div> : null}
        {error ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </div>
        ) : null}
        {needsSetup ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Salespeople storage is not ready yet. Run the migration for
            <span className="font-medium"> salespeople </span>
            before using this workspace.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-4 w-4" />
                  Google Places prospects
                </CardTitle>
                <CardDescription>
                  Find Alberta real estate agents, teams, and brokerage offices from Google Places.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="places-scope" className="text-xs">
                    Scope
                  </Label>
                  <select
                    id="places-scope"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={placesCityPreset}
                    onChange={(event) =>
                      setPlacesCityPreset(event.target.value as 'major' | 'all')
                    }
                    disabled={placesLoading}
                  >
                    <option value="major">Major markets</option>
                    <option value="all">All Alberta</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="places-max-queries" className="text-xs">
                    Queries
                  </Label>
                  <Input
                    id="places-max-queries"
                    className="w-24"
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={placesMaxQueries}
                    onChange={(event) => setPlacesMaxQueries(event.target.value)}
                    disabled={placesLoading}
                  />
                </div>
                <Button
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => void runGooglePlacesScrape()}
                  disabled={placesLoading}
                >
                  {placesLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" />
                      Run Places
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={exportPlacesProspects}
                  disabled={!placesProspects.length || placesLoading}
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {placesError ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {placesError}
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Queries run</div>
                <div className="mt-1 text-lg font-semibold">
                  {placesSummary?.queryCount ?? 0}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Raw places</div>
                <div className="mt-1 text-lg font-semibold">
                  {placesSummary?.rawResultCount ?? 0}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Deduped prospects</div>
                <div className="mt-1 text-lg font-semibold">
                  {placesSummary?.uniqueResultCount ?? placesProspects.length}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Last run</div>
                <div className="mt-1 text-sm font-medium">
                  {placesSummary?.completedAt ? formatDateTime(placesSummary.completedAt) : '-'}
                </div>
              </div>
            </div>

            {placesProspects.length ? (
              <div className="overflow-hidden rounded-md border">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="sticky top-0 z-10 border-b bg-background">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Prospect</th>
                        <th className="px-3 py-2 font-medium">Market</th>
                        <th className="px-3 py-2 font-medium">Contact</th>
                        <th className="px-3 py-2 font-medium">Signal</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {placesProspects.slice(0, 75).map((prospect) => (
                        <tr key={prospect.placeId || `${prospect.name}:${prospect.city}`} className="border-b">
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium">{prospect.name}</div>
                            <div className="mt-1 flex max-w-md items-start gap-1 text-xs text-muted-foreground">
                              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="whitespace-normal">{prospect.formattedAddress || '-'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div>{prospect.city}</div>
                            <div className="text-xs text-muted-foreground">
                              {prospect.primaryType || 'Real estate'}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div>{prospect.phone || '-'}</div>
                            {prospect.website ? (
                              <a
                                className="mt-1 inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-blue-600 hover:underline"
                                href={prospect.website}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {prospect.websiteDomain || 'Website'}
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={prospect.prospectKind === 'maybe_irrelevant' ? 'secondary' : 'outline'}>
                                {prospectKindLabel(prospect.prospectKind)}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {prospect.confidenceScore}/100
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {prospect.rating ? `${prospect.rating} stars` : 'No rating'}
                              {typeof prospect.userRatingCount === 'number'
                                ? ` · ${prospect.userRatingCount} reviews`
                                : ''}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="max-w-[220px] whitespace-normal text-xs text-muted-foreground">
                              {prospect.query}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => loadProspectIntoDraft(prospect)}
                              >
                                Use as draft
                              </Button>
                              {prospect.googleMapsUrl ? (
                                <Button size="sm" variant="ghost" asChild>
                                  <a
                                    href={prospect.googleMapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Maps
                                  </a>
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {placesProspects.length > 75 ? (
                  <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Showing 75 of {placesProspects.length.toLocaleString()} prospects. Export CSV for the full list.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No Google Places prospects loaded yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/30">
                <BriefcaseBusiness className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">{kpis?.total ?? 0}</CardTitle>
              <CardDescription>Total salespeople</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30">
                <UserPlus className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">{kpis?.active ?? 0}</CardTitle>
              <CardDescription>Active sellers</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/30">
                <Copy className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">{kpis?.stripeLinked ?? 0}</CardTitle>
              <CardDescription>Stripe linked</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-950/30">
                <CircleDollarSign className="h-4 w-4" />
              </div>
              <CardTitle className="text-base">{kpis?.payoutsReady ?? 0}</CardTitle>
              <CardDescription>Payouts ready</CardDescription>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Commission payout queue</CardTitle>
              <CardDescription>
                Pending commissions grouped by seller and currency.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="text-sm text-muted-foreground">Ready to pay</div>
                  <div className="mt-1 text-lg font-semibold">
                    {payoutQueue?.readyTotals.length
                      ? payoutQueue.readyTotals
                          .map((total) => formatAmount(total.amountCents, total.currency))
                          .join(', ')
                      : formatAmount(0, 'USD')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {payoutQueue?.readyCommissionCount ?? 0} commissions
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-sm text-muted-foreground">Waiting on Stripe</div>
                  <div className="mt-1 text-lg font-semibold">
                    {payoutQueue?.pendingSetupTotals.length
                      ? payoutQueue.pendingSetupTotals
                          .map((total) => formatAmount(total.amountCents, total.currency))
                          .join(', ')
                      : formatAmount(0, 'USD')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {payoutQueue?.pendingSetupCommissionCount ?? 0} commissions
                  </div>
                </div>
              </div>

              {payoutQueue?.readyBySalesperson.length ? (
                <div className="space-y-2">
                  {payoutQueue.readyBySalesperson.map((entry) => (
                    <div
                      key={`${entry.salespersonId}:${entry.currency}`}
                      className="rounded-md border p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-medium">{entry.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.email}
                            {entry.referralCode ? ` · Code ${entry.referralCode}` : ''}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {entry.openCommissionCount} commissions since{' '}
                            {formatDateTime(entry.oldestEarnedAt)}
                          </div>
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          <div className="text-sm font-semibold">
                            {formatAmount(entry.totalCommissionCents, entry.currency)}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => void paySalesperson(entry.salespersonId, entry.currency)}
                            disabled={actionState[entry.salespersonId] === 'payout'}
                          >
                            {actionState[entry.salespersonId] === 'payout' ? 'Paying...' : 'Pay now'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No payable salesperson commissions yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Commission activity</CardTitle>
              <CardDescription>
                Recent invoice commissions and payout batches.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {payoutQueue?.recentCommissions.length ? (
                <div className="space-y-2">
                  {payoutQueue.recentCommissions.slice(0, 5).map((commission) => (
                    <div key={commission.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{commission.salespersonName}</div>
                          <div className="text-xs text-muted-foreground">
                            Invoice {commission.stripeInvoiceId}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">
                            {formatAmount(commission.commissionAmountCents, commission.currency)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {commission.status} · {formatDateTime(commission.earnedAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {payoutQueue?.payoutHistory.length ? (
                <div className="space-y-2 border-t pt-3">
                  {payoutQueue.payoutHistory.slice(0, 5).map((batch) => (
                    <div key={batch.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{batch.salespersonName}</div>
                          <div className="text-xs text-muted-foreground">
                            {batch.paidAt
                              ? `Paid ${formatDateTime(batch.paidAt)}`
                              : `Created ${formatDateTime(batch.createdAt)}`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">
                            {formatAmount(batch.totalCommissionCents, batch.currency)}
                          </div>
                          <Badge variant={batch.status === 'paid' ? 'default' : 'secondary'}>
                            {batch.status}
                          </Badge>
                        </div>
                      </div>
                      {batch.failureReason ? (
                        <div className="mt-2 text-xs text-destructive">{batch.failureReason}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {!payoutQueue?.recentCommissions.length && !payoutQueue?.payoutHistory.length ? (
                <div className="text-sm text-muted-foreground">No commission activity yet.</div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" />
                Add salesperson
              </CardTitle>
              <CardDescription>
                Create the seller, send onboarding, and keep commission tracking ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                className="bg-red-600 hover:bg-red-700"
                onClick={() => setAddDialogOpen(true)}
              >
                <UserPlus className="h-4 w-4" />
                Add salesperson
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stripe payout setup</CardTitle>
              <CardDescription>
                Create or refresh Stripe Express onboarding links for direct sellers.
                {liveSalespeopleCount > 0 ? ` ${liveSalespeopleCount} live now.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading salespeople...
                </div>
              ) : activeSalespeople.length ? (
                <div className="space-y-3">
                  {activeSalespeople.map((salesperson) => {
                    const loadingState = actionState[salesperson.id];
                    const settings = settingsDrafts[salesperson.id] ?? {
                      referralCode: salesperson.referralCode ?? '',
                      commissionRatePercent: String(salesperson.commissionRateBps / 100),
                      commissionDurationMonths: String(salesperson.commissionDurationMonths ?? 12),
                      status: salesperson.status,
                      role: salesperson.role ?? '',
                      territory: salesperson.territory ?? '',
                    };

                    return (
                      <div key={salesperson.id} className="rounded-md border p-4">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{salesperson.fullName}</div>
                              <Badge variant={statusVariant(salesperson.status)}>
                                {salesperson.status}
                              </Badge>
                              {salesperson.stripePayoutsEnabled ? (
                                <Badge variant="outline" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  payouts ready
                                </Badge>
                              ) : salesperson.stripeConnectAccountId ? (
                                <Badge variant="outline" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Stripe pending
                                </Badge>
                              ) : null}
                              {salesperson.onboardingCompletedAt || salesperson.workspaceId ? (
                                <Badge variant="outline" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  workspace ready
                                </Badge>
                              ) : (
                                <Badge variant="secondary">invite pending</Badge>
                              )}
                              {salesperson.isLive ? (
                                <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                                  <Activity className="h-3 w-3" />
                                  live
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1 text-muted-foreground">
                                  <Circle className="h-3 w-3 fill-muted-foreground/30" />
                                  offline
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{salesperson.email}</span>
                              {salesperson.role ? <span>{salesperson.role}</span> : null}
                              {salesperson.territory ? <span>{salesperson.territory}</span> : null}
                              <span>{formatCommissionRate(salesperson.commissionRateBps)}</span>
                              <span>{salesperson.commissionDurationMonths} months</span>
                              <span>Added {formatDateTime(salesperson.createdAt)}</span>
                              {salesperson.invitedAt ? (
                                <span>Invited {formatDateTime(salesperson.invitedAt)}</span>
                              ) : null}
                              <span>
                                {salesperson.isLive
                                  ? `${formatDuration(salesperson.currentSessionDurationSeconds)} current session`
                                  : `Last active ${formatRelativeTime(salesperson.lastActiveAt)}`}
                              </span>
                              <span>
                                Dialer {salesperson.dialerNumber.phoneNumber ?? 'not assigned'}
                              </span>
                              {salesperson.dialerNumber.inboundForwardTo ? (
                                <span>Forwards to {salesperson.dialerNumber.inboundForwardTo}</span>
                              ) : null}
                            </div>
                            <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                  <PhoneCall className="h-4 w-4 text-muted-foreground" />
                                  {salesperson.dialerNumber.phoneNumber ?? 'No dedicated number'}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {salesperson.dialerNumber.phoneNumber
                                    ? `Status ${salesperson.dialerNumber.numberStatus}${
                                        salesperson.dialerNumber.numberAssignedAt
                                          ? ` · Assigned ${formatDateTime(salesperson.dialerNumber.numberAssignedAt)}`
                                          : ''
                                      }`
                                    : 'Buy a dedicated Power Dialer number for this salesperson.'}
                                  {salesperson.dialerNumber.inboundForwardTo
                                    ? ` · Redirects to ${salesperson.dialerNumber.inboundForwardTo}`
                                    : ''}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 sm:justify-end">
                                <Input
                                  className="w-24"
                                  inputMode="numeric"
                                  maxLength={3}
                                  placeholder="Area"
                                  value={numberAreaCodes[salesperson.id] ?? ''}
                                  onChange={(event) =>
                                    updateNumberAreaCode(salesperson.id, event.target.value)
                                  }
                                  disabled={
                                    !!loadingState ||
                                    salesperson.dialerNumber.numberStatus === 'active'
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void provisionSalespersonNumber(salesperson.id)}
                                  disabled={
                                    !!loadingState ||
                                    salesperson.dialerNumber.numberStatus === 'active'
                                  }
                                >
                                  {loadingState === 'number' ? 'Buying...' : 'Buy number'}
                                </Button>
                              </div>
                            </div>
                            <div className="grid gap-2 pt-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_110px_120px_auto]">
                              <Input
                                value={settings.referralCode}
                                onChange={(event) =>
                                  updateSettingsDraft(
                                    salesperson.id,
                                    'referralCode',
                                    event.target.value
                                  )
                                }
                                placeholder="Referral code"
                                disabled={!!loadingState}
                              />
                              <Input
                                value={settings.territory}
                                onChange={(event) =>
                                  updateSettingsDraft(
                                    salesperson.id,
                                    'territory',
                                    event.target.value
                                  )
                                }
                                placeholder="Territory"
                                disabled={!!loadingState}
                              />
                              <Input
                                type="number"
                                min={1}
                                max={100}
                                step="0.5"
                                value={settings.commissionRatePercent}
                                onChange={(event) =>
                                  updateSettingsDraft(
                                    salesperson.id,
                                    'commissionRatePercent',
                                    event.target.value
                                  )
                                }
                                disabled={!!loadingState}
                              />
                              <Input
                                type="number"
                                min={1}
                                max={36}
                                step={1}
                                value={settings.commissionDurationMonths}
                                onChange={(event) =>
                                  updateSettingsDraft(
                                    salesperson.id,
                                    'commissionDurationMonths',
                                    event.target.value
                                  )
                                }
                                title="Commission duration in months"
                                disabled={!!loadingState}
                              />
                              <select
                                className="h-9 rounded-md border bg-background px-3 text-sm"
                                value={settings.status}
                                onChange={(event) =>
                                  updateSettingsDraft(
                                    salesperson.id,
                                    'status',
                                    event.target.value as SalespersonStatus
                                  )
                                }
                                disabled={!!loadingState}
                              >
                                <option value="active">Active</option>
                                <option value="paused">Paused</option>
                                <option value="inactive">Inactive</option>
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void saveSettings(salesperson.id)}
                                disabled={!!loadingState}
                              >
                                {loadingState === 'save' ? 'Saving...' : 'Save'}
                              </Button>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 xl:justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void copyInviteLink(salesperson.inviteUrl, salesperson.fullName)
                              }
                              disabled={!!loadingState}
                            >
                              Copy invite
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void createStripeLink(salesperson.id)}
                              disabled={!!loadingState}
                            >
                              {loadingState === 'stripe'
                                ? 'Creating link...'
                                : salesperson.stripeConnectAccountId
                                  ? 'Copy Stripe link'
                                  : 'Create Stripe link'}
                            </Button>
                            {salesperson.referralCode ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void copyReferralCode(
                                    salesperson.referralCode ?? '',
                                    salesperson.fullName
                                  )
                                }
                                disabled={!!loadingState}
                              >
                                Copy code
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No active salespeople yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
