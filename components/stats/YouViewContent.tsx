'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatsService } from '@/lib/services/StatsService';
import { createClient } from '@/lib/supabase/client';
import type { FinanceEntry, UserStats } from '@/types/database';
import { useWorkspace } from '@/lib/workspace-context';
import {
  formatDistanceWalked,
  formatTimeTracked,
  ratePercent,
} from '@/lib/stats/formatters';
import { StatCard } from './StatCard';
import { SuccessMetricBar } from './SuccessMetricBar';
import { Button } from '@/components/ui/button';

const EMPTY_STATS: UserStats = {
  id: '',
  user_id: '',
  day_streak: 0,
  best_streak: 0,
  doors_knocked: 0,
  flyers: 0,
  conversations: 0,
  leads_created: 0,
  qr_codes_scanned: 0,
  distance_walked: 0,
  time_tracked: 0,
  conversation_per_door: 0,
  conversation_lead_rate: 0,
  qr_code_scan_rate: 0,
  qr_code_lead_rate: 0,
  streak_days: null,
  xp: 0,
  routes_walked: 0,
  updated_at: '',
  created_at: null,
};

type StatsScope = 'self' | 'team';

type TeamRosterResponse = {
  members?: Array<{
    user_id: string;
    display_name: string;
  }>;
};

type TeamSummaryResponse = {
  totals?: {
    leads?: number;
    appointments?: number;
  };
};

type FinanceSource = 'campaign' | 'farm' | null;

type FarmIdRow = {
  id: string;
};

type FarmMetaAdSpendRow = {
  spend: number | string | null;
};

