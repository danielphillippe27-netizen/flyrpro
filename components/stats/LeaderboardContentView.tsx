'use client';

import { useState, useEffect, useCallback } from 'react';
import { LeaderboardService } from '@/lib/services/LeaderboardService';
import { getClientAsync } from '@/lib/supabase/client';
import type {
  LeaderboardEntry,
  LeaderboardSortBy,
  LeaderboardTimeframe,
  BrokerageLeaderboardEntry,
  BrokerageLeaderboardTimeframe,
} from '@/types/database';
import { LeaderboardView } from './LeaderboardView';
import { BrokerageLeaderboardView } from './BrokerageLeaderboardView';
import { MetricPickerView } from './MetricPickerView';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

type LeaderboardMode = 'agents' | 'brokerages';

const BROKERAGE_TIMEFRAMES: { value: BrokerageLeaderboardTimeframe; label: string }[] = [
  { value: 'all_time', label: 'All Time' },
  { value: 'month', label: 'This Month' },
];

export function LeaderboardContentView() {
  const [mode, setMode] = useState<LeaderboardMode>('agents');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [brokerageEntries, setBrokerageEntries] = useState<BrokerageLeaderboardEntry[]>([]);
  const [sortBy, setSortBy] = useState<LeaderboardSortBy>('flyers');
  const [timeframe, setTimeframe] = useState<LeaderboardTimeframe>('all_time');
  const [brokerageTimeframe, setBrokerageTimeframe] = useState<BrokerageLeaderboardTimeframe>('all_time');
  const [loading, setLoading] = useState(true);
  const [brokerageLoading, setBrokerageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokerageError, setBrokerageError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    getClientAsync()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        setCurrentUserId(session?.user?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await LeaderboardService.fetchLeaderboard(sortBy, 100, 0, timeframe);
      setEntries(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('JWT') || msg.includes('401') || msg.includes('auth')) {
        setError('Please sign in to view the leaderboard.');
      } else if (msg.includes('does not exist') || msg.includes('function')) {
        setError('Leaderboard is temporarily unavailable.');
      } else {
        setError('Could not load leaderboard. Check your connection and try again.');
      }
      console.error('Leaderboard error:', err);
    } finally {
      setLoading(false);
    }
  }, [sortBy, timeframe]);

  const loadBrokerageLeaderboard = useCallback(async () => {
    setBrokerageLoading(true);
    setBrokerageError(null);
    try {
      const data = await LeaderboardService.fetchBrokerageLeaderboard(
        sortBy,
        100,
        0,
        brokerageTimeframe
      );
      setBrokerageEntries(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBrokerageError(msg.includes('function') ? 'Brokerage leaderboard is temporarily unavailable.' : 'Could not load brokerage leaderboard.');
      console.error('Brokerage leaderboard error:', err);
    } finally {
      setBrokerageLoading(false);
    }
  }, [sortBy, brokerageTimeframe]);

  useEffect(() => {
    if (mode === 'agents') loadLeaderboard();
  }, [mode, loadLeaderboard]);

  useEffect(() => {
    if (mode === 'brokerages') loadBrokerageLeaderboard();
  }, [mode, loadBrokerageLeaderboard]);

  useEffect(() => {
    const unsub = LeaderboardService.subscribeToUpdates((newEntries) => {
      setEntries(newEntries);
    });
    return unsub;
  }, []);

  const brokerageTimeframeLabel = BROKERAGE_TIMEFRAMES.find((t) => t.value === brokerageTimeframe)?.label ?? '';

  return (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as LeaderboardMode)}>
        <div className="-mx-4 sticky top-[var(--page-sticky-offset,0px)] z-20 border-b border-border bg-gray-50/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <TabsList>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="brokerages">Brokerages</TabsTrigger>
            </TabsList>
            {mode === 'agents' && (
              <MetricPickerView
                sortBy={sortBy}
                onSortChange={setSortBy}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
              />
            )}
            {mode === 'brokerages' && (
              <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Period</label>
                  <select
                    value={brokerageTimeframe}
                    onChange={(e) => setBrokerageTimeframe(e.target.value as BrokerageLeaderboardTimeframe)}
                    className="h-9 w-[140px] rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    {BROKERAGE_TIMEFRAMES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as LeaderboardSortBy)}
                    className="h-9 w-[160px] rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    <option value="flyers">Flyers</option>
                    <option value="conversations">Conversations</option>
                    <option value="leads">Leads</option>
                    <option value="distance">Distance</option>
                    <option value="time">Time</option>
                    <option value="day_streak">Day streak</option>
                    <option value="best_streak">Best streak</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
        <TabsContent value="agents" className="mt-4">
          <LeaderboardView
            entries={entries}
            loading={loading}
            error={error}
            onRetry={loadLeaderboard}
            currentUserId={currentUserId}
            sortBy={sortBy}
            timeframe={timeframe}
          />
        </TabsContent>
        <TabsContent value="brokerages" className="mt-4">
          <BrokerageLeaderboardView
            entries={brokerageEntries}
            loading={brokerageLoading}
            error={brokerageError}
            onRetry={loadBrokerageLeaderboard}
            sortBy={sortBy}
            timeframeLabel={brokerageTimeframeLabel}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
