import type { LeaderboardUser, LeaderboardMetric } from '../types/leaderboard'
import {
  getUserValue,
  getUserPendingValue,
  formatLeaderboardValue,
  getSubtitle,
} from '../lib/leaderboard'
import type { LeaderboardTimeframe } from '../types/leaderboard'

const ACCENT = '#ff4f4f'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return (name.slice(0, 2) || '?').toUpperCase()
}

export interface LeaderboardRowProps {
  user: LeaderboardUser
  rank: number
  metric: LeaderboardMetric
  timeframe: LeaderboardTimeframe
  isCurrentUser: boolean
}

export function LeaderboardRow({
  user,
  rank,
  metric,
  timeframe,
  isCurrentUser,
}: LeaderboardRowProps) {
  const value = getUserValue(user, metric, timeframe)
  const formatted = formatLeaderboardValue(metric, value)
  const pendingValue = getUserPendingValue(user, metric)
  const pendingFormatted = formatLeaderboardValue(metric, pendingValue)
  const subtitle = getSubtitle(user)

  const isTopThree = rank > 0 && rank <= 3
  const rankDisplay =
    rank === 1 ? (
      <span style={{ color: ACCENT }} aria-label="Rank 1">👑</span>
    ) : rank <= 0 ? (
      <span style={{ fontSize: '11px', fontWeight: 700, color: ACCENT }}>Live</span>
    ) : (
      <span
        style={{
          fontWeight: isTopThree ? 700 : 500,
          color: isTopThree ? ACCENT : 'var(--text-muted)',
        }}
      >
        #{rank}
      </span>
    )

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        borderRadius: '8px',
        marginBottom: '6px',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          width: '32px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        {rankDisplay}
      </div>
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: 'var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
            {getInitials(user.name)}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{user.name}</span>
          {isCurrentUser && (
            <span
              style={{
                fontSize: '12px',
                background: ACCENT,
                color: '#fff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 500,
              }}
            >
              You
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div
        style={{
          fontWeight: 700,
          color: ACCENT,
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        <div>{formatted}</div>
        {pendingValue > 0 && (
          <div
            style={{
              display: 'inline-block',
              marginTop: '3px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(255, 79, 79, 0.12)',
              fontSize: '11px',
              lineHeight: 1.2,
            }}
          >
            +{pendingFormatted} pending
          </div>
        )}
      </div>
    </div>
  )
}
