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
  avatar_url?: string | null;
  country_code?: string | null;
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
  entry: Pick<LeaderboardEntry, 'doorknocks' | 'conversations' | 'leads' | 'distance'>,
  sortBy: LeaderboardSortBy
): number {
  switch (sortBy) {
    case 'conversations':
      return entry.conversations;
    case 'leads':
      return entry.leads;
    case 'distance':
      return entry.distance;
    case 'doorknocks':
    default:
      return entry.doorknocks;
  }
}

function getPendingMetricValue(entry: LeaderboardEntry, sortBy: LeaderboardSortBy): number {
  return entry.pending ? getMetricValue(entry.pending, sortBy) : 0;
}

function sortLeaderboardEntries(
  entries: LeaderboardEntry[],
  sortBy: LeaderboardSortBy
): LeaderboardEntry[] {
  return [...entries]
    .sort((left, right) => {
      if ((right.rank > 0 ? 1 : 0) !== (left.rank > 0 ? 1 : 0)) {
        return (right.rank > 0 ? 1 : 0) - (left.rank > 0 ? 1 : 0);
      }
      const delta = getMetricValue(right, sortBy) - getMetricValue(left, sortBy);
      if (delta !== 0) return delta;
      const pendingDelta = getPendingMetricValue(right, sortBy) - getPendingMetricValue(left, sortBy);
      if (pendingDelta !== 0) return pendingDelta;
      if (right.conversations !== left.conversations) {
        return right.conversations - left.conversations;
      }
      return left.name.localeCompare(right.name);
    });
}

function normalizeLeaderboardName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function dedupeAndRankLeaderboardEntries(
  entries: LeaderboardEntry[],
  sortBy: LeaderboardSortBy
): LeaderboardEntry[] {
  const seenNames = new Set<string>();
  const deduped: LeaderboardEntry[] = [];

  for (const entry of sortLeaderboardEntries(entries, sortBy)) {
    const nameKey = normalizeLeaderboardName(entry.name);
    const key = nameKey || entry.user_id || entry.id;

    if (seenNames.has(key)) {
      continue;
    }

    seenNames.add(key);
    deduped.push(entry);
  }

  let nextRank = 1;
  return deduped.map((entry) => {
    if (entry.rank <= 0) {
      return { ...entry, rank: 0 };
    }
    return { ...entry, rank: nextRank++ };
  });
}

function mapTeamRows(rows: TeamLeaderboardRow[]): LeaderboardEntry[] {
  return rows.map((row) => ({
    id: row.user_id,
    user_id: row.user_id,
    user_email: '',
    name: row.display_name,
    avatar_url: row.avatar_url ?? null,
    country_code: row.country_code ?? null,
    doorknocks: Number(row.doors_knocked) || 0,
    conversations: Number(row.conversations) || 0,
    leads: 0,
    distance: (Number(row.distance_meters) || 0) / 1000,
    rank: 1,
    pending: { doorknocks: 0, conversations: 0, leads: 0, distance: 0 },
    updated_at: row.last_active_at ?? undefined,
  }));
}

export function LeaderboardContentView() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<LeaderboardSortBy>('doorknocks');
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
  const canViewTeamLeaderboard = Boolean(currentWorkspaceId && currentRole);
  const visibleScopes = canViewTeamLeaderboard
    ? SCOPES
    : SCOPES.filter((option) => option.value === 'global');
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

        if (!canViewTeamLeaderboard) {
          setScope('global');
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

        const teamEntries = dedupeAndRankLeaderboardEntries(mapTeamRows(payload?.rows ?? []), sortBy);
        setEntries(teamEntries);
        setTeamNotice(payload?.diagnostics?.message ?? null);
        return;
      }

      const data = await LeaderboardService.fetchLeaderboard(sortBy, 100, 0, 'all_time');
      setEntries(dedupeAndRankLeaderboardEntries(data, sortBy));
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
  }, [canViewTeamLeaderboard, currentWorkspaceId, scope, sortBy, workspaceLoading]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (scope !== 'team') return;
    if (workspaceLoading) return;
    if (canViewTeamLeaderboard) return;
    setScope('global');
  }, [canViewTeamLeaderboard, scope, workspaceLoading]);

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
          {visibleScopes.map((option) => (
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
