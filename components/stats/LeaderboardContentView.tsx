'use client';

import { useState, useEffect, useCallback } from 'react';
import { LeaderboardService } from '@/lib/services/LeaderboardService';
import type {
  LeaderboardEntry,
  LeaderboardSortBy,
} from '@/types/database';
import { LeaderboardView } from './LeaderboardView';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

type LeaderboardScope = 'global' | 'team';

type TeamLeaderboardRow = {
  user_id: string;
  display_name: string;
  doors_knocked: number;
  conversations: number;
  total_duration_seconds?: number;
  distance_meters?: number;
  last_active_at: string | null;
};

type TeamLeaderboardDiagnostics = {
  source?: 'sessions' | 'user_stats_fallback';
  message?: string | null;
};

const SCOPES: { value: LeaderboardScope; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'team', label: 'Team' },
];

function getMetricValue(
  entry: Pick<LeaderboardEntry, 'flyers' | 'conversations' | 'distance'>,
  sortBy: LeaderboardSortBy
): number {
  switch (sortBy) {
    case 'conversations':
      return entry.conversations;
    case 'distance':
      return entry.distance;
    case 'flyers':
    default:
      return entry.flyers;
  }
}

function sortLeaderboardEntries(
  entries: LeaderboardEntry[],
  sortBy: LeaderboardSortBy
): LeaderboardEntry[] {
  return [...entries]
    .sort((left, right) => {
      const delta = getMetricValue(right, sortBy) - getMetricValue(left, sortBy);
      if (delta !== 0) return delta;
      if (right.conversations !== left.conversations) {
        return right.conversations - left.conversations;
      }
      return (left.name || left.user_email).localeCompare(right.name || right.user_email);
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function mapTeamRows(rows: TeamLeaderboardRow[]): LeaderboardEntry[] {
  return rows.map((row) => ({
    id: row.user_id,
    user_id: row.user_id,
    user_email: '',
    name: row.display_name,
    avatar_url: null,
    flyers: Number(row.doors_knocked) || 0,
    conversations: Number(row.conversations) || 0,
    leads: 0,
    distance: (Number(row.distance_meters) || 0) / 1000,
    time_minutes: (Number(row.total_duration_seconds) || 0) / 60,
    day_streak: 0,
    best_streak: 0,
    rank: 0,
    updated_at: row.last_active_at ?? '',
  }));
}

export function LeaderboardContentView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<LeaderboardSortBy>('flyers');
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamNotice, setTeamNotice] = useState<string | null>(null);
  const {
    currentWorkspace,
    currentWorkspaceId,
    isLoading: workspaceLoading,
    membershipsByWorkspaceId,
  } = useWorkspace();

  const currentRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canRequestTeamLeaderboard = Boolean(currentWorkspaceId) && (currentRole === 'owner' || currentRole === 'admin');
  const effectiveLoading = loading || (scope === 'team' && workspaceLoading);

  const loadLeaderboard = useCallback(async () => {
    if (scope === 'team' && workspaceLoading) {
      return;
    }

    setLoading(true);
    setError(null);
    setTeamNotice(null);
    try {
      if (scope === 'team') {
        if (!currentWorkspaceId) {
          setEntries([]);
          setError('Select a workspace to view the team leaderboard.');
          return;
        }

        if (!canRequestTeamLeaderboard) {
          setEntries([]);
          setError('Team leaderboard is available to workspace owners and admins.');
          return;
        }

        const response = await fetch(
          `/api/team/leaderboard?workspaceId=${encodeURIComponent(currentWorkspaceId)}`
        );
        const payload = (await response.json().catch(() => null)) as
          | { rows?: TeamLeaderboardRow[]; diagnostics?: TeamLeaderboardDiagnostics; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Could not load team leaderboard.');
        }

        const teamEntries = sortLeaderboardEntries(mapTeamRows(payload?.rows ?? []), sortBy);
        setEntries(teamEntries);
        setTeamNotice(payload?.diagnostics?.message ?? null);
        return;
      }

      const data = await LeaderboardService.fetchLeaderboard(sortBy, 100, 0, 'all_time');
      setEntries(sortLeaderboardEntries(data, sortBy));
      setTeamNotice(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('JWT') || msg.includes('401') || msg.includes('auth') || msg.includes('Unauthorized')) {
        setError('Please sign in to view the leaderboard.');
      } else if (msg.includes('forbidden') || msg.includes('Forbidden')) {
        setError('You do not have access to this leaderboard yet.');
      } else if (msg.includes('does not exist') || msg.includes('function')) {
        setError('Leaderboard is temporarily unavailable.');
      } else {
        setError('Could not load leaderboard. Check your connection and try again.');
      }
      setEntries([]);
      console.error('Leaderboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [canRequestTeamLeaderboard, currentWorkspaceId, scope, sortBy, workspaceLoading]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
            Leaderboard
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {scope === 'global'
              ? 'See how everyone stacks up across the platform.'
              : `Track performance inside ${currentWorkspace?.name ?? 'your workspace'}.`}
          </p>
        </div>

        <div className="inline-flex w-full rounded-full border border-zinc-200 bg-white p-1 dark:border-white/10 dark:bg-white/[0.04] sm:w-auto">
          {SCOPES.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setScope(option.value)}
              className={cn(
                'flex-1 rounded-full px-4 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white sm:flex-none',
                scope === option.value && 'bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-black'
              )}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <LeaderboardView
        entries={entries}
        loading={effectiveLoading}
        error={error}
        onRetry={loadLeaderboard}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />
      {scope === 'team' && teamNotice ? (
        <p className="text-xs text-zinc-400">{teamNotice}</p>
      ) : null}
    </div>
  );
}
