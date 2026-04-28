import { supabase } from '../supabase'
import type {
  LeaderboardUser,
  MetricSnapshot,
  LeaderboardMetric,
  LeaderboardTimeframe,
} from '../types/leaderboard'

export const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'doorknocks', label: 'Doors' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'distance', label: 'Distance' },
]

export const TIMEFRAMES: { value: LeaderboardTimeframe; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'all_time', label: 'All time' },
]

function rowToSnapshot(row: Record<string, unknown>): MetricSnapshot {
  return {
    doorknocks: Number(row.doorknocks) || 0,
    leads: Number(row.leads) || 0,
    conversations: Number(row.conversations) || 0,
    distance: Number(row.distance) || 0,
  }
}

function normalizeRow(row: Record<string, unknown>): LeaderboardUser {
  const id = String(row.user_id ?? row.id ?? '')
  const allTime =
    row.all_time && typeof row.all_time === 'object'
      ? rowToSnapshot(row.all_time as Record<string, unknown>)
      : rowToSnapshot(row)

  const snapshots: LeaderboardUser['snapshots'] = {
    all_time: allTime,
  }
  if (row.daily && typeof row.daily === 'object') snapshots.daily = rowToSnapshot(row.daily as Record<string, unknown>)
  if (row.weekly && typeof row.weekly === 'object') snapshots.weekly = rowToSnapshot(row.weekly as Record<string, unknown>)
  if (row.monthly && typeof row.monthly === 'object') snapshots.monthly = rowToSnapshot(row.monthly as Record<string, unknown>)

  const name =
    (row.name as string) ||
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
  timeframe: LeaderboardTimeframe,
  limit = 100,
  offset = 0
): Promise<LeaderboardUser[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_metric: metric,
    p_timeframe: timeframe,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data : []).map((row) => normalizeRow(row as Record<string, unknown>))
}

export function getUserValue(
  user: LeaderboardUser,
  metric: LeaderboardMetric,
  timeframe: LeaderboardTimeframe
): number {
  const snapshot = user.snapshots[timeframe] ?? user.snapshots.all_time
  if (!snapshot) return 0
  switch (metric) {
    case 'doorknocks':
      return snapshot.doorknocks
    case 'conversations':
      return snapshot.conversations
    case 'distance':
      return snapshot.distance
    default:
      return 0
  }
}

export function formatLeaderboardValue(metric: LeaderboardMetric, value: number): string {
  switch (metric) {
    case 'distance':
      return `${value.toFixed(1)} km`
    default:
      return String(value)
  }
}

export function getSubtitle(user: LeaderboardUser): string {
  const s = user.snapshots.all_time
  if (!s) return ''
  const parts: string[] = []
  if (s.doorknocks > 0) parts.push(`${s.doorknocks} doors`)
  if (s.conversations > 0) parts.push(`${s.conversations} conv`)
  return parts.join(' · ') || '—'
}
