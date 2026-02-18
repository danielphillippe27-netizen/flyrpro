-- Upgrade get_leaderboard to support timeframe filtering.
-- For 'all_time': reads from user_stats (fast, pre-aggregated).
-- For day/week/month/year: aggregates from sessions table by start_time.

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  sort_by TEXT DEFAULT 'flyers',
  limit_count INTEGER DEFAULT 100,
  offset_count INTEGER DEFAULT 0,
  timeframe TEXT DEFAULT 'all_time'
)
RETURNS TABLE (
  id TEXT,
  user_id TEXT,
  user_email TEXT,
  name TEXT,
  avatar_url TEXT,
  flyers INTEGER,
  conversations INTEGER,
  leads INTEGER,
  distance DOUBLE PRECISION,
  time_minutes DOUBLE PRECISION,
  day_streak INTEGER,
  best_streak INTEGER,
  rank INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- For all_time, use pre-aggregated user_stats
  IF timeframe = 'all_time' OR timeframe IS NULL THEN
    RETURN QUERY
    SELECT
      us.id::TEXT,
      us.user_id::TEXT,
      COALESCE(u.email, '')::TEXT                                       AS user_email,
      COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
      COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT           AS avatar_url,
      COALESCE(us.flyers, 0)::INTEGER                                  AS flyers,
      COALESCE(us.conversations, 0)::INTEGER                           AS conversations,
      COALESCE(us.leads_created, 0)::INTEGER                           AS leads,
      COALESCE(us.distance_walked, 0)::DOUBLE PRECISION                AS distance,
      COALESCE(us.time_tracked, 0)::DOUBLE PRECISION                   AS time_minutes,
      COALESCE(us.day_streak, 0)::INTEGER                              AS day_streak,
      COALESCE(us.best_streak, 0)::INTEGER                             AS best_streak,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
            WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
            WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
            WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
            WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
            WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
            WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
            ELSE                      COALESCE(us.flyers, 0)::NUMERIC
          END DESC
      ))::INTEGER AS rank,
      us.updated_at
    FROM public.user_stats us
    LEFT JOIN auth.users u ON u.id = us.user_id
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
        WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
        WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
        WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
        WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
        WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
        WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
        ELSE                      COALESCE(us.flyers, 0)::NUMERIC
      END DESC
    LIMIT limit_count
    OFFSET offset_count;

    RETURN;
  END IF;

  -- Compute cutoff for time-filtered queries
  v_cutoff := CASE timeframe
    WHEN 'day'   THEN date_trunc('day',   now())
    WHEN 'week'  THEN date_trunc('week',  now())
    WHEN 'month' THEN date_trunc('month', now())
    WHEN 'year'  THEN date_trunc('year',  now())
    ELSE              date_trunc('week',  now())
  END;

  -- Aggregate from sessions table for the chosen timeframe
  RETURN QUERY
  SELECT
    s.user_id::TEXT                                                     AS id,
    s.user_id::TEXT                                                     AS user_id,
    COALESCE(u.email, '')::TEXT                                         AS user_email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
    COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT             AS avatar_url,
    COALESCE(SUM(s.flyers_delivered), 0)::INTEGER                       AS flyers,
    COALESCE(SUM(s.conversations), 0)::INTEGER                          AS conversations,
    0::INTEGER                                                          AS leads,
    COALESCE(SUM(s.distance_meters) / 1000.0, 0)::DOUBLE PRECISION     AS distance,
    COALESCE(SUM(s.active_seconds) / 60.0, 0)::DOUBLE PRECISION        AS time_minutes,
    COALESCE(us.day_streak, 0)::INTEGER                                 AS day_streak,
    COALESCE(us.best_streak, 0)::INTEGER                                AS best_streak,
    (ROW_NUMBER() OVER (
      ORDER BY
        CASE sort_by
          WHEN 'flyers'        THEN COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
          WHEN 'conversations' THEN COALESCE(SUM(s.conversations), 0)::NUMERIC
          WHEN 'distance'      THEN COALESCE(SUM(s.distance_meters) / 1000.0, 0)::NUMERIC
          WHEN 'time'          THEN COALESCE(SUM(s.active_seconds) / 60.0, 0)::NUMERIC
          WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
          WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
          ELSE                      COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
        END DESC
    ))::INTEGER AS rank,
    MAX(s.start_time)                                                   AS updated_at
  FROM public.sessions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN public.user_stats us ON us.user_id = s.user_id
  WHERE s.start_time >= v_cutoff
    AND s.end_time IS NOT NULL
  GROUP BY s.user_id, u.email, u.raw_user_meta_data, us.day_streak, us.best_streak
  ORDER BY
    CASE sort_by
      WHEN 'flyers'        THEN COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
      WHEN 'conversations' THEN COALESCE(SUM(s.conversations), 0)::NUMERIC
      WHEN 'distance'      THEN COALESCE(SUM(s.distance_meters) / 1000.0, 0)::NUMERIC
      WHEN 'time'          THEN COALESCE(SUM(s.active_seconds) / 60.0, 0)::NUMERIC
      WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
      WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
      ELSE                      COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
    END DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

COMMENT ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT)
  IS 'Returns ranked leaderboard from user_stats (all_time) or aggregated sessions (day/week/month/year).';

GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO service_role;
