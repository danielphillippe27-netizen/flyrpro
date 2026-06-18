'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, AlertTriangle, DollarSign, UserRoundPlus, CheckCircle2, Copy } from 'lucide-react';

type SupportThreadPreview = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastSenderType: string | null;
  needsReply: boolean;
  unreadForSupport: boolean;
};

type SupportInboundPreview = {
  id: string;
  threadId: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  body: string;
  createdAt: string;
};

type SupportInboxPayload = {
  kpis: {
    unread: number;
    needsReply: number;
    openThreads: number;
    receivedMessages: number;
  };
  threads: SupportThreadPreview[];
  latestInboundMessages: SupportInboundPreview[];
};

type SummaryPayload = {
  productHealth: {
    signups: { today: number; sevenDays: number };
    activeUsers: { today: number; sevenDays: number };
    sessions: { today: number; sevenDays: number };
    campaignsCreated: { today: number; sevenDays: number };
    crashes: { today: number | null; sevenDays: number | null; available: boolean };
  };
  revenue: {
    activePaidUsers: number;
    activePaidUsersStripe: number;
    activePaidUsersApple: number;
    trialStartsSevenDays: number;
    trialToPaidRolling14Days: number;
    trialToPaidRolling14DaysRate: number | null;
    estimatedMonthlyRevenue: {
      monthlyAmountCents: number | null;
      currency: string | null;
      stripeOnly: boolean;
      stripeSubscriptionCount: number;
      note: string;
    };
  };
  redFlags: {
    paymentIssues: Array<{
      workspaceId: string;
      workspaceName: string;
      ownerId: string | null;
      ownerEmail: string | null;
      ownerName: string | null;
      updatedAt: string;
    }>;
    repeatedErrors: Array<unknown>;
    churnedLastSevenDays: Array<{
      userId: string;
      source: string;
      updatedAt: string;
      userEmail: string | null;
      userName: string | null;
    }>;
  };
};

type AmbassadorApplication = {
  id: string;
  createdAt: string;
  updatedAt: string;
  fullName: string;
  email: string;
  phone: string | null;
  city: string | null;
  primaryNiche: string;
  primaryPlatform: string;
  audienceSize: string | null;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  youtubeHandle: string | null;
  websiteUrl: string | null;
  audienceSummary: string | null;
  whyFlyr: string;
  promotionPlan: string | null;
  status: 'applied' | 'approved' | 'rejected' | 'paused';
  reviewNotes: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  stripeConnectAccountId: string | null;
  stripeOnboardingCompleted: boolean;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  referralCode: string | null;
  referralCodeMaxUses: number | null;
  referralCodeUseCount: number;
  referralCodeRemainingUses: number | null;
  stripePromotionCodeId: string | null;
  commissionRateBps: number;
  commissionDurationMonths: number;
};

type AmbassadorSettingsDraft = {
  referralCode: string;
  referralCodeMaxUses: string;
  commissionRatePercent: string;
  commissionDurationMonths: string;
};

type ManualAmbassadorDraft = {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  primaryNiche: string;
  primaryPlatform: string;
  audienceSize: string;
  instagramHandle: string;
  tiktokHandle: string;
  youtubeHandle: string;
  websiteUrl: string;
  audienceSummary: string;
  whyFlyr: string;
  promotionPlan: string;
  referralCode: string;
  referralCodeMaxUses: string;
  commissionRatePercent: string;
  commissionDurationMonths: string;
};

type AmbassadorProgramTab = 'dashboard' | 'applications' | 'manual';

type AmbassadorCurrencyTotal = {
  currency: string;
  amountCents: number;
  commissionCount: number;
};

type ReadyAmbassadorSummary = {
  ambassadorApplicationId: string;
  fullName: string;
  email: string;
  referralCode: string | null;
  currency: string;
  openCommissionCount: number;
  totalCommissionCents: number;
  totalRevenueCents: number;
  oldestEarnedAt: string;
};

type AmbassadorRecentCommission = {
  id: string;
  ambassadorApplicationId: string;
  ambassadorName: string;
  ambassadorEmail: string | null;
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
};

type AmbassadorPayoutHistoryEntry = {
  id: string;
  ambassadorApplicationId: string | null;
  ambassadorName: string;
  ambassadorEmail: string | null;
  referralCode: string | null;
  currency: string;
  totalCommissionCents: number;
  status: 'draft' | 'processing' | 'paid' | 'failed';
  createdAt: string;
  paidAt: string | null;
  stripeTransferId: string | null;
  failureReason: string | null;
};

