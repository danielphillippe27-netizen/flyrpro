'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, MessageCircle, AlertTriangle, Bug, DollarSign, UserRoundPlus, CheckCircle2, Copy } from 'lucide-react';
import { FounderGlobalChallengesSection } from '@/components/challenges/FounderGlobalChallengesSection';

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
  };
  threads: SupportThreadPreview[];
  latestInboundMessages: SupportInboundPreview[];
};

type FeedbackThreadPreview = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  lastFeedbackAt: string;
  unreadForFounder: boolean;
  createdAt: string;
};

type FeedbackItemPreview = {
  id: string;
  threadId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  type: 'bug' | 'feature' | 'other';
  title: string | null;
  body: string;
  createdAt: string;
  context?: Record<string, unknown> | null;
  appVersion: string | null;
  buildNumber: string | null;
  iosVersion: string | null;
  deviceModel: string | null;
  screenName: string | null;
  screenshotUrl: string | null;
};

type FeedbackInboxPayload = {
  kpis: {
    newFeedback: number;
  };
  threads: FeedbackThreadPreview[];
  items: FeedbackItemPreview[];
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

function openUrlInCurrentTab(url: string): boolean {
  if (!url || typeof window === 'undefined') return false;
  window.location.assign(url);
  return true;
}

function buildAmbassadorShareUrl(referralCode: string): string {
  if (typeof window === 'undefined') {
    return `/onboarding?referralCode=${encodeURIComponent(referralCode)}`;
  }

  return `${window.location.origin}/onboarding?referralCode=${encodeURIComponent(referralCode)}`;
}

export function FounderDashboard({
  mode = 'full',
}: {
  mode?: 'full' | 'ambassadors';
}) {
  const [support, setSupport] = useState<SupportInboxPayload | null>(null);
  const [feedback, setFeedback] = useState<FeedbackInboxPayload | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [ambassadors, setAmbassadors] = useState<AmbassadorInboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ambassadorActionState, setAmbassadorActionState] = useState<Record<string, string>>({});
  const [ambassadorStatusMessage, setAmbassadorStatusMessage] = useState<string | null>(null);
  const [ambassadorDrafts, setAmbassadorDrafts] = useState<
    Record<string, AmbassadorSettingsDraft>
  >({});

  const loadSupport = useCallback(async () => {
    const payload = await readJson<SupportInboxPayload>('/api/admin/inbox/support');
    setSupport(payload);
  }, []);

  const loadFeedback = useCallback(async () => {
    const payload = await readJson<FeedbackInboxPayload>(
      '/api/admin/inbox/feedback?itemLimit=40&threadLimit=40'
    );
    setFeedback(payload);
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
      await Promise.all([loadSupport(), loadFeedback(), loadSummary(), loadAmbassadors()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load founder dashboard');
    } finally {
      setLoading(false);
    }
  }, [loadAmbassadors, loadFeedback, loadSummary, loadSupport]);

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
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feedback_items',
        },
        () => {
          void loadFeedback();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFeedback, loadSupport]);

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
        const openedOnboardingUrl = onboardingUrl
          ? openUrlInCurrentTab(onboardingUrl)
          : false;
        const approvalMessage = onboardingUrl
          ? copiedOnboardingUrl
            ? 'Approved. Opening Stripe onboarding and copied the link to your clipboard.'
            : openedOnboardingUrl
              ? 'Approved. Opening Stripe onboarding now.'
              : 'Approved and Stripe onboarding link created.'
          : 'Approved and Stripe onboarding link created.';
        setAmbassadorStatusMessage(
          payload.stripePromotionCodeWarning
            ? `${approvalMessage} ${payload.stripePromotionCodeWarning}`
            : approvalMessage
        );
      } catch (e) {
        setAmbassadorStatusMessage(
          e instanceof Error ? e.message : 'Failed to create Stripe onboarding link.'
        );
      } finally {
        setActionLoading(applicationId, null);
      }
    },
    [ambassadorDrafts, loadAmbassadors, setActionLoading]
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

  /** Desktop/header feedback uses feedback_items; native chat uses support_messages — merge for one at-a-glance list. */
  const latestUserMessages = useMemo(() => {
    type Merged =
      | {
          key: string;
          sortAt: string;
          kind: 'support';
          title: string;
          preview: string;
          href: string;
        }
      | {
          key: string;
          sortAt: string;
          kind: 'feedback';
          title: string;
          preview: string;
          href: string;
          sourceLabel: string;
        };

    const fromSupport: Merged[] = (support?.latestInboundMessages ?? []).map((m) => ({
      key: `s-${m.id}`,
      sortAt: m.createdAt,
      kind: 'support',
      title: displayUserName(m.userName, m.userEmail, m.userId),
      preview: m.body,
      href: `/admin/support?thread=${m.threadId}`,
    }));

    const fromFeedback: Merged[] = (feedback?.items ?? []).map((item) => {
      const source =
        typeof item.context?.source === 'string' ? item.context.source : null;
      const sourceLabel =
        source === 'web' ? 'Web' : source === 'ios' || source === 'app' ? 'App' : 'Feedback';
      return {
        key: `f-${item.id}`,
        sortAt: item.createdAt,
        kind: 'feedback' as const,
        title: displayUserName(item.userName, item.userEmail, item.userId),
        preview: item.title?.trim() ? `${item.title} — ${item.body}` : item.body,
        href: `/admin/feedback?thread=${item.threadId}`,
        sourceLabel,
      };
    });

    return [...fromSupport, ...fromFeedback]
      .sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())
      .slice(0, 20);
  }, [support, feedback]);

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
                Ambassador Applications
              </CardTitle>
              <CardDescription>
                Review creator applications, finish Stripe onboarding, and manage share links and payouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

              {ambassadors?.setupRequired ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Ambassador storage is not ready yet. Run the migration for
                  <span className="font-medium"> ambassador_applications </span>
                  before using this inbox.
                </div>
              ) : null}

              {ambassadorStatusMessage ? (
                <div className="rounded-md border p-3 text-sm">{ambassadorStatusMessage}</div>
              ) : null}

              {ambassadors?.applications.length ? (
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
                              <div className="font-medium text-sm">
                                {application.fullName}
                              </div>
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
                                ? 'Creating Stripe link...'
                                : application.stripeConnectAccountId
                                  ? 'Copy Stripe link'
                                  : 'Approve + Stripe'}
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
                                void handleAmbassadorStatusUpdate(
                                  application.id,
                                  'paused',
                                  'pause'
                                )
                              }
                              disabled={!!loadingState}
                            >
                              Pause
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void handleAmbassadorStatusUpdate(
                                  application.id,
                                  'rejected',
                                  'reject'
                                )
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
              )}

              <div className="grid gap-3 border-t pt-4 md:grid-cols-3">
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

              {ambassadors?.payoutQueue.readyByAmbassador.length ? (
                <div className="space-y-3 border-t pt-4">
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
                            void handleAmbassadorPayout(
                              entry.ambassadorApplicationId,
                              entry.currency
                            )
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
              ) : null}
            </CardContent>
          </Card>
        </section>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Founder Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Who needs a reply now, and is the product healthy this week.
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

      <FounderGlobalChallengesSection />

      <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader>
            <CardDescription>Unread</CardDescription>
            <CardTitle>{support?.kpis.unread ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Needs Reply</CardDescription>
            <CardTitle>{support?.kpis.needsReply ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Open Threads</CardDescription>
            <CardTitle>{support?.kpis.openThreads ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>New Feedback</CardDescription>
            <CardTitle>{feedback?.kpis.newFeedback ?? 0}</CardTitle>
          </CardHeader>
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

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRoundPlus className="h-4 w-4" />
              Ambassador Applications
            </CardTitle>
            <CardDescription>
              Review creator applications and approve them into Stripe onboarding in one click.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            {ambassadors?.setupRequired ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Ambassador storage is not ready yet. Run the migration for
                <span className="font-medium"> ambassador_applications </span>
                before using this inbox.
              </div>
            ) : null}

            {ambassadorStatusMessage ? (
              <div className="rounded-md border p-3 text-sm">{ambassadorStatusMessage}</div>
            ) : null}

            {ambassadors?.applications.length ? (
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
                            <div className="font-medium text-sm">
                              {application.fullName}
                            </div>
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
                              ? 'Creating Stripe link...'
                              : application.stripeConnectAccountId
                                ? 'Copy Stripe link'
                                : 'Approve + Stripe'}
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
                              void handleAmbassadorStatusUpdate(
                                application.id,
                                'paused',
                                'pause'
                              )
                            }
                            disabled={!!loadingState}
                          >
                            Pause
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void handleAmbassadorStatusUpdate(
                                application.id,
                                'rejected',
                                'reject'
                              )
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
            )}

            <div className="grid gap-3 border-t pt-4 md:grid-cols-3">
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

            {ambassadors?.payoutQueue.readyByAmbassador.length ? (
              <div className="space-y-3 border-t pt-4">
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
                          void handleAmbassadorPayout(
                            entry.ambassadorApplicationId,
                            entry.currency
                          )
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
            ) : null}

            {ambassadors?.payoutQueue.recentCommissions.length ? (
              <div className="space-y-3 border-t pt-4">
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
            ) : null}

            {ambassadors?.payoutQueue.payoutHistory.length ? (
              <div className="space-y-3 border-t pt-4">
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
                      {batch.stripeTransferId ? (
                        <span>Transfer {batch.stripeTransferId}</span>
                      ) : null}
                      {batch.failureReason ? <span>{batch.failureReason}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Latest user messages
            </CardTitle>
            <CardDescription>
              App support chat and web/header feedback in one place (newest first).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestUserMessages.length ? (
              <div className="space-y-2">
                {latestUserMessages.map((row) => (
                  <Link
                    key={row.key}
                    href={row.href}
                    className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <Badge variant={row.kind === 'support' ? 'default' : 'secondary'} className="shrink-0 mt-0.5">
                      {row.kind === 'support' ? 'Support' : row.sourceLabel}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{row.title}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{row.preview}</div>
                      <div className="text-xs text-muted-foreground mt-1">{formatDateTime(row.sortAt)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No messages or feedback yet.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Support Inbox
            </CardTitle>
            <CardDescription>App support threads and inbound chat messages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {support?.threads.length ? (
                support.threads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/admin/support?thread=${thread.id}`}
                    className="block rounded-md border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm">
                        {displayUserName(thread.userName, thread.userEmail, thread.userId)}
                      </div>
                      <div className="flex gap-1">
                        {thread.unreadForSupport ? <Badge variant="secondary">Unread</Badge> : null}
                        {thread.needsReply ? <Badge>Needs reply</Badge> : null}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {thread.lastMessagePreview || 'No message preview'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(thread.lastMessageAt)}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No support threads yet.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest inbound
              </div>
              {support?.latestInboundMessages.length ? (
                support.latestInboundMessages.map((message) => (
                  <Link
                    key={message.id}
                    href={`/admin/support?thread=${message.threadId}`}
                    className="block rounded-md border p-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="text-sm">
                      {displayUserName(message.userName, message.userEmail, message.userId)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{message.body}</div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No inbound messages.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="h-4 w-4" />
              Feedback
            </CardTitle>
            <CardDescription>Web (header) and in-app bug reports and requests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {feedback?.items.length ? (
              feedback.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/feedback?thread=${item.threadId}`}
                  className="block rounded-md border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm truncate">
                      {item.title || item.body.slice(0, 70)}
                    </div>
                    <Badge variant="outline">{item.type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.body}</div>
                  <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>{displayUserName(item.userName, item.userEmail, item.userId)}</span>
                    {item.screenName ? <span>Screen: {item.screenName}</span> : null}
                    {item.appVersion ? <span>App: {item.appVersion}</span> : null}
                    {item.deviceModel ? <span>Device: {item.deviceModel}</span> : null}
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No feedback items yet.</div>
            )}
            <div className="pt-2">
              <Link href="/admin/feedback">
                <Button variant="outline" size="sm">Open Feedback Inbox</Button>
              </Link>
            </div>
          </CardContent>
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
