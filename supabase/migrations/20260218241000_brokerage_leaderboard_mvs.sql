-- Brokerage leaderboard: materialized views (all-time and monthly), refresh function, and cron-ready refresh.
-- Depends on: brokerages_normalization, workspaces.brokerage_id/brokerage_name, user_stats, sessions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) All-time brokerage ranking (from user_stats via workspace_members + workspaces)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.ranking_brokerages_all_time AS
WITH ws_totals AS (
  SELECT
    w.id AS workspace_id,
    COALESCE(w.brokerage_id::TEXT, 'custom:' || LOWER(TRIM(COALESCE(w.brokerage_name, '')))) AS brokerage_key,
    COALESCE(b.name, TRIM(w.brokerage_name)) AS display_name,
    COALESCE(SUM(us.flyers), 0)::BIGINT AS flyers,
    COALESCE(SUM(us.conversations), 0)::BIGINT AS conversations,
    COALESCE(SUM(us.leads_created), 0)::BIGINT AS leads,
    COALESCE(SUM(us.distance_walked), 0)::DOUBLE PRECISION AS distance,
    COALESCE(SUM(us.time_tracked), 0)::DOUBLE PRECISION AS time_minutes,
    COALESCE(MAX(us.day_streak), 0)::INTEGER AS day_streak,
    COALESCE(MAX(us.best_streak), 0)::INTEGER AS best_streak,
    COUNT(DISTINCT wm.user_id)::INTEGER AS agent_count,
    MAX(us.updated_at) AS updated_at
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  LEFT JOIN public.brokerages b ON b.id = w.brokerage_id
  LEFT JOIN public.user_stats us ON us.user_id = wm.user_id
  WHERE (w.brokerage_id IS NOT NULL OR TRIM(COALESCE(w.brokerage_name, '')) <> '')
  GROUP BY w.id, w.brokerage_id, w.brokerage_name, b.name
),
agg AS (
  SELECT
    brokerage_key,
    display_name,
    SUM(flyers)::INTEGER AS flyers,
    SUM(conversations)::INTEGER AS conversations,
    SUM(leads)::INTEGER AS leads,
    SUM(distance)::DOUBLE PRECISION AS distance,
    SUM(time_minutes)::DOUBLE PRECISION AS time_minutes,
    MAX(day_streak)::INTEGER AS day_streak,
    MAX(best_streak)::INTEGER AS best_streak,
    SUM(agent_count)::INTEGER AS agent_count,
    MAX(updated_at) AS updated_at
  FROM ws_totals
  WHERE brokerage_key IS NOT NULL AND brokerage_key <> 'custom:'
  GROUP BY brokerage_key, display_name
)
SELECT
  brokerage_key,
  display_name,
  flyers,
  conversations,
  leads,
  distance,
  time_minutes,
  day_streak,
  best_streak,
  agent_count,
  (ROW_NUMBER() OVER (ORDER BY flyers DESC NULLS LAST))::INTEGER AS rank,
  updated_at
FROM agg;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_brokerages_all_time_key
  ON public.ranking_brokerages_all_time (brokerage_key);

-- ---------------------------------------------------------------------------
-- 2) Monthly brokerage ranking (from sessions in last 30 days)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.ranking_brokerages_month AS
WITH cutoff AS (SELECT date_trunc('day', now()) - INTERVAL '30 days' AS since),
ws_totals AS (
  SELECT
    w.id AS workspace_id,
    COALESCE(w.brokerage_id::TEXT, 'custom:' || LOWER(TRIM(COALESCE(w.brokerage_name, '')))) AS brokerage_key,
    COALESCE(b.name, TRIM(w.brokerage_name)) AS display_name,
    COALESCE(SUM(s.flyers_delivered), 0)::BIGINT AS flyers,
    COALESCE(SUM(s.conversations), 0)::BIGINT AS conversations,
    COALESCE(SUM(s.distance_meters) / 1000.0, 0)::DOUBLE PRECISION AS distance,
    COALESCE(SUM(s.active_seconds) / 60.0, 0)::DOUBLE PRECISION AS time_minutes,
    COUNT(DISTINCT wm.user_id)::INTEGER AS agent_count,
    MAX(s.start_time) AS updated_at
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  LEFT JOIN public.brokerages b ON b.id = w.brokerage_id
  LEFT JOIN public.sessions s ON s.user_id = wm.user_id
    AND s.start_time >= (SELECT since FROM cutoff)
    AND s.end_time IS NOT NULL
  WHERE (w.brokerage_id IS NOT NULL OR TRIM(COALESCE(w.brokerage_name, '')) <> '')
  GROUP BY w.id, w.brokerage_id, w.brokerage_name, b.name
),
agg AS (
  SELECT
    brokerage_key,
    display_name,
    SUM(flyers)::INTEGER AS flyers,
    SUM(conversations)::INTEGER AS conversations,
    0::INTEGER AS leads,
    SUM(distance)::DOUBLE PRECISION AS distance,
    SUM(time_minutes)::DOUBLE PRECISION AS time_minutes,
    0::INTEGER AS day_streak,
    0::INTEGER AS best_streak,
    SUM(agent_count)::INTEGER AS agent_count,
    MAX(updated_at) AS updated_at
  FROM ws_totals
  WHERE brokerage_key IS NOT NULL AND brokerage_key <> 'custom:'
  GROUP BY brokerage_key, display_name
)
SELECT
  brokerage_key,
  display_name,
  flyers,
  conversations,
  leads,
  distance,
  time_minutes,
  day_streak,
  best_streak,
  agent_count,
  (ROW_NUMBER() OVER (ORDER BY flyers DESC NULLS LAST))::INTEGER AS rank,
  updated_at
