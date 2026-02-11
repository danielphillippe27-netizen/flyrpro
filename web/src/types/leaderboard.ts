/** Snapshot of metrics for a timeframe (daily, weekly, all_time). */
export interface MetricSnapshot {
  flyers: number
  leads: number
  conversations: number
  distance: number
  time_minutes: number
  day_streak: number
  best_streak: number
}

export type LeaderboardMetric =
  | 'flyers'
  | 'leads'
  | 'conversations'
  | 'distance'
  | 'time'
  | 'day_streak'
  | 'best_streak'

export type LeaderboardTimeframe = 'daily' | 'weekly' | 'all_time'

export interface LeaderboardUser {
  id: string
  name: string
  avatar_url: string | null
  snapshots: {
    daily?: MetricSnapshot
    weekly?: MetricSnapshot
    all_time: MetricSnapshot
  }
}
