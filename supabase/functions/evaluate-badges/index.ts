import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChallengeTemplateRow = {
  id: string;
  slug: string;
  duration_days: number;
};

type RollingParticipant = {
  challenge_id: string;
  challenge_slug: string;
  user_id: string;
  joined_at: string;
  timezone: string;
  window_end: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string | null;
  doors_hit: number | null;
  flyers_delivered: number | null;
  completed_count: number | null;
};

type StreakRow = {
  challenge_id: string;
  user_id: string;
  current_streak: number;
};

type BadgeUpsertRow = {
  user_id: string;
  challenge_id: string;
  badge_id: string;
  is_permanent: boolean;
  is_active: boolean;
  earned_at?: string;
};

type SessionShareNotificationParams = {
  userId: string;
  challengeId: string;
  sessionId: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BADGE_IDS = {
  streak: "streak",
  topWeek: "top_week",
  mostActive24h: "most_active_24h",
  milestone10: "milestone_10",
  milestone25: "milestone_25",
  milestone50: "milestone_50",
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function toIsoDateInTimeZone(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(iso));
}

function homesForSession(session: SessionRow): number {
  return Number(session.doors_hit ?? session.flyers_delivered ?? session.completed_count ?? 0) || 0;
}

function compareParticipants(
  scores: Map<string, number>,
  sessions: Map<string, number>,
  participants: RollingParticipant[],
): RollingParticipant | null {
  const ranked = [...participants].sort((left, right) => {
    const leftScore = scores.get(left.user_id) ?? 0;
    const rightScore = scores.get(right.user_id) ?? 0;
    if (leftScore !== rightScore) return rightScore - leftScore;

    const leftSessions = sessions.get(left.user_id) ?? 0;
    const rightSessions = sessions.get(right.user_id) ?? 0;
    if (leftSessions !== rightSessions) return rightSessions - leftSessions;

    const leftJoined = new Date(left.joined_at).getTime();
    const rightJoined = new Date(right.joined_at).getTime();
    if (leftJoined !== rightJoined) return leftJoined - rightJoined;
    return left.user_id.localeCompare(right.user_id);
  });

  const top = ranked[0] ?? null;
  if (!top) return null;

  const topScore = scores.get(top.user_id) ?? 0;
  const topSessions = sessions.get(top.user_id) ?? 0;
  if (topScore <= 0 && topSessions <= 0) {
    return null;
  }

  return top;
}

async function resolveChallenge(
  supabase: ReturnType<typeof createClient>,
  challengeId?: string,
): Promise<ChallengeTemplateRow | null> {
  if (challengeId) {
    const { data, error } = await supabase
      .from("challenge_templates")
      .select("id, slug, duration_days")
      .eq("id", challengeId)
      .single();
    if (error) throw error;
    return data as ChallengeTemplateRow;
  }

  const { data, error } = await supabase
    .from("challenge_templates")
    .select("id, slug, duration_days")
    .eq("slug", "first-30-days")
    .eq("scope", "global")
    .eq("type", "rolling_onboarding")
    .eq("status", "active")
    .single();

  if (error) throw error;
  return data as ChallengeTemplateRow;
}

async function syncUserBadge(
  supabase: ReturnType<typeof createClient>,
  row: BadgeUpsertRow,
) {
  const payload: BadgeUpsertRow = {
    ...row,
    earned_at: row.earned_at ?? new Date().toISOString(),
  };

  const { error } = await supabase
    .from("challenge_badges")
    .upsert(payload, { onConflict: "user_id,challenge_id,badge_id" });
  if (error) throw error;
}

async function setBadgeActiveState(
  supabase: ReturnType<typeof createClient>,
  challengeId: string,
  userId: string,
  badgeId: string,
  isActive: boolean,
  isPermanent = false,
) {
  await syncUserBadge(supabase, {
    user_id: userId,
    challenge_id: challengeId,
    badge_id: badgeId,
    is_active: isActive,
    is_permanent: isPermanent,
  });
}

async function syncExclusiveBadgeOwner(
  supabase: ReturnType<typeof createClient>,
  challengeId: string,
  badgeId: string,
  nextOwnerId: string | null,
) {
  const { data: existingRows, error: existingError } = await supabase
    .from("challenge_badges")
    .select("user_id")
    .eq("challenge_id", challengeId)
    .eq("badge_id", badgeId)
    .eq("is_active", true);
  if (existingError) throw existingError;

  const previousOwnerId = (existingRows?.[0] as { user_id: string } | undefined)?.user_id ?? null;

  if (previousOwnerId) {
    const { error } = await supabase
      .from("challenge_badges")
      .update({ is_active: false })
      .eq("challenge_id", challengeId)
      .eq("badge_id", badgeId)
      .neq("user_id", nextOwnerId ?? "");
    if (error) throw error;
  }

  if (!nextOwnerId) {
    return { previousOwnerId, nextOwnerId };
  }

  await syncUserBadge(supabase, {
    user_id: nextOwnerId,
    challenge_id: challengeId,
    badge_id: badgeId,
    is_active: true,
    is_permanent: false,
  });

  if (previousOwnerId && previousOwnerId !== nextOwnerId) {
    await supabase.from("notifications").insert({
      user_id: previousOwnerId,
      type: "challenge_top_week_lost",
      title: "You got passed",
      message: "You just got passed — get back out there 👊",
      data: { challenge_id: challengeId, badge_id: badgeId },
    });
  }

  if (nextOwnerId && previousOwnerId !== nextOwnerId) {
    await supabase.from("notifications").insert({
      user_id: nextOwnerId,
      type: "challenge_top_week_earned",
      title: "You're #1 this week",
      message: "You're #1 this week 👑 Keep it up",
      data: { challenge_id: challengeId, badge_id: badgeId },
    });
  }

  return { previousOwnerId, nextOwnerId };
}

async function maybeQueueSessionShareReadyNotification(
  supabase: ReturnType<typeof createClient>,
  params: SessionShareNotificationParams,
) {
  guard: {
    if (!params.sessionId) break guard;

    const { data: existingRow, error: existingError } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", params.userId)
      .eq("type", "session_share_ready")
      .contains("data", { session_id: params.sessionId })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingRow?.id) {
      break guard;
    }

    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: params.userId,
      type: "session_share_ready",
      title: "Share your progress",
      message: "Share your progress",
      data: {
        challenge_id: params.challengeId,
        challenge_slug: "first-30-days",
        session_id: params.sessionId,
      },
    });

    if (insertError) {
      throw insertError;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const userId = typeof body.user_id === "string" ? body.user_id : null;
    const requestedChallengeId =
      typeof body.challenge_id === "string" && body.challenge_id.length > 0
        ? body.challenge_id
        : undefined;
    const sessionId =
      typeof body.session_id === "string" && body.session_id.length > 0
        ? body.session_id
        : null;

    if (!userId) {
      return json({ error: "user_id is required" }, 400);
    }

    const challenge = await resolveChallenge(supabase, requestedChallengeId);
    if (!challenge) {
      return json({ error: "Active challenge not found" }, 404);
    }

    const { data: participantsData, error: participantsError } = await supabase
      .from("challenge_rolling_participants")
      .select("challenge_id, challenge_slug, user_id, joined_at, timezone, window_end")
      .eq("challenge_id", challenge.id);
    if (participantsError) throw participantsError;

    const participants = (participantsData ?? []) as RollingParticipant[];
    const targetParticipant = participants.find((item) => item.user_id === userId);
    if (!targetParticipant) {
      return json({
        challenge_id: challenge.id,
        active_badge_ids: [],
        reason: "user_not_in_rolling_cohort",
      });
    }

    const userIds = participants.map((item) => item.user_id);
    const lookbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sessionRowsData, error: sessionRowsError } = await supabase
      .from("sessions")
      .select("id, user_id, start_time, end_time, doors_hit, flyers_delivered, completed_count")
      .in("user_id", userIds)
      .gte("start_time", lookbackStart)
      .not("end_time", "is", null)
      .order("start_time", { ascending: false });
    if (sessionRowsError) throw sessionRowsError;

    const recentSessions = (sessionRowsData ?? []) as SessionRow[];
    const now = Date.now();
    const last24hCutoff = now - 24 * 60 * 60 * 1000;
    const last7dCutoff = now - 7 * 24 * 60 * 60 * 1000;

    const participantsByUser = new Map(participants.map((item) => [item.user_id, item]));
    const last24hSessionCount = new Map<string, number>();
    const last7dHomes = new Map<string, number>();

    for (const session of recentSessions) {
      const participant = participantsByUser.get(session.user_id);
      if (!participant) continue;

      const startMs = new Date(session.start_time).getTime();
      const joinedMs = new Date(participant.joined_at).getTime();
      const windowEndMs = new Date(participant.window_end).getTime();
      if (startMs < joinedMs || startMs >= Math.min(windowEndMs, now)) continue;

      if (startMs >= last7dCutoff) {
        last7dHomes.set(session.user_id, (last7dHomes.get(session.user_id) ?? 0) + homesForSession(session));
      }

      if (startMs >= last24hCutoff) {
        last24hSessionCount.set(session.user_id, (last24hSessionCount.get(session.user_id) ?? 0) + 1);
      }
    }

    const { data: fullWindowSessionsData, error: fullWindowSessionsError } = await supabase
      .from("sessions")
      .select("id, user_id, start_time, end_time, doors_hit, flyers_delivered, completed_count")
      .eq("user_id", userId)
      .gte("start_time", targetParticipant.joined_at)
      .lt("start_time", new Date(Math.min(new Date(targetParticipant.window_end).getTime(), now)).toISOString())
      .not("end_time", "is", null)
      .order("start_time", { ascending: false });
    if (fullWindowSessionsError) throw fullWindowSessionsError;

    const fullWindowSessions = (fullWindowSessionsData ?? []) as SessionRow[];
    const totalHomes = fullWindowSessions.reduce((sum, session) => sum + homesForSession(session), 0);

    const homesByLocalDay = new Map<string, number>();
    for (const session of fullWindowSessions) {
      const dayKey = toIsoDateInTimeZone(session.start_time, targetParticipant.timezone);
      homesByLocalDay.set(dayKey, (homesByLocalDay.get(dayKey) ?? 0) + homesForSession(session));
    }

    const { data: streakRowsData, error: streakRowsError } = await supabase
      .from("challenge_user_current_streaks")
      .select("challenge_id, user_id, current_streak")
      .eq("challenge_id", challenge.id)
      .eq("user_id", userId)
      .limit(1);
    if (streakRowsError) throw streakRowsError;

    const streakRow = ((streakRowsData ?? [])[0] ?? null) as StreakRow | null;
    const currentStreak = Number(streakRow?.current_streak ?? 0) || 0;

    const topWeekOwner = compareParticipants(last7dHomes, last24hSessionCount, participants);
    const mostActiveOwner = compareParticipants(last24hSessionCount, last7dHomes, participants);

    await syncExclusiveBadgeOwner(
      supabase,
      challenge.id,
      BADGE_IDS.topWeek,
      topWeekOwner?.user_id ?? null,
    );
    await syncExclusiveBadgeOwner(
      supabase,
      challenge.id,
      BADGE_IDS.mostActive24h,
      mostActiveOwner?.user_id ?? null,
    );

    await setBadgeActiveState(
      supabase,
      challenge.id,
      userId,
      BADGE_IDS.streak,
      currentStreak >= 3,
      false,
    );

    if ([...homesByLocalDay.values()].some((value) => value >= 10)) {
      await setBadgeActiveState(supabase, challenge.id, userId, BADGE_IDS.milestone10, true, true);
    }
    if (totalHomes >= 25) {
      await setBadgeActiveState(supabase, challenge.id, userId, BADGE_IDS.milestone25, true, true);
    }
    if (totalHomes >= 50) {
      await setBadgeActiveState(supabase, challenge.id, userId, BADGE_IDS.milestone50, true, true);
    }

    await maybeQueueSessionShareReadyNotification(supabase, {
      userId,
      challengeId: challenge.id,
      sessionId,
    });

    const { data: badgeRowsData, error: badgeRowsError } = await supabase
      .from("challenge_badges")
      .select("badge_id")
      .eq("challenge_id", challenge.id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("badge_id");
    if (badgeRowsError) throw badgeRowsError;

    return json({
      challenge_id: challenge.id,
      current_streak: currentStreak,
      active_badge_ids: (badgeRowsData ?? []).map((row) => (row as { badge_id: string }).badge_id),
      top_week_owner_id: topWeekOwner?.user_id ?? null,
      most_active_24h_owner_id: mostActiveOwner?.user_id ?? null,
      total_homes: totalHomes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[evaluate-badges]", message);
    return json({ error: message }, 500);
  }
});
