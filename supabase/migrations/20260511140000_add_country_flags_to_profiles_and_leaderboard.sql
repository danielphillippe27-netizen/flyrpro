BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS country_code TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_code TEXT;

COMMENT ON COLUMN public.user_profiles.country_code IS 'ISO 3166-1 alpha-2 country code selected during onboarding/profile edit.';
COMMENT ON COLUMN public.profiles.country_code IS 'ISO 3166-1 alpha-2 country code selected during onboarding/profile edit.';

DROP FUNCTION IF EXISTS public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_metric TEXT DEFAULT 'doorknocks',
  p_timeframe TEXT DEFAULT 'weekly',
  p_workspace_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  user_id TEXT,
  name TEXT,
  avatar_url TEXT,
  country_code TEXT,
  brokerage TEXT,
  rank INTEGER,
  doorknocks INTEGER,
  leads INTEGER,
  conversations INTEGER,
  distance DOUBLE PRECISION,
  daily JSONB,
  weekly JSONB,
  monthly JSONB,
  all_time JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope_key TEXT;
  v_current_period TIMESTAMPTZ;
BEGIN
  IF p_timeframe NOT IN ('daily', 'weekly', 'monthly', 'all_time') THEN
    p_timeframe := 'weekly';
  END IF;

  IF p_metric NOT IN ('doorknocks', 'conversations', 'distance', 'leads') THEN
    p_metric := 'doorknocks';
  END IF;

  IF p_workspace_id IS NOT NULL THEN
    IF NOT public.is_workspace_member(p_workspace_id) THEN
      RAISE EXCEPTION 'Workspace access denied';
    END IF;
    v_scope_key := 'workspace:' || p_workspace_id::TEXT;
  ELSE
    v_scope_key := 'global';
  END IF;

  v_current_period := public.leaderboard_period_start(p_timeframe, NOW());

  RETURN QUERY
  WITH current_period AS (
    SELECT lr.user_id, lr.doorknocks, lr.conversations, lr.leads, lr.distance_km
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = p_timeframe
      AND lr.period_start = v_current_period
      AND (lr.doorknocks > 0 OR lr.conversations > 0 OR lr.leads > 0 OR lr.distance_km > 0)
  ),
  daily_stats AS (
    SELECT *
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = 'daily'
      AND lr.period_start = public.leaderboard_period_start('daily', NOW())
  ),
  weekly_stats AS (
    SELECT *
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = 'weekly'
      AND lr.period_start = public.leaderboard_period_start('weekly', NOW())
  ),
  monthly_stats AS (
    SELECT *
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = 'monthly'
      AND lr.period_start = public.leaderboard_period_start('monthly', NOW())
  ),
  all_time_stats AS (
    SELECT *
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = 'all_time'
      AND lr.period_start = public.leaderboard_period_start('all_time', NOW())
  ),
  ranked_users AS (
    SELECT
      cp.user_id::TEXT AS leaderboard_user_id,
      COALESCE(
        NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(up.first_name), ''), NULLIF(BTRIM(up.last_name), ''))), ''),
        NULLIF(BTRIM(p.full_name), ''),
        NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
        NULLIF(BTRIM(SPLIT_PART(au.email, '@', 1)), ''),
        'Agent'
      ) AS display_name,
      COALESCE(
        NULLIF(BTRIM(up.avatar_url), ''),
        NULLIF(BTRIM(p.avatar_url), ''),
        NULLIF(BTRIM(au.raw_user_meta_data->>'avatar_url'), '')
      )::TEXT AS user_avatar,
      COALESCE(
        NULLIF(BTRIM(UPPER(up.country_code)), ''),
        NULLIF(BTRIM(UPPER(p.country_code)), ''),
        NULLIF(BTRIM(UPPER(au.raw_user_meta_data->>'country_code')), '')
      )::TEXT AS user_country_code,
      NULLIF(BTRIM(COALESCE(au.raw_user_meta_data->>'brokerage', '')), '') AS user_brokerage,
      COALESCE(cp.doorknocks, 0) AS user_doorknocks,
      COALESCE(cp.conversations, 0) AS user_conversations,
      COALESCE(cp.leads, 0) AS user_leads,
      COALESCE(cp.distance_km, 0.0) AS user_distance,
      jsonb_build_object('doorknocks', COALESCE(ds.doorknocks, 0), 'conversations', COALESCE(ds.conversations, 0), 'distance', COALESCE(ds.distance_km, 0.0), 'leads', COALESCE(ds.leads, 0)) AS daily_snapshot,
      jsonb_build_object('doorknocks', COALESCE(ws.doorknocks, 0), 'conversations', COALESCE(ws.conversations, 0), 'distance', COALESCE(ws.distance_km, 0.0), 'leads', COALESCE(ws.leads, 0)) AS weekly_snapshot,
      jsonb_build_object('doorknocks', COALESCE(ms.doorknocks, 0), 'conversations', COALESCE(ms.conversations, 0), 'distance', COALESCE(ms.distance_km, 0.0), 'leads', COALESCE(ms.leads, 0)) AS monthly_snapshot,
      jsonb_build_object('doorknocks', COALESCE(ats.doorknocks, 0), 'conversations', COALESCE(ats.conversations, 0), 'distance', COALESCE(ats.distance_km, 0.0), 'leads', COALESCE(ats.leads, 0)) AS all_time_snapshot
    FROM current_period cp
    INNER JOIN auth.users au ON au.id = cp.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = cp.user_id
    LEFT JOIN public.profiles p ON p.id = cp.user_id
    LEFT JOIN daily_stats ds ON ds.user_id = cp.user_id
    LEFT JOIN weekly_stats ws ON ws.user_id = cp.user_id
    LEFT JOIN monthly_stats ms ON ms.user_id = cp.user_id
    LEFT JOIN all_time_stats ats ON ats.user_id = cp.user_id
  )
  SELECT
    ru.leaderboard_user_id,
    ru.leaderboard_user_id,
    ru.display_name,
    ru.user_avatar,
    ru.user_country_code,
    ru.user_brokerage,
    (ROW_NUMBER() OVER (
      ORDER BY
        CASE p_metric
          WHEN 'doorknocks' THEN ru.user_doorknocks::DOUBLE PRECISION
          WHEN 'conversations' THEN ru.user_conversations::DOUBLE PRECISION
          WHEN 'distance' THEN ru.user_distance
          WHEN 'leads' THEN ru.user_leads::DOUBLE PRECISION
          ELSE ru.user_doorknocks::DOUBLE PRECISION
        END DESC,
        ru.user_doorknocks DESC,
        ru.user_conversations DESC,
        ru.user_distance DESC,
        ru.leaderboard_user_id ASC
    ))::INTEGER AS user_rank,
    ru.user_doorknocks,
    ru.user_leads,
    ru.user_conversations,
    ru.user_distance,
    ru.daily_snapshot,
    ru.weekly_snapshot,
    ru.monthly_snapshot,
    ru.all_time_snapshot
  FROM ranked_users ru
  ORDER BY user_rank
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
