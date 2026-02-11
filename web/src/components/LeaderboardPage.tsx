import { useLeaderboard } from '../hooks/useLeaderboard'
import { LeaderboardTableHeader } from './LeaderboardTableHeader'
import { LeaderboardRow } from './LeaderboardRow'

export default function LeaderboardPage() {
  const {
    users,
    metric,
    timeframe,
    setMetric,
    setTimeframe,
    isLoading,
    error,
    retry,
    currentUserId,
  } = useLeaderboard()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          padding: '20px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>Leaderboard</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          See how you rank
        </p>
      </header>
      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '24px' }}>
        <LeaderboardTableHeader
          metric={metric}
          timeframe={timeframe}
          onMetricChange={setMetric}
          onTimeframeChange={setTimeframe}
        />
        {isLoading && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 16px',
              color: 'var(--text-muted)',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid var(--border)',
                borderTopColor: '#ff4f4f',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 12px',
              }}
            />
            Loading leaderboard…
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '24px',
              background: 'rgba(255, 79, 79, 0.1)',
              border: '1px solid #ff4f4f',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <p style={{ margin: '0 0 12px', color: '#ff6b6b' }}>{error.message}</p>
            <button
              type="button"
              onClick={retry}
              style={{
                padding: '8px 16px',
                background: '#ff4f4f',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}
        {!isLoading && !error && users.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 16px',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            No leaderboard entries yet
          </div>
        )}
        {!isLoading && !error && users.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            {users.map((user, index) => (
              <LeaderboardRow
                key={user.id}
                user={user}
                rank={index + 1}
                metric={metric}
                timeframe={timeframe}
                isCurrentUser={user.id === currentUserId}
              />
            ))}
          </div>
        )}
      </main>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
