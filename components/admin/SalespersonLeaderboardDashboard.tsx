'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2, Medal, PhoneCall, RefreshCw, Send, Trophy, UserPlus } from 'lucide-react';
import { SalespersonMessenger } from '@/components/home/SalespersonMessenger';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';
type SortKey = 'score' | 'calls' | 'demosSent' | 'signups';

type LeaderboardRow = {
  rank: number;
  salespersonId: string;
  userId: string | null;
  fullName: string;
  email: string;
  role: string | null;
  territory: string | null;
  status: 'active' | 'paused' | 'inactive';
  referralCode: string | null;
  calls: number;
  demosSent: number;
  signups: number;
  score: number;
};

type LeaderboardPayload = {
  setupRequired?: boolean;
  period: PeriodKey;
  sort: SortKey;
  range: { start: string | null; end: string };
  rows: LeaderboardRow[];
  totals: {
    calls: number;
    demosSent: number;
    signups: number;
    score: number;
  };
  error?: string;
};

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: '7 days' },
  { value: 'monthly', label: '30 days' },
  { value: 'yearly', label: 'Year' },
  { value: 'all', label: 'All time' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'calls', label: 'Calls' },
  { value: 'demosSent', label: 'Demos sent' },
  { value: 'signups', label: 'Sign ups' },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value || 0);
}

function statusVariant(status: LeaderboardRow['status']): 'default' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'paused') return 'secondary';
  return 'outline';
}

function maxMetric(rows: LeaderboardRow[], key: SortKey): number {
  return Math.max(1, ...rows.map((row) => row[key] || 0));
}

function StatPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(value)}</div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const isPodium = rank <= 3;
  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold',
        isPodium
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground'
      )}
    >
      {isPodium ? <Medal className="h-4 w-4" /> : rank}
    </div>
  );
}

export function SalespersonLeaderboardDashboard() {
  const [period, setPeriod] = useState<PeriodKey>('monthly');
  const [sort, setSort] = useState<SortKey>('score');
  const [payload, setPayload] = useState<LeaderboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, sort });
      const response = await fetch(`/api/admin/salespeople/leaderboard?${params.toString()}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => null)) as LeaderboardPayload | null;
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to load salesperson leaderboard.');
      }
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load salesperson leaderboard.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [period, sort]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const rows = useMemo(() => payload?.rows ?? [], [payload?.rows]);
  const totals = payload?.totals ?? { calls: 0, demosSent: 0, signups: 0, score: 0 };
  const metricMax = useMemo(() => maxMetric(rows, sort), [rows, sort]);

  return (
    <div className="min-h-full bg-gray-50 p-6 dark:bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sales Leaderboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Rank salespeople by calls, demos sent, sign ups, and weighted score.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={period} onValueChange={(value) => setPeriod(value as PeriodKey)}>
              <SelectTrigger className="w-[136px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void loadLeaderboard()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-4">
          <StatPill icon={BarChart3} label="Score" value={totals.score} />
          <StatPill icon={PhoneCall} label="Calls" value={totals.calls} />
          <StatPill icon={Send} label="Demos sent" value={totals.demosSent} />
          <StatPill icon={UserPlus} label="Sign ups" value={totals.signups} />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="h-4 w-4" />
                Leaderboard
              </CardTitle>
              <CardDescription>
                Score = calls + demos sent x3 + sign ups x10.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex min-h-[440px] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button onClick={() => void loadLeaderboard()}>Retry</Button>
                </div>
              ) : payload?.setupRequired ? (
                <div className="p-6 text-sm text-muted-foreground">
                  Salespeople storage is not ready yet.
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  No salespeople found yet.
                </div>
              ) : (
                <div className="divide-y">
                  {rows.map((row) => (
                    <div key={row.salespersonId} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <RankBadge rank={row.rank} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="truncate text-sm font-semibold text-foreground">{row.fullName}</h2>
                            <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {[row.role, row.territory, row.referralCode ? `Code ${row.referralCode}` : null]
                              .filter(Boolean)
                              .join(' · ') || 'No territory assigned'}
                          </p>
                          {!row.userId ? (
                            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                              No matching app user found for activity metrics.
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-4">
                        {([
                          ['Score', row.score, 'score'],
                          ['Calls', row.calls, 'calls'],
                          ['Demos', row.demosSent, 'demosSent'],
                          ['Sign ups', row.signups, 'signups'],
                        ] as const).map(([label, value, key]) => (
                          <div key={key} className="rounded-md border bg-background p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground">{label}</span>
                              <span className="text-sm font-semibold text-foreground">{formatNumber(value)}</span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-red-600"
                                style={{ width: `${Math.max(4, Math.round((value / metricMax) * 100))}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="xl:sticky xl:top-6">
            <SalespersonMessenger />
          </div>
        </div>
      </div>
    </div>
  );
}
