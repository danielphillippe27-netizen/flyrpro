-- Update `get_leaderboard` RPC to support timeframe filtering
-- Adds a timeframe parameter to filter stats by day, week, month, year, or all_time

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
  timeframe_start TIMESTAMPTZ;
BEGIN
  -- Calculate the start time based on timeframe
  CASE timeframe
    WHEN 'day' THEN
      timeframe_start := date_trunc('day', NOW());
    WHEN 'week' THEN
      timeframe_start := date_trunc('week', NOW());
    WHEN 'month' THEN
      timeframe_start := date_trunc('month', NOW());
    WHEN 'year' THEN
      timeframe_start := date_trunc('year', NOW());
    ELSE
      -- 'all_time' or any other value means no filtering
      timeframe_start := NULL;
  END CASE;

  RETURN QUERY
  SELECT
    us.id::TEXT,
    us.user_id::TEXT,
    COALESCE(u.email, '')::TEXT                                     AS user_email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
    COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT         AS avatar_url,
    COALESCE(us.flyers, 0)::INTEGER                                AS flyers,
    COALESCE(us.conversations, 0)::INTEGER                         AS conversations,
    COALESCE(us.leads_created, 0)::INTEGER                         AS leads,
    COALESCE(us.distance_walked, 0)::DOUBLE PRECISION              AS distance,
    COALESCE(us.time_tracked, 0)::DOUBLE PRECISION                 AS time_minutes,
    COALESCE(us.day_streak, 0)::INTEGER                            AS day_streak,
    COALESCE(us.best_streak, 0)::INTEGER                           AS best_streak,
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
  WHERE 
    -- Apply timeframe filter if specified
    (timeframe_start IS NULL OR us.updated_at >= timeframe_start)
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
END;
$$;

COMMENT ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT)
  IS 'Returns ranked leaderboard rows from user_stats, sorted by the given metric and filtered by timeframe (day, week, month, year, all_time).';

-- Allow authenticated users and service role to call the function
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO service_role;
