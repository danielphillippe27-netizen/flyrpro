'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/lib/workspace-context';

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly';

type PerformancePayload = {
  period: PeriodKey;
  salesperson: {
    fullName: string;
    email: string;
  };
  outreach: {
    calls: number;
    answers: number;
    outboundMessages: number;
    emails: number;
    directMessages: number;
    posts: number;
    meetingsBooked: number;
    meetingsHeld: number;
  };
  links: {
    signups: number;
  };
  revenue: {
    paidTeams: number;
    mrrByCurrency: Record<string, number>;
    stripeStatus?: 'connected' | 'unconfigured' | 'error';
  };
  error?: string;
};

const PERIODS: Array<{ value: PeriodKey; label: string; caption: string }> = [
  { value: 'daily', label: 'Today', caption: 'today' },
  { value: 'weekly', label: 'Week', caption: 'this week' },
  { value: 'monthly', label: 'Month', caption: 'this month' },
  { value: 'yearly', label: 'Year', caption: 'this year' },
];

function MetricCard({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <Card className="operator-surface rounded-xl border border-border/70 bg-card shadow-none">
      <CardContent className="px-5 py-5">
        <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
          {new Intl.NumberFormat('en-US').format(value)}
        </p>
        <p className="mt-2 text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function SalespersonCallHomeView() {
  const { currentWorkspaceId } = useWorkspace();
  const [period, setPeriod] = useState<PeriodKey>('daily');
  const [performance, setPerformance] = useState<PerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentWorkspaceId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, workspaceId: currentWorkspaceId });
      const response = await fetch(`/api/salesperson/performance?${params.toString()}`, {
        credentials: 'include',
      });
      const payload = (await response.json().catch(() => null)) as PerformancePayload | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error ?? 'Failed to load performance.');
      }
      setPerformance(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load performance.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPeriod = PERIODS.find((option) => option.value === period) ?? PERIODS[0];
  const metrics = useMemo(() => {
    const outreach = performance?.outreach;
    return [
      { label: 'Calls Made', value: outreach?.calls ?? 0 },
      { label: 'Answers', value: outreach?.answers ?? 0 },
      { label: 'Texts', value: outreach?.outboundMessages ?? 0 },
      { label: 'Emails', value: outreach?.emails ?? 0 },
      { label: 'DMs', value: outreach?.directMessages ?? 0 },
      { label: 'Posts', value: outreach?.posts ?? 0 },
      { label: 'Meetings Booked', value: outreach?.meetingsBooked ?? 0 },
      { label: 'Meetings Held', value: outreach?.meetingsHeld ?? 0 },
      { label: 'Sign Ups', value: performance?.links.signups ?? 0 },
      { label: 'Paid Teams', value: performance?.revenue.paidTeams ?? 0 },
    ];
  }, [performance]);

  const mrrRows = useMemo(() => {
    const rows = Object.entries(performance?.revenue.mrrByCurrency ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return rows.length ? rows : [['USD', 0] as [string, number]];
  }, [performance]);

  if (loading && !performance) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 py-6 pl-0 pr-4 sm:pr-6 lg:pr-8">
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-6 pl-0 pr-4 sm:pr-6 lg:pr-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          {performance?.salesperson.fullName || performance?.salesperson.email || 'Home'}
        </h1>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(value) => setPeriod(value as PeriodKey)}>
            <SelectTrigger className="w-32 bg-card" aria-label="Performance period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh performance"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/10 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            caption={selectedPeriod.caption}
          />
        ))}
      </div>

      <Card className="operator-surface rounded-xl border border-border/70 bg-card shadow-none">
        <CardContent className="px-6 py-6">
          <p className="text-sm font-semibold text-muted-foreground">MRR</p>
          <div className="mt-2 space-y-1">
            {mrrRows.map(([currency, cents]) => (
              <p key={currency} className="text-4xl font-bold tracking-tight text-foreground tabular-nums">
                {formatCurrency(cents, currency)}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {performance?.revenue.stripeStatus === 'unconfigured'
              ? 'Stripe is not configured for this environment.'
              : performance?.revenue.stripeStatus === 'error'
                ? 'Stripe could not be reached. Refresh to try again.'
                : 'Monthly recurring revenue from active Stripe subscriptions'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