type AmbassadorInboxPayload = {
  setupRequired: boolean;
  kpis: {
    applied: number;
    approved: number;
    payoutsReady: number;
  };
  applications: AmbassadorApplication[];
  payoutQueue: {
    readyTotals: AmbassadorCurrencyTotal[];
    pendingSetupTotals: AmbassadorCurrencyTotal[];
    readyCommissionCount: number;
    pendingSetupCommissionCount: number;
    readyByAmbassador: ReadyAmbassadorSummary[];
    recentCommissions: AmbassadorRecentCommission[];
    payoutHistory: AmbassadorPayoutHistoryEntry[];
  };
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Request failed: ${response.status}`);
  }
  return payload as T;
}

function displayUserName(userName: string | null, userEmail: string | null, userId: string | null): string {
  if (userName && userName.trim().length > 0) return userName;
  if (userEmail && userEmail.trim().length > 0) return userEmail;
  return userId ? userId.slice(0, 8) : 'Unknown user';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatMonthlyAmount(cents: number | null, currency: string | null): string {
  if (cents == null || !currency) return 'Not available';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatCommissionRate(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function formatCurrencyTotals(totals: AmbassadorCurrencyTotal[]): string {
  if (!totals.length) return 'None yet';
  return totals
    .map((entry) => `${formatAmount(entry.amountCents, entry.currency)} ${entry.currency}`)
    .join(' · ');
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
      // Fall through to the legacy selection-based approach below.
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

function buildAmbassadorShareUrl(referralCode: string): string {
  if (typeof window === 'undefined') {
    return `/onboarding?referralCode=${encodeURIComponent(referralCode)}`;
  }

  return `${window.location.origin}/onboarding?referralCode=${encodeURIComponent(referralCode)}`;
}

const emptyManualAmbassadorDraft: ManualAmbassadorDraft = {
  fullName: '',
  email: '',
  phone: '',
  city: '',
  primaryNiche: '',
  primaryPlatform: 'Instagram',
  audienceSize: '',
  instagramHandle: '',
  tiktokHandle: '',
  youtubeHandle: '',
  websiteUrl: '',
  audienceSummary: '',
  whyFlyr: 'Manually added by founder.',
  promotionPlan: '',
  referralCode: '',
  referralCodeMaxUses: '',
  commissionRatePercent: '25',
  commissionDurationMonths: '12',
};

export function FounderDashboard({
  mode = 'full',
}: {
  mode?: 'full' | 'ambassadors';
}) {
  const [support, setSupport] = useState<SupportInboxPayload | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [ambassadors, setAmbassadors] = useState<AmbassadorInboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ambassadorActionState, setAmbassadorActionState] = useState<Record<string, string>>({});
  const [ambassadorStatusMessage, setAmbassadorStatusMessage] = useState<string | null>(null);
  const [ambassadorDrafts, setAmbassadorDrafts] = useState<
    Record<string, AmbassadorSettingsDraft>
  >({});
  const [manualAmbassadorDraft, setManualAmbassadorDraft] = useState<ManualAmbassadorDraft>(
    emptyManualAmbassadorDraft
  );
  const [manualAmbassadorSubmitting, setManualAmbassadorSubmitting] = useState(false);
  const [ambassadorProgramTab, setAmbassadorProgramTab] =
    useState<AmbassadorProgramTab>('dashboard');

  const loadSupport = useCallback(async () => {
    const payload = await readJson<SupportInboxPayload>('/api/admin/inbox/support?details=false');
    setSupport(payload);
  }, []);

  const loadSummary = useCallback(async () => {
    const payload = await readJson<SummaryPayload>('/api/admin/inbox/summary');
    setSummary(payload);
  }, []);

  const loadAmbassadors = useCallback(async () => {
    const payload = await readJson<AmbassadorInboxPayload>('/api/admin/ambassadors?limit=20');
    setAmbassadors(payload);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'ambassadors') {
        await loadAmbassadors();
      } else {
        await Promise.all([loadSupport(), loadSummary()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load founder dashboard');
    } finally {
      setLoading(false);
    }
  }, [loadAmbassadors, loadSummary, loadSupport, mode]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!ambassadors?.applications.length) return;
    setAmbassadorDrafts((current) => {
      const next = { ...current };
      for (const application of ambassadors.applications) {
        next[application.id] = {
          referralCode: application.referralCode ?? '',
          referralCodeMaxUses:
            application.referralCodeMaxUses != null
              ? String(application.referralCodeMaxUses)
              : '',
          commissionRatePercent: String(application.commissionRateBps / 100),
          commissionDurationMonths: String(application.commissionDurationMonths),
        };
      }
      return next;
    });
  }, [ambassadors]);

  useEffect(() => {
    if (mode === 'ambassadors') return;

    const supabase = createClient();
    const channel = supabase
      .channel('founder-dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
        },
        () => {
          void loadSupport();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadSupport, mode]);

  const setActionLoading = useCallback((applicationId: string, label: string | null) => {
    setAmbassadorActionState((current) => {
      const next = { ...current };
      if (label) {
        next[applicationId] = label;
      } else {
        delete next[applicationId];
      }
      return next;
    });
  }, []);

  const handleAmbassadorStatusUpdate = useCallback(
    async (
      applicationId: string,
      status: AmbassadorApplication['status'],
      loadingLabel: string
    ) => {
      setActionLoading(applicationId, loadingLabel);
      setAmbassadorStatusMessage(null);
      try {
        const response = await fetch(`/api/admin/ambassadors/${applicationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to update ambassador.');
        }
        await loadAmbassadors();
        setAmbassadorStatusMessage(`Application marked ${status}.`);
      } catch (e) {
        setAmbassadorStatusMessage(
          e instanceof Error ? e.message : 'Failed to update ambassador.'
        );
      } finally {
        setActionLoading(applicationId, null);
      }
    },
    [loadAmbassadors, setActionLoading]
  );

  const handleApproveAndCreateStripeLink = useCallback(
    async (applicationId: string) => {
      setActionLoading(applicationId, 'stripe');
      setAmbassadorStatusMessage(null);
      try {
        const application = ambassadors?.applications.find((item) => item.id === applicationId);
        const draft = ambassadorDrafts[applicationId];
        const trimmedMaxUses = draft?.referralCodeMaxUses?.trim() ?? '';
        const trimmedCommissionRate = draft?.commissionRatePercent?.trim() ?? '';
        const trimmedCommissionDuration = draft?.commissionDurationMonths?.trim() ?? '';
        const response = await fetch(
          `/api/admin/ambassadors/${applicationId}/stripe-connect`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              referralCode: draft?.referralCode?.trim() || undefined,
              referralCodeMaxUses: trimmedMaxUses ? Number(trimmedMaxUses) : null,
              commissionRateBps: trimmedCommissionRate
                ? Math.round(Number(trimmedCommissionRate) * 100)
                : undefined,
              commissionDurationMonths: trimmedCommissionDuration
                ? Number(trimmedCommissionDuration)
                : undefined,
            }),
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to create Stripe onboarding link.');
        }

        const onboardingUrl =
          typeof payload.onboardingUrl === 'string' ? payload.onboardingUrl : '';
        const copiedOnboardingUrl = onboardingUrl
          ? await copyTextToClipboard(onboardingUrl)
          : false;
        await loadAmbassadors();
        const applicantLabel = application?.email ?? 'the applicant';
        const onboardingEmailSent = payload.onboardingEmailSent === true;
        const approvalMessage = onboardingUrl
          ? onboardingEmailSent
            ? copiedOnboardingUrl
              ? `Approved. Stripe onboarding email sent to ${applicantLabel}. Link copied too.`
              : `Approved. Stripe onboarding email sent to ${applicantLabel}.`
            : copiedOnboardingUrl
              ? `Approved. Email was not sent, so the applicant Stripe onboarding link was copied. Send it to ${applicantLabel}.`
              : `Approved. Could not copy automatically. Send this Stripe onboarding link to ${applicantLabel}: ${onboardingUrl}`
          : 'Approved and Stripe onboarding link created.';
        const warnings = [
          typeof payload.onboardingEmailWarning === 'string'
            ? payload.onboardingEmailWarning
            : null,
          typeof payload.stripePromotionCodeWarning === 'string'
            ? payload.stripePromotionCodeWarning
            : null,
        ].filter(Boolean);
        setAmbassadorStatusMessage(
          warnings.length ? `${approvalMessage} ${warnings.join(' ')}` : approvalMessage
        );
      } catch (e) {
        setAmbassadorStatusMessage(
          e instanceof Error ? e.message : 'Failed to create Stripe onboarding link.'
        );
      } finally {
        setActionLoading(applicationId, null);
      }
    },
    [ambassadorDrafts, ambassadors?.applications, loadAmbassadors, setActionLoading]
  );

  const handleAmbassadorDraftChange = useCallback(
    (applicationId: string, field: keyof AmbassadorSettingsDraft, value: string) => {
      setAmbassadorDrafts((current) => ({
        ...current,
        [applicationId]: {
          referralCode: current[applicationId]?.referralCode ?? '',
          referralCodeMaxUses: current[applicationId]?.referralCodeMaxUses ?? '',
          commissionRatePercent: current[applicationId]?.commissionRatePercent ?? '',
          commissionDurationMonths:
            current[applicationId]?.commissionDurationMonths ?? '',
          [field]: value,
        },
      }));
    },
    []
  );

  const handleManualAmbassadorDraftChange = useCallback(
    (field: keyof ManualAmbassadorDraft, value: string) => {
      setManualAmbassadorDraft((current) => ({
        ...current,
        [field]: value,
      }));
    },
    []
  );

  const handleCreateManualAmbassador = useCallback(async () => {
    setManualAmbassadorSubmitting(true);
    setAmbassadorStatusMessage(null);
    try {
      const trimmedMaxUses = manualAmbassadorDraft.referralCodeMaxUses.trim();
      const trimmedCommissionRate = manualAmbassadorDraft.commissionRatePercent.trim();
      const trimmedCommissionDuration = manualAmbassadorDraft.commissionDurationMonths.trim();
      const response = await fetch('/api/admin/ambassadors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...manualAmbassadorDraft,
          status: 'approved',
          referralCode: manualAmbassadorDraft.referralCode.trim() || undefined,
          referralCodeMaxUses: trimmedMaxUses ? Number(trimmedMaxUses) : null,
          commissionRateBps: trimmedCommissionRate
            ? Math.round(Number(trimmedCommissionRate) * 100)
            : undefined,
          commissionDurationMonths: trimmedCommissionDuration
            ? Number(trimmedCommissionDuration)
            : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to add ambassador.');
      }

      await loadAmbassadors();
      setManualAmbassadorDraft(emptyManualAmbassadorDraft);
      const referralCode =
        typeof payload.application?.referralCode === 'string'
          ? payload.application.referralCode
          : null;
      const message = referralCode
        ? `Ambassador added with code ${referralCode}.`
        : 'Ambassador added.';
      setAmbassadorStatusMessage(
        payload.stripePromotionCodeWarning
          ? `${message} ${payload.stripePromotionCodeWarning}`
          : message
      );
    } catch (e) {
      setAmbassadorStatusMessage(e instanceof Error ? e.message : 'Failed to add ambassador.');
    } finally {
      setManualAmbassadorSubmitting(false);
    }
  }, [loadAmbassadors, manualAmbassadorDraft]);

  const handleSaveAmbassadorSettings = useCallback(
    async (applicationId: string) => {
      setActionLoading(applicationId, 'save');
      setAmbassadorStatusMessage(null);
      try {
        const draft = ambassadorDrafts[applicationId] ?? {
          referralCode: '',
          referralCodeMaxUses: '',
          commissionRatePercent: '',
          commissionDurationMonths: '',
        };
        const trimmedMaxUses = draft.referralCodeMaxUses.trim();
        const trimmedCommissionRate = draft.commissionRatePercent.trim();
        const trimmedCommissionDuration = draft.commissionDurationMonths.trim();
        const response = await fetch(`/api/admin/ambassadors/${applicationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            referralCode: draft.referralCode.trim() || undefined,
            referralCodeMaxUses: trimmedMaxUses ? Number(trimmedMaxUses) : null,
            commissionRateBps: trimmedCommissionRate
              ? Math.round(Number(trimmedCommissionRate) * 100)
              : undefined,
            commissionDurationMonths: trimmedCommissionDuration
              ? Number(trimmedCommissionDuration)
              : undefined,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to save ambassador settings.');
        }
        await loadAmbassadors();
        setAmbassadorStatusMessage(
          payload.stripePromotionCodeWarning
            ? `Ambassador settings saved. ${payload.stripePromotionCodeWarning}`
            : 'Ambassador settings saved.'
        );
      } catch (e) {
        setAmbassadorStatusMessage(
          e instanceof Error ? e.message : 'Failed to save ambassador settings.'
        );
      } finally {
        setActionLoading(applicationId, null);
      }
    },
    [ambassadorDrafts, loadAmbassadors, setActionLoading]
  );

  const handleCopyToClipboard = useCallback(async (value: string, label: string) => {
    if (!value) {
      setAmbassadorStatusMessage(`Could not copy ${label}.`);
      return;
    }

    const copied = await copyTextToClipboard(value);
    if (copied) {
      setAmbassadorStatusMessage(`${label} copied to clipboard.`);
    } else {
      setAmbassadorStatusMessage(`Could not copy ${label}.`);
    }
  }, []);

  const handleCopyAmbassadorShareLink = useCallback(
    async (referralCode: string, fullName: string) => {
      if (!referralCode) {
        setAmbassadorStatusMessage('Could not build ambassador share link.');
        return;
      }

      const copied = await copyTextToClipboard(buildAmbassadorShareUrl(referralCode));
      if (copied) {
        setAmbassadorStatusMessage(`${fullName}'s share link copied to clipboard.`);
      } else {
        setAmbassadorStatusMessage(`Could not copy ${fullName}'s share link.`);
      }
    },
    []
  );

  const handleAmbassadorPayout = useCallback(
    async (applicationId: string, currency: string) => {
      setActionLoading(applicationId, 'payout');
      setAmbassadorStatusMessage(null);
      try {
        const response = await fetch('/api/admin/ambassadors/payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ambassadorApplicationId: applicationId,
            currency,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to pay ambassador.');
        }

        await loadAmbassadors();
        const amountLabel =
          typeof payload.totalCommissionCents === 'number' && typeof payload.currency === 'string'
            ? formatAmount(payload.totalCommissionCents, payload.currency)
            : 'the payout';
        setAmbassadorStatusMessage(
          payload.alreadyPaid
            ? `This payout was already completed in Stripe for ${amountLabel}.`
            : `Paid ${payload.ambassadorName || 'ambassador'} ${amountLabel}. Transfer ${payload.transferId || 'created'}.`
        );
      } catch (e) {
        setAmbassadorStatusMessage(
          e instanceof Error ? e.message : 'Failed to pay ambassador.'
        );
      } finally {
        setActionLoading(applicationId, null);
      }
    },
    [loadAmbassadors, setActionLoading]
  );

  const revenueAmount = useMemo(
    () =>
      formatMonthlyAmount(
        summary?.revenue.estimatedMonthlyRevenue.monthlyAmountCents ?? null,
        summary?.revenue.estimatedMonthlyRevenue.currency ?? null
      ),
    [summary]
  );

  const hasReceivedSupportMessages = (support?.kpis.receivedMessages ?? 0) > 0;

  const ambassadorKpiCards = (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Awaiting review</div>
        <div className="font-semibold text-lg">{ambassadors?.kpis.applied ?? 0}</div>
      </div>
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Approved</div>
        <div className="font-semibold text-lg">{ambassadors?.kpis.approved ?? 0}</div>
      </div>
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Payouts ready</div>
        <div className="font-semibold text-lg">{ambassadors?.kpis.payoutsReady ?? 0}</div>
      </div>
    </div>
  );

  const ambassadorSetupNotice = ambassadors?.setupRequired ? (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Ambassador storage is not ready yet. Run the migration for
      <span className="font-medium"> ambassador_applications </span>
      before using this inbox.
    </div>
  ) : null;

  const ambassadorStatusNotice = ambassadorStatusMessage ? (
    <div className="rounded-md border p-3 text-sm">{ambassadorStatusMessage}</div>
  ) : null;

  const ambassadorDashboardActions = (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-medium">Applications</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {ambassadors?.applications.length ?? 0} ambassadors loaded,{' '}
              {ambassadors?.kpis.applied ?? 0} awaiting review.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAmbassadorProgramTab('applications')}
          >
            Open applications
          </Button>
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-medium">Manual Add</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Add an approved ambassador directly with a referral code and commission settings.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAmbassadorProgramTab('manual')}
          >
            Add manually
          </Button>
        </div>
      </div>
    </div>
  );

  const ambassadorApplicationCards = ambassadors?.applications.length ? (
    <div className="space-y-3">
      {ambassadors.applications.map((application) => {
        const loadingState = ambassadorActionState[application.id];
        const draft = ambassadorDrafts[application.id] ?? {
          referralCode: application.referralCode ?? '',
          referralCodeMaxUses:
            application.referralCodeMaxUses != null
              ? String(application.referralCodeMaxUses)
              : '',
          commissionRatePercent: String(application.commissionRateBps / 100),
          commissionDurationMonths: String(application.commissionDurationMonths),
        };
        const handles = [
          application.instagramHandle,
          application.tiktokHandle,
          application.youtubeHandle,
        ].filter(Boolean);
        const shareUrl = application.referralCode
          ? buildAmbassadorShareUrl(application.referralCode)
          : null;

        return (
          <div key={application.id} className="rounded-md border p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-sm">{application.fullName}</div>
                  <Badge
                    variant={
                      application.status === 'approved'
                        ? 'default'
                        : application.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {application.status}
                  </Badge>
                  {application.stripePayoutsEnabled ? (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      payouts ready
                    </Badge>
                  ) : null}
                  {application.stripeConnectAccountId ? (
                    <Badge variant="outline" className="gap-1">
                      <Copy className="h-3 w-3" />
                      Stripe linked
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  <span>{application.email}</span>
                  <span>{application.primaryNiche}</span>
                  <span>{application.primaryPlatform}</span>
                  {application.city ? <span>{application.city}</span> : null}
                  {application.audienceSize ? <span>{application.audienceSize}</span> : null}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                  {application.referralCode ? (
                    <span>Code {application.referralCode}</span>
                  ) : (
                    <span>Code will generate on approval</span>
                  )}
                  <span>
                    {application.referralCodeUseCount} use
                    {application.referralCodeUseCount === 1 ? '' : 's'}
                  </span>
                  <span>
                    {application.referralCodeMaxUses != null
                      ? `${application.referralCodeRemainingUses ?? 0} left of ${application.referralCodeMaxUses}`
                      : 'No referral limit'}
                  </span>
                  <span>
                    {formatCommissionRate(application.commissionRateBps)} for{' '}
                    {application.commissionDurationMonths} months
                  </span>
                </div>
                {shareUrl ? (
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-all">
                    Share link: {shareUrl}
                  </div>
                ) : null}
                <div className="grid gap-2 pt-1 md:grid-cols-[minmax(0,1.2fr)_minmax(160px,0.7fr)_minmax(130px,0.55fr)_minmax(130px,0.55fr)_auto]">
                  <Input
                    value={draft.referralCode}
                    onChange={(event) =>
                      handleAmbassadorDraftChange(
                        application.id,
                        'referralCode',
                        event.target.value
                      )
                    }
                    placeholder="Custom referral code"
                    disabled={!!loadingState}
                  />
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={draft.referralCodeMaxUses}
                    onChange={(event) =>
                      handleAmbassadorDraftChange(
                        application.id,
                        'referralCodeMaxUses',
                        event.target.value
                      )
                    }
                    placeholder="No limit"
                    disabled={!!loadingState}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step="0.5"
                    value={draft.commissionRatePercent}
                    onChange={(event) =>
                      handleAmbassadorDraftChange(
                        application.id,
                        'commissionRatePercent',
                        event.target.value
                      )
                    }
                    placeholder="25"
                    disabled={!!loadingState}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={36}
                    step={1}
                    value={draft.commissionDurationMonths}
                    onChange={(event) =>
                      handleAmbassadorDraftChange(
                        application.id,
                        'commissionDurationMonths',
                        event.target.value
                      )
                    }
                    placeholder="12"
                    disabled={!!loadingState}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSaveAmbassadorSettings(application.id)}
                    disabled={!!loadingState}
                  >
                    {loadingState === 'save' ? 'Saving...' : 'Save settings'}
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Commission % and duration are saved per ambassador before payout tracking starts.
                </div>
                {application.stripePromotionCodeId ? (
                  <div className="text-[11px] text-muted-foreground">
                    Stripe promo code synced
                  </div>
                ) : null}
                {handles.length ? (
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                    {handles.map((handle) => (
                      <span key={handle}>{handle}</span>
                    ))}
                  </div>
                ) : null}
                <div className="text-sm text-muted-foreground line-clamp-2">
                  {application.whyFlyr}
                </div>
                {application.promotionPlan ? (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    Promotion plan: {application.promotionPlan}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  Applied {formatDateTime(application.createdAt)}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button
                  size="sm"
                  onClick={() => void handleApproveAndCreateStripeLink(application.id)}
                  disabled={loadingState === 'stripe' || !!loadingState}
                >
                  {loadingState === 'stripe'
                    ? 'Creating applicant link...'
                    : application.stripeConnectAccountId
                      ? 'Copy applicant Stripe link'
                      : 'Approve + copy Stripe link'}
                </Button>
                {application.referralCode ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleCopyAmbassadorShareLink(
                          application.referralCode ?? '',
                          application.fullName
                        )
                      }
                      disabled={!!loadingState}
                    >
                      Copy share link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void handleCopyToClipboard(
                          application.referralCode ?? '',
                          `${application.fullName}'s referral code`
                        )
                      }
                      disabled={!!loadingState}
                    >
                      Copy code
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void handleAmbassadorStatusUpdate(application.id, 'paused', 'pause')
                  }
                  disabled={!!loadingState}
                >
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void handleAmbassadorStatusUpdate(application.id, 'rejected', 'reject')
                  }
                  disabled={!!loadingState}
                >
                  Reject
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  ) : ambassadors?.setupRequired ? null : (
    <div className="text-sm text-muted-foreground">No ambassador applications yet.</div>
  );

  const ambassadorPayoutSummary = (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Ready to pay</div>
        <div className="font-semibold text-lg">
          {formatCurrencyTotals(ambassadors?.payoutQueue.readyTotals ?? [])}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {ambassadors?.payoutQueue.readyCommissionCount ?? 0} open commission items
        </div>
      </div>
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Waiting on Stripe setup</div>
        <div className="font-semibold text-lg">
          {formatCurrencyTotals(ambassadors?.payoutQueue.pendingSetupTotals ?? [])}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {ambassadors?.payoutQueue.pendingSetupCommissionCount ?? 0} items blocked on payouts
        </div>
      </div>
      <div className="rounded-md border p-3">
        <div className="text-muted-foreground text-sm">Payout-ready ambassadors</div>
        <div className="font-semibold text-lg">
          {ambassadors?.payoutQueue.readyByAmbassador.length ?? 0}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Ambassadors with Stripe enabled and unpaid commission balance
        </div>
      </div>
    </div>
  );

  const ambassadorPayoutBalances = ambassadors?.payoutQueue.readyByAmbassador.length ? (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <DollarSign className="h-4 w-4" />
        Payout-ready balances
      </div>
      {ambassadors.payoutQueue.readyByAmbassador.map((entry) => (
        <div key={`${entry.ambassadorApplicationId}-${entry.currency}`} className="rounded-md border p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="font-medium text-sm">{entry.fullName}</div>
              <div className="text-xs text-muted-foreground">
                {entry.email} {entry.referralCode ? `· Code ${entry.referralCode}` : ''}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {formatAmount(entry.totalCommissionCents, entry.currency)}
              </div>
              <div className="text-xs text-muted-foreground">
                {entry.openCommissionCount} items · revenue{' '}
                {formatAmount(entry.totalRevenueCents, entry.currency)}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Oldest unpaid commission {formatDateTime(entry.oldestEarnedAt)}
            </div>
            <Button
              size="sm"
              onClick={() =>
                void handleAmbassadorPayout(entry.ambassadorApplicationId, entry.currency)
              }
              disabled={
                ambassadorActionState[entry.ambassadorApplicationId] === 'payout' ||
                !!ambassadorActionState[entry.ambassadorApplicationId]
              }
            >
              {ambassadorActionState[entry.ambassadorApplicationId] === 'payout'
                ? 'Paying...'
                : 'Pay now'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const ambassadorRecentCommissions = ambassadors?.payoutQueue.recentCommissions.length ? (
    <div className="space-y-3">
      <div className="text-sm font-medium">Recent commission activity</div>
      {ambassadors.payoutQueue.recentCommissions.map((commission) => (
        <div key={commission.id} className="rounded-md border p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="font-medium text-sm">{commission.ambassadorName}</div>
              <div className="text-xs text-muted-foreground">
                {commission.referralCode ? `Code ${commission.referralCode} · ` : ''}
                Invoice {commission.stripeInvoiceId}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {formatAmount(commission.commissionAmountCents, commission.currency)}
              </div>
              <div className="text-xs text-muted-foreground">
                on {formatAmount(commission.revenueAmountCents, commission.currency)} at{' '}
                {formatCommissionRate(commission.commissionRateBps)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Badge variant={commission.status === 'paid' ? 'default' : 'secondary'}>
              {commission.status}
            </Badge>
            {!commission.payoutsEnabled && commission.status === 'pending' ? (
              <Badge variant="outline">waiting on Stripe setup</Badge>
            ) : null}
            <span>{formatDateTime(commission.earnedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const ambassadorPayoutHistory = ambassadors?.payoutQueue.payoutHistory.length ? (
    <div className="space-y-3">
      <div className="text-sm font-medium">Recent payout history</div>
      {ambassadors.payoutQueue.payoutHistory.map((batch) => (
        <div key={batch.id} className="rounded-md border p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="font-medium text-sm">{batch.ambassadorName}</div>
              <div className="text-xs text-muted-foreground">
                {batch.ambassadorEmail}
                {batch.referralCode ? ` · Code ${batch.referralCode}` : ''}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-sm">
                {formatAmount(batch.totalCommissionCents, batch.currency)}
              </div>
              <div className="text-xs text-muted-foreground">
                {batch.paidAt
                  ? `Paid ${formatDateTime(batch.paidAt)}`
                  : `Created ${formatDateTime(batch.createdAt)}`}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={
                batch.status === 'paid'
                  ? 'default'
                  : batch.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {batch.status}
            </Badge>
            {batch.stripeTransferId ? <span>Transfer {batch.stripeTransferId}</span> : null}
            {batch.failureReason ? <span>{batch.failureReason}</span> : null}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const manualAmbassadorForm = (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-name">Full name</Label>
          <Input
            id="manual-ambassador-name"
            value={manualAmbassadorDraft.fullName}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('fullName', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-email">Email</Label>
          <Input
            id="manual-ambassador-email"
            type="email"
            value={manualAmbassadorDraft.email}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('email', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-phone">Phone</Label>
          <Input
            id="manual-ambassador-phone"
            value={manualAmbassadorDraft.phone}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('phone', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-city">City / market</Label>
          <Input
            id="manual-ambassador-city"
            value={manualAmbassadorDraft.city}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('city', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-niche">Primary niche</Label>
          <Input
            id="manual-ambassador-niche"
            value={manualAmbassadorDraft.primaryNiche}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('primaryNiche', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-platform">Primary platform</Label>
          <Input
            id="manual-ambassador-platform"
            value={manualAmbassadorDraft.primaryPlatform}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('primaryPlatform', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-audience">Audience size</Label>
          <Input
            id="manual-ambassador-audience"
            value={manualAmbassadorDraft.audienceSize}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('audienceSize', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-instagram">Instagram</Label>
          <Input
            id="manual-ambassador-instagram"
            value={manualAmbassadorDraft.instagramHandle}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('instagramHandle', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-tiktok">TikTok</Label>
          <Input
            id="manual-ambassador-tiktok"
            value={manualAmbassadorDraft.tiktokHandle}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('tiktokHandle', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-youtube">YouTube / podcast</Label>
          <Input
            id="manual-ambassador-youtube"
            value={manualAmbassadorDraft.youtubeHandle}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('youtubeHandle', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-website">Website</Label>
          <Input
            id="manual-ambassador-website"
            value={manualAmbassadorDraft.websiteUrl}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('websiteUrl', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-ambassador-code">Referral code</Label>
            <Input
              id="manual-ambassador-code"
              value={manualAmbassadorDraft.referralCode}
              onChange={(event) =>
                handleManualAmbassadorDraftChange('referralCode', event.target.value)
              }
              placeholder="Auto-generate"
              disabled={manualAmbassadorSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-ambassador-limit">Use limit</Label>
            <Input
              id="manual-ambassador-limit"
              type="number"
              min={1}
              step={1}
              value={manualAmbassadorDraft.referralCodeMaxUses}
              onChange={(event) =>
                handleManualAmbassadorDraftChange('referralCodeMaxUses', event.target.value)
              }
              placeholder="No limit"
              disabled={manualAmbassadorSubmitting}
            />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-ambassador-rate">Commission %</Label>
            <Input
              id="manual-ambassador-rate"
              type="number"
              min={1}
              max={100}
              step="0.5"
              value={manualAmbassadorDraft.commissionRatePercent}
              onChange={(event) =>
                handleManualAmbassadorDraftChange('commissionRatePercent', event.target.value)
              }
              disabled={manualAmbassadorSubmitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-ambassador-duration">Duration months</Label>
            <Input
              id="manual-ambassador-duration"
              type="number"
              min={1}
              max={36}
              step={1}
              value={manualAmbassadorDraft.commissionDurationMonths}
              onChange={(event) =>
                handleManualAmbassadorDraftChange(
                  'commissionDurationMonths',
                  event.target.value
                )
              }
              disabled={manualAmbassadorSubmitting}
            />
          </div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-summary">Audience summary</Label>
          <Textarea
            id="manual-ambassador-summary"
            value={manualAmbassadorDraft.audienceSummary}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('audienceSummary', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manual-ambassador-why">Why FLYR</Label>
          <Textarea
            id="manual-ambassador-why"
            value={manualAmbassadorDraft.whyFlyr}
            onChange={(event) =>
              handleManualAmbassadorDraftChange('whyFlyr', event.target.value)
            }
            disabled={manualAmbassadorSubmitting}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="manual-ambassador-plan">Promotion plan</Label>
        <Textarea
          id="manual-ambassador-plan"
          value={manualAmbassadorDraft.promotionPlan}
          onChange={(event) =>
            handleManualAmbassadorDraftChange('promotionPlan', event.target.value)
          }
          disabled={manualAmbassadorSubmitting}
        />
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => void handleCreateManualAmbassador()}
          disabled={manualAmbassadorSubmitting}
        >
          {manualAmbassadorSubmitting ? 'Adding...' : 'Add ambassador'}
        </Button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading founder dashboard...
        </div>
      </div>
    );
  }

  if (mode === 'ambassadors') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ambassador Program</h1>
            <p className="text-muted-foreground mt-1">
              Approvals, share links, Stripe onboarding, and payouts in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void loadAmbassadors()}>
              Refresh
            </Button>
          </div>
        </header>

        <Tabs
          value={ambassadorProgramTab}
          onValueChange={(value) => setAmbassadorProgramTab(value as AmbassadorProgramTab)}
          className="space-y-4"
        >
          <TabsList className="gap-1 bg-transparent p-0">
            <TabsTrigger
              value="dashboard"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value="applications"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Applications
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="operator-surface border border-transparent bg-transparent px-4 data-[state=active]:border-border data-[state=active]:bg-card data-[state=active]:shadow-none focus-visible:ring-0"
            >
              Manual Add
            </TabsTrigger>
          </TabsList>

          {error ? (
            <Card className="border-destructive/40">
              <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : null}

          <section>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserRoundPlus className="h-4 w-4" />
                  Ambassador Program
                </CardTitle>
                <CardDescription>
                  Review creator applications, send applicant Stripe onboarding links, and manage share links and payouts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {ambassadorKpiCards}
                {ambassadorSetupNotice}
                {ambassadorStatusNotice}

                <TabsContent value="dashboard" className="mt-0 space-y-4">
                  {ambassadorDashboardActions}
                  {ambassadorPayoutSummary}
                  {ambassadorPayoutBalances}
                  {ambassadorRecentCommissions}
                  {ambassadorPayoutHistory}
                </TabsContent>
                <TabsContent value="applications" className="mt-0 space-y-4">
                  {ambassadorApplicationCards}
                </TabsContent>
                <TabsContent value="manual" className="mt-0 space-y-4">
                  {manualAmbassadorForm}
                </TabsContent>

              </CardContent>
            </Card>
          </section>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Founder Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Messages received, revenue, and product health at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/link-quality">
            <Button variant="outline">Link QA</Button>
          </Link>
          <Link href="/offers">
            <Button variant="outline">Partner Offers</Button>
          </Link>
          <Button variant="outline" onClick={() => void loadAll()}>
            Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Support Messages</CardDescription>
            <CardTitle>{hasReceivedSupportMessages ? 'Yes' : 'No'}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {hasReceivedSupportMessages
                  ? `${support?.kpis.receivedMessages ?? 0} received`
                  : 'None received yet'}
              </div>
              <Link href="/support">
                <Button variant="outline" size="sm">Open</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Paying Users</CardDescription>
            <CardTitle>{summary?.revenue.activePaidUsers ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Monthly Revenue</CardDescription>
            <CardTitle>{revenueAmount}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Product Health</CardTitle>
            <CardDescription>Today and rolling 7-day pulse.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">New signups</div>
              <div className="font-semibold">{summary?.productHealth.signups.today ?? 0} / {summary?.productHealth.signups.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Active users</div>
              <div className="font-semibold">{summary?.productHealth.activeUsers.today ?? 0} / {summary?.productHealth.activeUsers.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Sessions</div>
              <div className="font-semibold">{summary?.productHealth.sessions.today ?? 0} / {summary?.productHealth.sessions.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Campaigns created</div>
              <div className="font-semibold">{summary?.productHealth.campaignsCreated.today ?? 0} / {summary?.productHealth.campaignsCreated.sevenDays ?? 0}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Revenue Snapshot
            </CardTitle>
            <CardDescription>Current paid users and monthly estimate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Active paid users</div>
              <div className="font-semibold">{summary?.revenue.activePaidUsers ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Stripe: {summary?.revenue.activePaidUsersStripe ?? 0} | Apple: {summary?.revenue.activePaidUsersApple ?? 0}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Trial starts (7d)</div>
              <div className="font-semibold">{summary?.revenue.trialStartsSevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Trial → paid (14d rolling)</div>
              <div className="font-semibold">
                {summary?.revenue.trialToPaidRolling14Days ?? 0}
                {typeof summary?.revenue.trialToPaidRolling14DaysRate === 'number'
                  ? ` (${summary.revenue.trialToPaidRolling14DaysRate}%)`
                  : ''}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Monthly amount</div>
              <div className="font-semibold">{revenueAmount}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {summary?.revenue.estimatedMonthlyRevenue.note ?? 'No revenue note'}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Red Flags
            </CardTitle>
            <CardDescription>Potential issues to review quickly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="font-medium mb-2">Payment issues</div>
              {summary?.redFlags.paymentIssues.length ? (
                <div className="space-y-2">
                  {summary.redFlags.paymentIssues.map((row) => (
                    <div key={row.workspaceId} className="rounded-md border p-2">
                      <div>{row.workspaceName}</div>
                      <div className="text-xs text-muted-foreground">
                        {displayUserName(row.ownerName, row.ownerEmail, row.ownerId)} • {formatDateTime(row.updatedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No payment issues right now.</div>
              )}
            </div>
            <div>
              <div className="font-medium mb-2">Users churned in last 7 days</div>
              {summary?.redFlags.churnedLastSevenDays.length ? (
                <div className="space-y-2">
                  {summary.redFlags.churnedLastSevenDays.map((row) => (
                    <div key={`${row.userId}-${row.updatedAt}`} className="rounded-md border p-2">
                      <div>{displayUserName(row.userName, row.userEmail, row.userId)}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.source} • {formatDateTime(row.updatedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No recent churn flagged.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
