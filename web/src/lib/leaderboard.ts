import { supabase } from '../supabase'
import type {
  LeaderboardUser,
  MetricSnapshot,
  LeaderboardMetric,
  LeaderboardTimeframe,
} from '../types/leaderboard'

export const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'flyers', label: 'Flyers' },
  { value: 'leads', label: 'Leads' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'distance', label: 'Distance' },
  { value: 'time', label: 'Time' },
  { value: 'day_streak', label: 'Day streak' },
  { value: 'best_streak', label: 'Best streak' },
]

export const TIMEFRAMES: { value: LeaderboardTimeframe; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'all_time', label: 'All time' },
]

/** RPC sort_by param (backend may not support all metrics; we pass what we have). */
const metricToSortBy: Record<LeaderboardMetric, string> = {
  flyers: 'flyers',
  leads: 'leads',
  conversations: 'conversations',
  distance: 'distance',
  time: 'time',
  day_streak: 'day_streak',
  best_streak: 'best_streak',
}

/** Build a MetricSnapshot from a flat row (e.g. from user_stats or RPC). */
function rowToSnapshot(row: Record<string, unknown>): MetricSnapshot {
  return {
    flyers: Number(row.flyers) || 0,
    leads: Number(row.leads ?? row.leads_created) || 0,
    conversations: Number(row.conversations) || 0,
    distance: Number(row.distance ?? row.distance_walked) || 0,
    time_minutes: Number(row.time_minutes ?? row.time_tracked) || 0,
    day_streak: Number(row.day_streak) || 0,
    best_streak: Number(row.best_streak) || 0,
  }
}

/** Normalize a single RPC/API row into LeaderboardUser. Handles both snapshot shape and flat totals. */
function normalizeRow(row: Record<string, unknown>): LeaderboardUser {
  const id = String(row.user_id ?? row.id ?? '')
  const s = row.snapshots as Record<string, unknown> | undefined
  const allTime =
    s?.all_time && typeof s.all_time === 'object'
      ? rowToSnapshot(s.all_time as Record<string, unknown>)
      : rowToSnapshot(row)

  const snapshots: LeaderboardUser['snapshots'] = {
    all_time: allTime,
  }
  if (s?.daily && typeof s.daily === 'object')
    snapshots.daily = rowToSnapshot(s.daily as Record<string, unknown>)
  if (s?.weekly && typeof s.weekly === 'object')
    snapshots.weekly = rowToSnapshot(s.weekly as Record<string, unknown>)

  const name =
    (row.name as string) ||
    (row.user_email as string) ||
    (row.email as string) ||
    'Anonymous'
  const avatar_url = (row.avatar_url as string) || null

  return {
    id,
    name,
    avatar_url: avatar_url || null,
    snapshots,
  }
}

export async function fetchLeaderboard(
  metric: LeaderboardMetric,
  _timeframe: LeaderboardTimeframe,
  limit = 100,
  offset = 0
): Promise<LeaderboardUser[]> {
  const sortBy = metricToSortBy[metric] ?? 'flyers'

  let data: unknown = null
  let error: { message: string } | null = null

  try {
    const result = await supabase.rpc('get_leaderboard', {
      sort_by: sortBy,
      limit_count: limit,
      offset_count: offset,
    })
    data = result.data
    error = result.error
  } catch {
    // Fallback: query user_stats when RPC is missing or fails
    let orderBy = 'flyers'
    if (sortBy === 'conversations') orderBy = 'conversations'
    else if (sortBy === 'leads') orderBy = 'leads_created'
    else if (sortBy === 'distance') orderBy = 'distance_walked'
    else if (sortBy === 'time') orderBy = 'time_tracked'
    else if (sortBy === 'day_streak') orderBy = 'day_streak'
    else if (sortBy === 'best_streak') orderBy = 'best_streak'

    const { data: statsData, error: statsError } = await supabase
      .from('user_stats')
      .select('*')
      .order(orderBy, { ascending: false })
      .range(offset, offset + limit - 1)

    if (statsError) throw statsError

    const rows = (statsData || []).map((stat: Record<string, unknown>) => ({
      ...stat,
      user_id: stat.user_id,
      user_email: '',
      flyers: stat.flyers ?? 0,
      conversations: stat.conversations ?? 0,
      leads_created: stat.leads_created ?? 0,
      distance_walked: stat.distance_walked ?? 0,
      time_tracked: stat.time_tracked ?? 0,
      day_streak: stat.day_streak ?? 0,
      best_streak: stat.best_streak ?? 0,
      leads: stat.leads_created ?? 0,
      time_minutes: stat.time_tracked ?? 0,
      distance: stat.distance_walked ?? 0,
    }))
    return (rows as Record<string, unknown>[]).map((row) => normalizeRow(row))
  }

  if (error) throw new Error(error.message)

  const rows = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data ?? []
  return (rows as Record<string, unknown>[]).map((row) => normalizeRow(row))
}

export function getUserValue(
  user: LeaderboardUser,
  metric: LeaderboardMetric,
  timeframe: LeaderboardTimeframe
): number {
  const snapshot = user.snapshots[timeframe] ?? user.snapshots.all_time
  if (!snapshot) return 0
  switch (metric) {
    case 'flyers':
      return snapshot.flyers
    case 'leads':
      return snapshot.leads
    case 'conversations':
      return snapshot.conversations
    case 'distance':
      return snapshot.distance
    case 'time':
      return snapshot.time_minutes
    case 'day_streak':
      return snapshot.day_streak
    case 'best_streak':
      return snapshot.best_streak
    default:
      return 0
  }
}

export function formatLeaderboardValue(metric: LeaderboardMetric, value: number): string {
  switch (metric) {
    case 'distance':
      return `${value.toFixed(1)} km`
    case 'time':
      return `${Math.round(value)} min`
    default:
      return String(value)
  }
}

export function getSubtitle(user: LeaderboardUser): string {
  const s = user.snapshots.all_time
  if (!s) return ''
  const parts: string[] = []
  if (s.flyers > 0) parts.push(`${s.flyers} flyers`)
  if (s.leads > 0) parts.push(`${s.leads} leads`)
  if (s.conversations > 0) parts.push(`${s.conversations} conv`)
  return parts.join(' · ') || '—'
}
