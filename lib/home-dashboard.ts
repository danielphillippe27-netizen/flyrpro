/** Response shape from GET /api/home/dashboard */
export interface HomeDashboardData {
  user: { firstName: string };
  stats: {
    doorsAllTime: number;
    totalMinutesAllTime: number;
    doorsThisWeek: number;
    minutesThisWeek: number;
    sessionsThisWeek: number;
    dayStreak: number;
  };
  weeklyGoals: {
    doors: number;
    sessions?: number | null;
    minutes?: number | null;
  };
  recentCampaigns: { id: string; name: string }[];
  lastSessionAt: string | null;
}

export async function fetchHomeDashboard(workspaceId?: string | null): Promise<HomeDashboardData> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  const res = await fetch(`/api/home/dashboard${qs}`, { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized');
    throw new Error(res.status === 500 ? 'Failed to load dashboard' : 'Request failed');
  }
  return res.json();
}
