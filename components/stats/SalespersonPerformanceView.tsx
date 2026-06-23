'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '@/lib/workspace-context';
import { StatCard } from './StatCard';

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly';

type CommissionTotal = {
  currency: string;
  earnedCents: number;
  paidCents: number;
  pendingCents: number;
};

type PerformancePayload = {
  period: PeriodKey;
  range: {
    start: string;
    end: string;
  };
  salesperson: {
    fullName: string;
    email: string;
    referralCode: string;
    trackedLink: string | null;
  };
  outreach: {
    calls: number;
    answers: number;
    messages: number;
    outboundMessages: number;
    inboundMessages: number;
    emails: number;
  };
  links: {
    opens: number;
    signups: number;
  };
  revenue: {
    payingUsers: number;
    commissionTotals: CommissionTotal[];
  };
  demoVideo: {
    sessions: number;
    pageViews: number;
    videoStarts: number;
    playWithSound: number;
    progress25: number;
    progress50: number;
    progress75: number;
    completions: number;
    ctaShown: number;
    startTrialClicks: number;
    founderCallClicks: number;
    exits: number;
    averageWatchSeconds: number;
    maxWatchSeconds: number;
  };
};

const PERIODS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatCommissionTotal(totals: CommissionTotal[]): string {
  if (!totals.length) return '$0';
  return totals
    .map((total) => formatCurrency(total.earnedCents, total.currency))
    .join(' / ');
}

function formatRange(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${formatter.format(new Date(start))} - ${formatter.format(new Date(end))}`;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  await navigator.clipboard.writeText(value);
  return true;
}

export function SalespersonPerformanceView() {
  const { currentWorkspaceId, isLoading: workspaceLoading } = useWorkspace();
  const [period, setPeriod] = useState<PeriodKey>('weekly');
  const [payload, setPayload] = useState<PerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadPerformance = useCallback(async () => {
    if (workspaceLoading) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ period });
      if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
      const response = await fetch(`/api/salesperson/performance?${params.toString()}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => null)) as
        | (PerformancePayload & { error?: string })
        | null;
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to load performance');
      }
      setPayload(data);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load performance');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, period, workspaceLoading]);

  useEffect(() => {
    void loadPerformance();
  }, [loadPerformance]);

  const primaryCommission = useMemo(() => payload?.revenue.commissionTotals[0] ?? null, [payload]);
  const answerRate = payload?.outreach.calls
    ? Math.round((payload.outreach.answers / payload.outreach.calls) * 100)
    : 0;

  if (loading && !payload) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-border bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-normal text-foreground">Performance</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {payload ? `${payload.salesperson.fullName} · ${formatRange(payload.range.start, payload.range.end)}` : 'Salesperson activity'}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Tabs value={period} onValueChange={(value) => setPeriod(value as PeriodKey)}>
            <TabsList className="grid grid-cols-4">
              {PERIODS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button type="button" variant="outline" size="icon" onClick={() => void loadPerformance()} aria-label="Refresh performance">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {payload ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Calls" value={formatCount(payload.outreach.calls)} />
            <StatCard label="Answers" value={formatCount(payload.outreach.answers)} />
            <StatCard label="Messages" value={formatCount(payload.outreach.messages)} />
            <StatCard label="Emails" value={formatCount(payload.outreach.emails)} />
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Links opened" value={formatCount(payload.links.opens)} />
            <StatCard label="Sign ups" value={formatCount(payload.links.signups)} />
            <StatCard label="Users paying" value={formatCount(payload.revenue.payingUsers)} />
            <StatCard label="Commissions earned" value={formatCommissionTotal(payload.revenue.commissionTotals)} />
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Demo views" value={formatCount(payload.demoVideo.pageViews)} />
            <StatCard label="Video starts" value={formatCount(payload.demoVideo.videoStarts)} />
            <StatCard label="Avg watch" value={formatDuration(payload.demoVideo.averageWatchSeconds)} />
            <StatCard label="Trial clicks" value={formatCount(payload.demoVideo.startTrialClicks)} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Tracked Link</CardTitle>
                <CardDescription>Open counts start when this link is shared.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
                  <span className="block truncate">{payload.salesperson.trackedLink ?? 'No referral code assigned'}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!payload.salesperson.trackedLink}
                  onClick={async () => {
                    if (!payload.salesperson.trackedLink) return;
                    const ok = await copyText(payload.salesperson.trackedLink);
                    setCopied(ok);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Breakdown</CardTitle>
                <CardDescription>Current filter totals.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Answer rate</span>
                  <span className="font-medium text-foreground">{answerRate}%</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Outbound messages</span>
                  <span className="font-medium text-foreground">{formatCount(payload.outreach.outboundMessages)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Inbound messages</span>
                  <span className="font-medium text-foreground">{formatCount(payload.outreach.inboundMessages)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Paid commissions</span>
                  <span className="font-medium text-foreground">
                    {primaryCommission ? formatCurrency(primaryCommission.paidCents, primaryCommission.currency) : '$0'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Pending commissions</span>
                  <span className="font-medium text-foreground">
                    {primaryCommission ? formatCurrency(primaryCommission.pendingCents, primaryCommission.currency) : '$0'}
                  </span>
                </div>
                <div className="border-t border-border pt-3" />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Play with sound</span>
                  <span className="font-medium text-foreground">{formatCount(payload.demoVideo.playWithSound)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Reached 25% / 50% / 75%</span>
                  <span className="font-medium text-foreground">
                    {formatCount(payload.demoVideo.progress25)} / {formatCount(payload.demoVideo.progress50)} / {formatCount(payload.demoVideo.progress75)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Completed demo</span>
                  <span className="font-medium text-foreground">{formatCount(payload.demoVideo.completions)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Founder call clicks</span>
                  <span className="font-medium text-foreground">{formatCount(payload.demoVideo.founderCallClicks)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Max watch</span>
                  <span className="font-medium text-foreground">{formatDuration(payload.demoVideo.maxWatchSeconds)}</span>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
