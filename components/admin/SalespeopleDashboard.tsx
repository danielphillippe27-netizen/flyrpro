'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

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

function statusVariant(status: SalespersonStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'paused') return 'secondary';
  return 'outline';
}

export function SalespeopleDashboard({ stripeNotice }: { stripeNotice: string | null }) {
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
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || 'Failed to add salesperson.');
      }
      setDraft(emptyDraft);
      await loadSalespeople();
      setStatusMessage(
        result.salesperson?.inviteUrl
          ? `Salesperson added. Invite link ready: ${result.salesperson.inviteUrl}`
          : result.salesperson?.referralCode
            ? `Salesperson added with code ${result.salesperson.referralCode}.`
          : 'Salesperson added.'
      );
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : 'Failed to add salesperson.');
    } finally {
      setSubmitting(false);
    }
  }, [draft, loadSalespeople]);

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
                Add the seller, copy their onboarding invite, then create their Stripe payout link.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-name">Full name</Label>
                  <Input
                    id="salesperson-name"
                    value={draft.fullName}
                    onChange={(event) => updateDraft('fullName', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-email">Email</Label>
                  <Input
                    id="salesperson-email"
                    type="email"
                    value={draft.email}
                    onChange={(event) => updateDraft('email', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-role">Role</Label>
                  <Input
                    id="salesperson-role"
                    value={draft.role}
                    onChange={(event) => updateDraft('role', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-territory">Territory</Label>
                  <Input
                    id="salesperson-territory"
                    value={draft.territory}
                    onChange={(event) => updateDraft('territory', event.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-code">Referral code</Label>
                  <Input
                    id="salesperson-code"
                    value={draft.referralCode}
                    onChange={(event) => updateDraft('referralCode', event.target.value)}
                    placeholder="Auto-generated"
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesperson-commission">Commission %</Label>
                  <Input
                    id="salesperson-commission"
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
                <Label htmlFor="salesperson-notes">Notes</Label>
                <Textarea
                  id="salesperson-notes"
                  value={draft.notes}
                  onChange={(event) => updateDraft('notes', event.target.value)}
                  disabled={submitting}
                />
              </div>
              <Button
                className="w-full bg-red-600 hover:bg-red-700"
                onClick={() => void createSalesperson()}
                disabled={submitting || !draft.fullName.trim() || !draft.email.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add salesperson'
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stripe payout setup</CardTitle>
              <CardDescription>
                Create or refresh Stripe Express onboarding links for direct sellers.
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
