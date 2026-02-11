/** Format distance for display (e.g. "12.1"). */
export function formatDistanceWalked(distanceWalked: number): string {
  return distanceWalked.toFixed(1);
}

/** Format time tracked (minutes) as "Xh Ym" or "Ym". */
export function formatTimeTracked(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/** Format conversation-per-door for display. */
export function formatConversationPerDoor(value: number): string {
  return value.toFixed(1);
}

/** Normalize rate to 0–100 for display (DB may store 0–1 or 0–100). */
export function ratePercent(value: number): number {
  if (value <= 1) return value * 100;
  return value;
}

/** Format updated_at for display (e.g. "Updated 5m ago"). */
export function formatUpdatedAt(updatedAt: string): string {
  if (!updatedAt) return 'Updated just now';
  try {
    const d = new Date(updatedAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Updated just now';
    if (diffMins < 60) return `Updated ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Updated ${diffHours}h ago`;
    return d.toLocaleDateString();
  } catch {
    return 'Updated just now';
  }
}

/** Relative time for last session (e.g. "5m ago", "2h ago", "3d ago"). */
export function timeAgo(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '—';
  }
}
