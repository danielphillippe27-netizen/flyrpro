import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChallengeTemplateRow = {
  id: string;
  slug: string;
};

type RollingParticipant = {
  challenge_id: string;
  user_id: string;
  joined_at: string;
  timezone: string;
  window_end: string;
};

type SessionRow = {
  user_id: string;
  start_time: string;
  end_time: string | null;
  doors_hit: number | null;
  flyers_delivered: number | null;
  completed_count: number | null;
};

type StreakRow = {
  user_id: string;
  current_streak: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function localParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: Number(parts.hour ?? "0") || 0,
    weekday: parts.weekday ?? "Mon",
    isoDay: `${parts.year ?? "0000"}-${parts.month ?? "01"}-${parts.day ?? "01"}`,
  };
}

function localWeekStart(local: ReturnType<typeof localParts>): string {
  const weekdayOrder: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const base = new Date(`${local.isoDay}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - (weekdayOrder[local.weekday] ?? 0));
  return base.toISOString().slice(0, 10);
}

function homesForSession(session: SessionRow): number {
  return Number(session.doors_hit ?? session.flyers_delivered ?? session.completed_count ?? 0) || 0;
}

async function ensureAccountabilityCard(params: {
  baseUrl: string;
  userId: string;
  challengeId: string;
  referenceDate: Date;
}) {
  const url = new URL("/api/accountability-card", params.baseUrl);
  url.searchParams.set("user_id", params.userId);
  url.searchParams.set("challenge_id", params.challengeId);
  url.searchParams.set("reference_date", params.referenceDate.toISOString());

  const response = await fetch(url.toString(), { method: "POST" });
  if (!response.ok) {
    throw new Error(`accountability-card failed (${response.status})`);
  }
  return response.headers.get("X-Accountability-Card-Url");
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
    const appBaseUrl = Deno.env.get("APP_BASE_URL") ?? "https://wolfgrid.app";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Server misconfigured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: challengeData, error: challengeError } = await supabase
      .from("challenge_templates")
      .select("id, slug")
      .eq("slug", "first-30-days")
      .eq("scope", "global")
      .eq("type", "rolling_onboarding")
      .eq("status", "active")
      .single();
    if (challengeError) throw challengeError;
    const challenge = challengeData as ChallengeTemplateRow;

    const { data: participantsData, error: participantsError } = await supabase
      .from("challenge_rolling_participants")
      .select("challenge_id, user_id, joined_at, timezone, window_end")
      .eq("challenge_id", challenge.id);
    if (participantsError) throw participantsError;
    const participants = (participantsData ?? []) as RollingParticipant[];
    if (!participants.length) {
      return json({
        challenge_id: challenge.id,
        participants: 0,
        weekly_cards_generated: 0,
        streak_risk_notifications: 0,
      });
    }

    const now = new Date();
    const lookbackStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const [sessionsResult, streaksResult] = await Promise.all([
      supabase
        .from("sessions")
        .select("user_id, start_time, end_time, doors_hit, flyers_delivered, completed_count")
        .in("user_id", participants.map((item) => item.user_id))
        .gte("start_time", lookbackStart)
        .not("end_time", "is", null),
      supabase
        .from("challenge_user_current_streaks")
        .select("user_id, current_streak")
        .eq("challenge_id", challenge.id),
    ]);

    if (sessionsResult.error) throw sessionsResult.error;
    if (streaksResult.error) throw streaksResult.error;

    const sessions = (sessionsResult.data ?? []) as SessionRow[];
    const streaks = new Map(
      ((streaksResult.data ?? []) as StreakRow[]).map((row) => [row.user_id, Number(row.current_streak ?? 0) || 0]),
    );

    const activeDaysByUser = new Map<string, Set<string>>();
    for (const session of sessions) {
      if (homesForSession(session) <= 0) continue;
      const participant = participants.find((item) => item.user_id === session.user_id);
      if (!participant) continue;
      const local = localParts(new Date(session.start_time), participant.timezone);
      const days = activeDaysByUser.get(session.user_id) ?? new Set<string>();
      days.add(local.isoDay);
      activeDaysByUser.set(session.user_id, days);
    }

    let weeklyCardsGenerated = 0;
    let streakRiskNotifications = 0;

    for (const participant of participants) {
      const local = localParts(now, participant.timezone);
      const activeDays = activeDaysByUser.get(participant.user_id) ?? new Set<string>();
      const currentStreak = streaks.get(participant.user_id) ?? 0;

      const isSundayAtSix = local.weekday === "Sun" && local.hour === 18;
      if (isSundayAtSix) {
        try {
          const weekStart = localWeekStart(local);
          const { data: existingPost } = await supabase
            .from("accountability_posts")
            .select("id")
            .eq("user_id", participant.user_id)
            .eq("challenge_id", challenge.id)
            .eq("week_start", weekStart)
            .limit(1)
            .maybeSingle();

          const cardUrl = await ensureAccountabilityCard({
            baseUrl: appBaseUrl,
            userId: participant.user_id,
            challengeId: challenge.id,
            referenceDate: now,
          });

          if (!existingPost) {
            await supabase.from("notifications").insert({
              user_id: participant.user_id,
              type: "challenge_weekly_recap_ready",
              title: "Your weekly recap is ready",
              message: "Your week recap is ready — post it 📲",
              data: {
                challenge_id: challenge.id,
                card_url: cardUrl,
                local_day: local.isoDay,
              },
            });
            weeklyCardsGenerated += 1;
          }
        } catch (error) {
          console.error("[challenge-engagement-cron] accountability", participant.user_id, error);
        }
      }

      const hasActiveStreak = currentStreak >= 2;
      const hasWorkedToday = activeDays.has(local.isoDay);
      if (local.hour === 18 && hasActiveStreak && !hasWorkedToday) {
        await supabase.from("notifications").insert({
          user_id: participant.user_id,
          type: "challenge_streak_risk",
          title: "Your streak is at risk",
          message: "Your streak is at risk — knock some doors 🚪",
          data: {
            challenge_id: challenge.id,
            local_day: local.isoDay,
            current_streak: currentStreak,
          },
        });
        streakRiskNotifications += 1;
      }
    }

    return json({
      challenge_id: challenge.id,
      participants: participants.length,
      weekly_cards_generated: weeklyCardsGenerated,
      streak_risk_notifications: streakRiskNotifications,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[challenge-engagement-cron]", message);
    return json({ error: message }, 500);
  }
});
