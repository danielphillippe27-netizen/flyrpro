import type { HomeDashboardData } from '@/lib/home-dashboard';
import type { LeaderboardEntry } from '@/types/database';
import { getClientAsync } from '@/lib/supabase/client';

const DEMO_ACCOUNT_EMAIL = 'daniel.phillippe27@gmail.com';

export async function isFounderDemoAccount(): Promise<boolean> {
  try {
    const supabase = await getClientAsync();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email?.trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
  } catch {
    return false;
  }
}

export const FOUNDER_DEMO_HOME: HomeDashboardData = {
  user: { firstName: 'Daniel', fullName: 'Daniel Phillippe' },
  stats: {
    doorsAllTime: 2846,
    conversationsAllTime: 436,
    totalMinutesAllTime: 7920,
    doorsThisWeek: 186,
    minutesThisWeek: 425,
    sessionsThisWeek: 5,
    dayStreak: 4,
  },
  weeklyGoals: { doors: 300, sessions: 6, minutes: 600 },
  recentCampaigns: [
    { id: 'demo-north-whitby', name: 'North Whitby · Fall Outreach' },
    { id: 'demo-brooklin', name: 'Brooklin · New Neighbourhoods' },
    { id: 'demo-oshawa', name: 'Oshawa · Family Homes' },
  ],
  lastSessionAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  metrics: { doors: 186, convos: 31, leads: 8, appointments: 3 },
};

const ROSTER: Array<[string, string, number, number, number, number]> = [
  ['demo-priya-shah', 'Priya Shah', 248, 42, 11, 18.6],
  ['demo-marcus-bell', 'Marcus Bell', 221, 38, 9, 16.2],
  ['demo-olivia-chen', 'Olivia Chen', 203, 34, 8, 15.4],
  ['demo-daniel-phillippe', 'Daniel Phillippe', 186, 31, 8, 14.1],
  ['demo-noah-bennett', 'Noah Bennett', 172, 29, 7, 13.7],
  ['demo-amina-hassan', 'Amina Hassan', 159, 27, 6, 12.3],
  ['demo-ethan-walker', 'Ethan Walker', 144, 24, 6, 11.8],
  ['demo-sophia-martin', 'Sophia Martin', 131, 21, 5, 10.9],
  ['demo-james-carter', 'James Carter', 118, 19, 4, 9.6],
  ['demo-maya-patel', 'Maya Patel', 96, 16, 4, 8.4],
  ['demo-liam-foster', 'Liam Foster', 73, 12, 3, 6.2],
  ['demo-emma-clarke', 'Emma Clarke', 51, 8, 2, 4.8],
];

export function getFounderDemoLeaderboard(): LeaderboardEntry[] {
  return ROSTER.map(([id, name, doorknocks, conversations, leads, distance], index) => ({
    id,
    user_id: id,
    user_email: '',
    name,
    avatar_url: null,
    country_code: 'CA',
    brokerage: 'Phillippe Group',
    doorknocks,
    conversations,
    leads,
    distance,
    rank: index + 1,
    pending: {
      doorknocks: [12, 8, 15, 10, 6, 11, 7, 9, 5, 8, 4, 3][index],
      conversations: [2, 1, 3, 2, 1, 2, 1, 2, 1, 1, 1, 0][index],
      leads: [1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0][index],
      distance: 0,
    },
    updated_at: new Date(Date.now() - index * 1000 * 60 * 13).toISOString(),
  }));
}
