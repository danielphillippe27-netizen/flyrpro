'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatsService } from '@/lib/services/StatsService';
import type { UserStats } from '@/types/database';
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

export function YouViewContent({ userId, authChecked = false }: { userId: string | null; authChecked?: boolean }) {
  const { currentWorkspaceId, membershipsByWorkspaceId, memberCountByWorkspaceId } = useWorkspace();
  const [stats, setStats] = useState<UserStats | null>(null);
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
      setLeadCount(0);
      setAppointmentCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stats';
      setError(message);
      setStats(null);
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