function formatCurrencyFromCents(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

function getFinanceEntrySource(entry: FinanceEntry): FinanceSource {
  if (entry.farm_id) return 'farm';
  if (entry.campaign_id) return 'campaign';
  return null;
}

function formatSpendDateLabel(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

async function fetchWorkspaceMetaAdSpendCents(workspaceId: string): Promise<number> {
  const supabase = createClient();
  const { data: farms, error: farmsError } = await supabase
    .from('farms')
    .select('id')
    .eq('workspace_id', workspaceId);

  if (farmsError) return 0;

  const farmIds = ((farms ?? []) as FarmIdRow[]).map((farm) => farm.id).filter(Boolean);
  if (farmIds.length === 0) return 0;

  const { data: metrics, error: metricsError } = await supabase
    .from('farm_meta_ad_daily_metrics')
    .select('spend')
    .in('farm_id', farmIds);

  if (metricsError) return 0;

  return ((metrics ?? []) as FarmMetaAdSpendRow[]).reduce(
    (sum, metric) => sum + Math.round(Number(metric.spend || 0) * 100),
    0
  );
}

export function YouViewContent({ userId, authChecked = false }: { userId: string | null; authChecked?: boolean }) {
  const { currentWorkspaceId, membershipsByWorkspaceId, memberCountByWorkspaceId } = useWorkspace();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [financeEntries, setFinanceEntries] = useState<FinanceEntry[]>([]);
  const [metaAdSpendCents, setMetaAdSpendCents] = useState(0);
  const [leadCount, setLeadCount] = useState(0);
  const [appointmentCount, setAppointmentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<StatsScope>('self');
  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canViewTeamMetrics =
    Boolean(currentWorkspaceId) &&
    (currentRole === 'owner' || currentRole === 'admin') &&
    (memberCountByWorkspaceId[currentWorkspaceId ?? ''] ?? 0) > 1;

  const loadStats = useCallback(async () => {
    if (!userId) {
      setStats(null);
      setFinanceEntries([]);
      setMetaAdSpendCents(0);
      setLeadCount(0);
      setAppointmentCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const financePromise = currentWorkspaceId
        ? supabase
            .from('finance_entries')
            .select('*')
            .eq('workspace_id', currentWorkspaceId)
            .order('incurred_on', { ascending: true })
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null });
      const metaAdSpendPromise = currentWorkspaceId
        ? fetchWorkspaceMetaAdSpendCents(currentWorkspaceId)
        : Promise.resolve(0);

      if (scope === 'team' && canViewTeamMetrics && currentWorkspaceId) {
        const rosterResponse = await fetch(`/api/team/roster?workspaceId=${encodeURIComponent(currentWorkspaceId)}`);
        if (!rosterResponse.ok) {
          const payload = (await rosterResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'Failed to load team roster');
        }

        const rosterData = (await rosterResponse.json()) as TeamRosterResponse;
        const memberIds = Array.isArray(rosterData.members)
          ? rosterData.members.map((member) => member.user_id).filter(Boolean)
          : [];

        const [statsRows, summaryResponse] = await Promise.all([
          StatsService.fetchUserStatsForUsers(memberIds),
          fetch(`/api/team/summary?workspaceId=${encodeURIComponent(currentWorkspaceId)}`),
        ]);

        if (!summaryResponse.ok) {
          const payload = (await summaryResponse.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? 'Failed to load team summary');
        }

        const summary = (await summaryResponse.json()) as TeamSummaryResponse;
        setStats(StatsService.aggregateUserStats(statsRows, 'team'));
        setLeadCount(summary.totals?.leads ?? 0);
        setAppointmentCount(summary.totals?.appointments ?? 0);
      } else {
        const [statsResult, leadCountResult, appointmentResult] = await Promise.allSettled([
          StatsService.fetchUserStats(userId),
          StatsService.fetchLeadCount(userId),
          StatsService.fetchAppointmentCount(userId),
        ]);

        if (statsResult.status === 'rejected') {
          throw statsResult.reason;
        }

        setStats(statsResult.value);
        setLeadCount(leadCountResult.status === 'fulfilled' ? leadCountResult.value : 0);
        setAppointmentCount(appointmentResult.status === 'fulfilled' ? appointmentResult.value : 0);
      }

      const financeResult = await financePromise;
      if (financeResult.error) {
        setFinanceEntries([]);
      } else {
        setFinanceEntries((financeResult.data ?? []) as FinanceEntry[]);
      }
      setMetaAdSpendCents(await metaAdSpendPromise);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stats';
      setError(message);
      setStats(null);
      setFinanceEntries([]);
      setMetaAdSpendCents(0);
      setLeadCount(0);
      setAppointmentCount(0);
    } finally {
      setLoading(false);
    }
  }, [canViewTeamMetrics, currentWorkspaceId, scope, userId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (canViewTeamMetrics) return;
    setScope('self');
  }, [canViewTeamMetrics]);

  const displayStats = stats ?? EMPTY_STATS;
  const effectiveLeadsCreated = Math.max(displayStats.leads_created, leadCount);
  const effectiveLeadPerConversation =
    displayStats.conversations > 0 ? (effectiveLeadsCreated / displayStats.conversations) * 100 : 0;
  const appointmentPerConversation =
    displayStats.conversations > 0 ? (appointmentCount / displayStats.conversations) * 100 : 0;
  const heading = scope === 'team' ? 'Team stats' : 'Your stats';
  const description =
    scope === 'team'
      ? 'Team metrics aggregate your workspace members, and lead totals are reconciled from CRM contacts.'
      : 'Session metrics come from the app, and lead totals are reconciled from CRM contacts.';
  const emptyCopy =
    scope === 'team'
      ? 'No team stats recorded yet. Complete a session in the app to see team numbers here.'
      : 'No stats recorded yet. Complete a session in the app to see your numbers here.';
  const visibleFinanceEntries = useMemo(
    () =>
      financeEntries.filter((entry) => {
        const source = getFinanceEntrySource(entry);
        if (!source) return false;
        if (scope === 'team') return true;
        const ownerId = entry.agent_user_id || entry.created_by;
        return ownerId === userId;
      }),
    [financeEntries, scope, userId]
  );
  const manualSpendCents = useMemo(
    () => visibleFinanceEntries.reduce((sum, entry) => sum + Number(entry.total_cost_cents || 0), 0),
    [visibleFinanceEntries]
  );
  const totalSpendCents = manualSpendCents + metaAdSpendCents;
  const campaignSpendCents = useMemo(
    () =>
      visibleFinanceEntries.reduce((sum, entry) => {
        return getFinanceEntrySource(entry) === 'campaign' ? sum + Number(entry.total_cost_cents || 0) : sum;
      }, 0),
    [visibleFinanceEntries]
  );
  const farmSpendCents = useMemo(
    () =>
      visibleFinanceEntries.reduce((sum, entry) => {
        return getFinanceEntrySource(entry) === 'farm' ? sum + Number(entry.total_cost_cents || 0) : sum;
      }, 0),
    [visibleFinanceEntries]
  );
  const spendTrend = useMemo(() => {
    const grouped = new Map<string, { campaignCents: number; farmCents: number }>();

    for (const entry of visibleFinanceEntries) {
      const dateKey = entry.incurred_on || entry.created_at.slice(0, 10);
      const bucket = grouped.get(dateKey) ?? { campaignCents: 0, farmCents: 0 };
      const amount = Number(entry.total_cost_cents || 0);
      const source = getFinanceEntrySource(entry);

      if (source === 'campaign') {
        bucket.campaignCents += amount;
      } else if (source === 'farm') {
        bucket.farmCents += amount;
      }

      grouped.set(dateKey, bucket);
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-6)
      .map(([date, bucket]) => ({
        date,
        campaignCents: bucket.campaignCents,
        farmCents: bucket.farmCents,
        totalCents: bucket.campaignCents + bucket.farmCents,
      }));
  }, [visibleFinanceEntries]);
  const spendChartMax = Math.max(1, ...spendTrend.map((row) => row.totalCents));
  const hasFinancialMetrics = visibleFinanceEntries.length > 0 || metaAdSpendCents > 0;
  const financeDescription =
    scope === 'team'
      ? 'Campaign, farm, and synced Meta Ads financials across the team workspace.'
      : 'Campaign, farm, and synced Meta Ads financials logged for this workspace.';

  // Still resolving auth or loading stats
  if (!authChecked || (userId && loading && !stats && !error)) {
    return (
      <div className="flex items-center justify-center min-h-[200px] py-8 text-gray-600 dark:text-gray-400">
        Loading…
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] py-12 gap-4">
        <p className="text-center text-gray-600 dark:text-gray-400 max-w-sm">{error}</p>
        <button
          type="button"
          onClick={loadStats}
          className="px-5 py-2.5 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Auth resolved and no user
  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] py-12">
        <p className="text-center text-gray-600 dark:text-gray-400">Please sign in to view your stats</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xl font-bold text-white">{heading}</p>
          {canViewTeamMetrics && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={scope === 'self' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setScope('self')}
              >
                Your metrics
              </Button>
              <Button
                type="button"
                variant={scope === 'team' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setScope('team')}
              >
                Team metrics
              </Button>
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
        {!stats && (
          <p className="text-sm text-muted-foreground">{emptyCopy}</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Doors Knocked" value={displayStats.doors_knocked} />
        <StatCard label="Conversations" value={displayStats.conversations} />
        <StatCard label="Leads Created" value={effectiveLeadsCreated} />
        <StatCard label="QR Codes Scanned" value={displayStats.qr_codes_scanned} />
        <StatCard label="Distance Walked" value={`${formatDistanceWalked(displayStats.distance_walked)} km`} />
        <StatCard label="Time Tracked" value={formatTimeTracked(displayStats.time_tracked)} />
      </div>

      {/* Success metrics */}
      <section>
        <h3 className="text-lg font-semibold text-foreground mb-4">Success Metrics</h3>
        <div className="flex flex-col gap-5">
          <SuccessMetricBar
            title="Conversation / Door"
            value={ratePercent(displayStats.conversation_per_door)}
            color="#a855f7"
            description="Conversations per door knocked"
          />
          <SuccessMetricBar
            title="Lead / Conversation"
            value={effectiveLeadPerConversation}
            color="#eab308"
            description="Leads per conversation"
          />
          <SuccessMetricBar
            title="Appointment / Conversation"
            value={appointmentPerConversation}
            color="#ef4444"
            description="Appointments per conversation"
          />
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Financial Metrics</h3>
          <p className="mt-1 text-sm text-muted-foreground">{financeDescription}</p>
        </div>

        {!hasFinancialMetrics ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No campaign or farm financials have been logged yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Spend" value={formatCurrencyFromCents(totalSpendCents)} />
              <StatCard label="Campaign Spend" value={formatCurrencyFromCents(campaignSpendCents)} />
              <StatCard label="Farm Spend" value={formatCurrencyFromCents(farmSpendCents)} />
              <StatCard label="Meta Ads Spend" value={formatCurrencyFromCents(metaAdSpendCents)} />
            </div>

            {spendTrend.length > 0 ? (
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Total Spend Graph</p>
                    <p className="text-xs text-muted-foreground">
                      Recent manual spend by day. Synced Meta Ads spend is included in the totals above.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" aria-hidden />
                      Campaign
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
                      Farm
                    </span>
                    <span>{visibleFinanceEntries.length} entries</span>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {spendTrend.map((row) => {
                    const totalWidth = Math.min(100, (row.totalCents / spendChartMax) * 100);
                    const campaignWidth = row.totalCents > 0 ? (row.campaignCents / row.totalCents) * 100 : 0;
                    const farmWidth = row.totalCents > 0 ? (row.farmCents / row.totalCents) * 100 : 0;

                    return (
                      <div
                        key={row.date}
                        className="grid grid-cols-[72px_minmax(0,1fr)_96px] items-center gap-3 text-sm"
                      >
                        <span className="text-muted-foreground">{formatSpendDateLabel(row.date)}</span>
                        <div className="h-6 rounded-full bg-muted/30 p-1">
                          <div
                            className="flex h-full overflow-hidden rounded-full"
                            style={{ width: `${Math.max(totalWidth, 4)}%` }}
                          >
                            {row.campaignCents > 0 ? (
                              <div className="h-full bg-amber-400" style={{ width: `${campaignWidth}%` }} />
                            ) : null}
                            {row.farmCents > 0 ? (
                              <div className="h-full bg-emerald-400" style={{ width: `${farmWidth}%` }} />
                            ) : null}
                          </div>
                        </div>
                        <span className="text-right font-medium text-foreground">
                          {formatCurrencyFromCents(row.totalCents)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Refresh */}
      <div className="pt-4 text-center">
        <button
          type="button"
          onClick={loadStats}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
