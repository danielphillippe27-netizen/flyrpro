import { getISOWeek } from 'date-fns';
import { createAdminClient } from '@/lib/supabase/server';

type RollingParticipantRow = {
  challenge_id: string;
  user_id: string;
  joined_at: string;
  timezone: string;
  window_end: string;
};

type ChallengeLeaderboardRow = {
  user_id: string;
  display_name: string;
  score: number;
  rank: number;
  latest_session_id?: string | null;
};

type SessionAggregateRow = {
  id: string;
  start_time: string;
  end_time: string | null;
  doors_hit: number | null;
  flyers_delivered: number | null;
  completed_count: number | null;
  conversations: number | null;
  leads_created: number | null;
};

type ContactAppointmentRow = {
  id: string;
  status: string | null;
  appointment_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function weekStartKey(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = map.weekday ?? 'Mon';
  const iso = `${map.year}-${map.month}-${map.day}`;
  const base = new Date(`${iso}T00:00:00.000Z`);
  const weekdayOrder: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  base.setUTCDate(base.getUTCDate() - (weekdayOrder[weekday] ?? 0));
  return base.toISOString().slice(0, 10);
}

function homesForSession(session: Pick<SessionAggregateRow, 'doors_hit' | 'flyers_delivered' | 'completed_count'>) {
  return Number(session.doors_hit ?? session.flyers_delivered ?? session.completed_count ?? 0) || 0;
}

function displayNameFromParts(row: { display_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }) {
  const profileName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return row.display_name?.trim() || profileName || row.email?.trim() || 'Member';
}

export async function resolveRollingChallenge(challengeId?: string | null) {
  const admin = createAdminClient();
  let query = admin
    .from('challenge_templates')
    .select('id, slug, title, duration_days')
    .eq('scope', 'global')
    .eq('type', 'rolling_onboarding')
    .eq('status', 'active');

  if (challengeId) {
    query = query.eq('id', challengeId);
  } else {
    query = query.eq('slug', 'first-30-days');
  }

  const { data, error } = await query.single();
  if (error) throw error;
  return data as { id: string; slug: string; title: string; duration_days: number };
}

export async function getShareCardData(params: {
  userId: string;
  challengeId?: string | null;
  sessionId: string;
}) {
  const admin = createAdminClient();
  const challenge = await resolveRollingChallenge(params.challengeId);

  const { data: participantData, error: participantError } = await admin
    .from('challenge_rolling_participants')
    .select('challenge_id, user_id, joined_at, timezone, window_end')
    .eq('challenge_id', challenge.id)
    .eq('user_id', params.userId)
    .single();
  if (participantError) throw participantError;
  const participant = participantData as RollingParticipantRow;

  const [leaderboardRes, sessionRes, profileRes] = await Promise.all([
    admin.rpc('get_challenge_rolling_leaderboard', {
      p_challenge_slug: challenge.slug,
      p_window: 'challenge_window',
      p_limit: 500,
    }),
    admin
      .from('sessions')
      .select('id, start_time, end_time, doors_hit, flyers_delivered, completed_count')
      .eq('id', params.sessionId)
      .eq('user_id', params.userId)
      .single(),
    admin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', params.userId)
      .maybeSingle(),
  ]);

  if (leaderboardRes.error) throw leaderboardRes.error;
  if (sessionRes.error) throw sessionRes.error;

  const leaderboard = (leaderboardRes.data ?? []) as ChallengeLeaderboardRow[];
  const currentUserRow = leaderboard.find((row) => row.user_id === params.userId) ?? null;
  const session = sessionRes.data as SessionAggregateRow;

  const sessionDay = dayKey(new Date(session.start_time), participant.timezone);
  const { data: sameDaySessionsData, error: sameDaySessionsError } = await admin
    .from('sessions')
    .select('id, start_time, end_time, doors_hit, flyers_delivered, completed_count')
    .eq('user_id', params.userId)
    .gte('start_time', participant.joined_at)
    .lt('start_time', new Date(Math.min(Date.now(), new Date(participant.window_end).getTime())).toISOString())
    .not('end_time', 'is', null)
    .order('start_time', { ascending: false });
  if (sameDaySessionsError) throw sameDaySessionsError;

  const homesToday = (sameDaySessionsData as SessionAggregateRow[]).reduce((sum, row) => {
    return dayKey(new Date(row.start_time), participant.timezone) === sessionDay
      ? sum + homesForSession(row)
      : sum;
  }, 0);

  const joinedAt = new Date(participant.joined_at).getTime();
  const sessionStart = new Date(session.start_time).getTime();
  const dayInChallenge = Math.min(
    challenge.duration_days,
    Math.max(1, Math.floor((sessionStart - joinedAt) / (24 * 60 * 60 * 1000)) + 1),
  );

  const profile = profileRes.data as { first_name?: string | null; last_name?: string | null } | null;

  return {
    challenge,
    participant,
    homesToday,
    rank: currentUserRow?.rank ?? null,
    participantCount: leaderboard.length,
    dayInChallenge,
    displayName: displayNameFromParts({
      display_name: currentUserRow?.display_name ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    }),
  };
}

export async function getAccountabilityCardData(params: {
  userId: string;
  challengeId?: string | null;
  referenceDate?: Date;
}) {
  const admin = createAdminClient();
  const challenge = await resolveRollingChallenge(params.challengeId);
  const referenceDate = params.referenceDate ?? new Date();

  const { data: participantData, error: participantError } = await admin
    .from('challenge_rolling_participants')
    .select('challenge_id, user_id, joined_at, timezone, window_end')
    .eq('challenge_id', challenge.id)
    .eq('user_id', params.userId)
    .single();
  if (participantError) throw participantError;
  const participant = participantData as RollingParticipantRow;

  const weekStart = weekStartKey(referenceDate, participant.timezone);
  const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);

  const [{ data: profileData, error: profileError }, { data: sessionsData, error: sessionsError }, { data: contactsData, error: contactsError }] =
    await Promise.all([
      admin
        .from('user_profiles')
        .select('first_name, last_name')
        .eq('user_id', params.userId)
        .maybeSingle(),
      admin
        .from('sessions')
        .select('id, start_time, end_time, doors_hit, flyers_delivered, completed_count, conversations, leads_created')
        .eq('user_id', params.userId)
        .gte('start_time', weekStartDate.toISOString())
        .lt('start_time', weekEndDate.toISOString())
        .not('end_time', 'is', null),
      admin
        .from('contacts')
        .select('id, status, appointment_at, created_at, updated_at')
        .eq('user_id', params.userId),
    ]);

  if (profileError) throw profileError;
  if (sessionsError) throw sessionsError;
  if (contactsError && !String(contactsError.message).includes('contacts')) throw contactsError;

  const sessions = (sessionsData ?? []) as SessionAggregateRow[];
  const contacts = ((contactsData ?? []) as ContactAppointmentRow[]) ?? [];

  const doorsThisWeek = sessions.reduce((sum, row) => sum + homesForSession(row), 0);
  const conversationsThisWeek = sessions.reduce((sum, row) => sum + (Number(row.conversations ?? 0) || 0), 0);

  const appointmentIds = new Set<string>();
  for (const row of contacts) {
    const appointmentAt = row.appointment_at ? new Date(row.appointment_at).getTime() : NaN;
    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : NaN;
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : NaN;
    const inWindow =
      (!Number.isNaN(appointmentAt) && appointmentAt >= weekStartDate.getTime() && appointmentAt < weekEndDate.getTime()) ||
      ((!Number.isNaN(updatedAt) && updatedAt >= weekStartDate.getTime() && updatedAt < weekEndDate.getTime()) &&
        ['interested', 'hot', 'appointment'].includes((row.status ?? '').trim().toLowerCase())) ||
      ((!Number.isNaN(createdAt) && createdAt >= weekStartDate.getTime() && createdAt < weekEndDate.getTime()) &&
        ['interested', 'hot', 'appointment'].includes((row.status ?? '').trim().toLowerCase()));

    if (inWindow) appointmentIds.add(row.id);
  }

  const profile = profileData as { first_name?: string | null; last_name?: string | null } | null;
  const firstName = profile?.first_name?.trim() || 'flyr';
  const nextWeekGoal = Math.max(10, Math.ceil(doorsThisWeek * 1.2));

  return {
    challenge,
    participant,
    weekStart,
    isoWeek: `${weekStartDate.getUTCFullYear()}-W${String(getISOWeek(weekStartDate)).padStart(2, '0')}`,
    headerLabel: `Week ${getISOWeek(weekStartDate)} · @${firstName.toLowerCase()}`,
    doorsThisWeek,
    conversationsThisWeek,
    appointmentsThisWeek: appointmentIds.size,
    nextWeekGoal,
    hashtags: '#FLYR #doortodoor #realestate #toronto',
    displayName: displayNameFromParts({
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    }),
    timezone: participant.timezone,
  };
}