FROM agg;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_brokerages_month_key
  ON public.ranking_brokerages_month (brokerage_key);

-- ---------------------------------------------------------------------------
-- 3) Refresh function (for cron or on-demand)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_brokerage_leaderboards()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ranking_brokerages_all_time;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ranking_brokerages_month;
END;
$$;

COMMENT ON FUNCTION public.refresh_brokerage_leaderboards()
  IS 'Refreshes brokerage leaderboard MVs; call from pg_cron every 10-60 min or on-demand.';

GRANT EXECUTE ON FUNCTION public.refresh_brokerage_leaderboards() TO service_role;

-- ---------------------------------------------------------------------------
-- 5) RPC: get_brokerage_leaderboard(sort_by, limit_count, offset_count, timeframe)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_brokerage_leaderboard(
  sort_by TEXT DEFAULT 'flyers',
  limit_count INTEGER DEFAULT 100,
  offset_count INTEGER DEFAULT 0,
  timeframe TEXT DEFAULT 'all_time'
)
RETURNS TABLE (
  brokerage_key TEXT,
  display_name TEXT,
  flyers INTEGER,
  conversations INTEGER,
  leads INTEGER,
  distance DOUBLE PRECISION,
  time_minutes DOUBLE PRECISION,
  day_streak INTEGER,
  best_streak INTEGER,
  agent_count INTEGER,
  rank INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF timeframe = 'month' THEN
    RETURN QUERY
    SELECT
      r.brokerage_key,
      r.display_name,
      r.flyers,
      r.conversations,
      r.leads,
      r.distance,
      r.time_minutes,
      r.day_streak,
      r.best_streak,
      r.agent_count,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN r.flyers::NUMERIC
            WHEN 'conversations' THEN r.conversations::NUMERIC
            WHEN 'leads'         THEN r.leads::NUMERIC
            WHEN 'distance'     THEN r.distance::NUMERIC
            WHEN 'time'         THEN r.time_minutes::NUMERIC
            WHEN 'day_streak'   THEN r.day_streak::NUMERIC
            WHEN 'best_streak'  THEN r.best_streak::NUMERIC
            ELSE                     r.flyers::NUMERIC
          END DESC NULLS LAST
      ))::INTEGER AS rank,
      r.updated_at
    FROM public.ranking_brokerages_month r
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN r.flyers::NUMERIC
        WHEN 'conversations' THEN r.conversations::NUMERIC
        WHEN 'leads'         THEN r.leads::NUMERIC
        WHEN 'distance'     THEN r.distance::NUMERIC
        WHEN 'time'         THEN r.time_minutes::NUMERIC
        WHEN 'day_streak'   THEN r.day_streak::NUMERIC
        WHEN 'best_streak'  THEN r.best_streak::NUMERIC
        ELSE                     r.flyers::NUMERIC
      END DESC NULLS LAST
    LIMIT limit_count
    OFFSET offset_count;
  ELSE
    RETURN QUERY
    SELECT
      r.brokerage_key,
      r.display_name,
      r.flyers,
      r.conversations,
      r.leads,
      r.distance,
      r.time_minutes,
      r.day_streak,
      r.best_streak,
      r.agent_count,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN r.flyers::NUMERIC
            WHEN 'conversations' THEN r.conversations::NUMERIC
            WHEN 'leads'         THEN r.leads::NUMERIC
            WHEN 'distance'     THEN r.distance::NUMERIC
            WHEN 'time'         THEN r.time_minutes::NUMERIC
            WHEN 'day_streak'   THEN r.day_streak::NUMERIC
            WHEN 'best_streak'  THEN r.best_streak::NUMERIC
            ELSE                     r.flyers::NUMERIC
          END DESC NULLS LAST
      ))::INTEGER AS rank,
      r.updated_at
    FROM public.ranking_brokerages_all_time r
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN r.flyers::NUMERIC
        WHEN 'conversations' THEN r.conversations::NUMERIC
        WHEN 'leads'         THEN r.leads::NUMERIC
        WHEN 'distance'     THEN r.distance::NUMERIC
        WHEN 'time'         THEN r.time_minutes::NUMERIC
        WHEN 'day_streak'   THEN r.day_streak::NUMERIC
        WHEN 'best_streak'  THEN r.best_streak::NUMERIC
        ELSE                     r.flyers::NUMERIC
      END DESC NULLS LAST
    LIMIT limit_count
    OFFSET offset_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_brokerage_leaderboard(TEXT, INTEGER, INTEGER, TEXT)
  IS 'Returns ranked brokerage leaderboard from materialized views (all_time or month).';

GRANT EXECUTE ON FUNCTION public.get_brokerage_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_brokerage_leaderboard(TEXT, INTEGER, INTEGER, TEXT) TO service_role;

-- Grant read on MVs for authenticated
GRANT SELECT ON public.ranking_brokerages_all_time TO authenticated;
GRANT SELECT ON public.ranking_brokerages_month TO authenticated;

COMMIT;

-- Initial refresh (outside transaction; CONCURRENTLY cannot run in a transaction)
REFRESH MATERIALIZED VIEW public.ranking_brokerages_all_time;
REFRESH MATERIALIZED VIEW public.ranking_brokerages_month;
