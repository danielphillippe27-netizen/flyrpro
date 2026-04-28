/** Snapshot of metrics for a timeframe (daily, weekly, all_time). */
export interface MetricSnapshot {
  doorknocks: number
  leads: number
  conversations: number
  distance: number
}

export type LeaderboardMetric =
  | 'doorknocks'
  | 'conversations'
  | 'distance'

export type LeaderboardTimeframe = 'daily' | 'weekly' | 'monthly' | 'all_time'

export interface LeaderboardUser {
  id: string
  name: string
  avatar_url: string | null
  snapshots: {
    daily?: MetricSnapshot
    weekly?: MetricSnapshot
    monthly?: MetricSnapshot
    all_time: MetricSnapshot
  }
}
