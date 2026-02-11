import { useState, useEffect, useCallback } from 'react'
import { fetchLeaderboard } from '../lib/leaderboard'
import type { LeaderboardUser, LeaderboardMetric, LeaderboardTimeframe } from '../types/leaderboard'
import { supabase } from '../supabase'

export function useLeaderboard() {
  const [users, setUsers] = useState<LeaderboardUser[]>([])
  const [metric, setMetric] = useState<LeaderboardMetric>('flyers')
  const [timeframe, setTimeframe] = useState<LeaderboardTimeframe>('all_time')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchLeaderboard(metric, timeframe)
      setUsers(data)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      setUsers([])
    } finally {
      setIsLoading(false)
    }
  }, [metric, timeframe])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null)
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const retry = useCallback(() => {
    load()
  }, [load])

  return {
    users,
    metric,
    timeframe,
    setMetric,
    setTimeframe,
    isLoading,
    error,
    retry,
    currentUserId,
  }
}
