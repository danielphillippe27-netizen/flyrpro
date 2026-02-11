import { METRICS, TIMEFRAMES } from '../lib/leaderboard'
import type { LeaderboardMetric, LeaderboardTimeframe } from '../types/leaderboard'

const ACCENT = '#ff4f4f'

export interface LeaderboardTableHeaderProps {
  metric: LeaderboardMetric
  timeframe: LeaderboardTimeframe
  onMetricChange: (m: LeaderboardMetric) => void
  onTimeframeChange: (t: LeaderboardTimeframe) => void
}

export function LeaderboardTableHeader({
  metric,
  timeframe,
  onMetricChange,
  onTimeframeChange,
}: LeaderboardTableHeaderProps) {
  const timeframeLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '16px',
        padding: '12px 0',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Period</span>
        <select
          value={timeframe}
          onChange={(e) => onTimeframeChange(e.target.value as LeaderboardTimeframe)}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text)',
            padding: '8px 12px',
            fontSize: '14px',
          }}
        >
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: ACCENT, fontSize: '14px', fontWeight: 600 }}>Metric</span>
        <select
          value={metric}
          onChange={(e) => onMetricChange(e.target.value as LeaderboardMetric)}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            color: 'var(--text)',
            padding: '8px 12px',
            fontSize: '14px',
          }}
        >
          {METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
        Showing: {timeframeLabel}
      </span>
    </div>
  )
}
