BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS workspace_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE IF EXISTS public.user_profiles
  ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_sessions_leaderboard_global_completed
  ON public.sessions(start_time DESC, user_id)
  WHERE end_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_leaderboard_workspace_completed
  ON public.sessions(workspace_id, start_time DESC, user_id)
  WHERE end_time IS NOT NULL AND workspace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.leaderboard_period_start(
  p_timeframe TEXT,
  p_reference TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $period$
BEGIN
  CASE p_timeframe
    WHEN 'daily' THEN
      RETURN date_trunc('day', p_reference);
    WHEN 'weekly' THEN
      RETURN date_trunc('week', p_reference);
    WHEN 'monthly' THEN
      RETURN date_trunc('month', p_reference);
    WHEN 'all_time' THEN
      RETURN '1970-01-01 00:00:00+00'::TIMESTAMPTZ;
    ELSE
      RETURN date_trunc('week', p_reference);
  END CASE;
END;
$period$;

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
  all_time JSONB,
  pending JSONB
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
  WITH completed_sessions AS (
    SELECT
      s.user_id,
      s.start_time,
      GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doorknocks,
      GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
      GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads,
      GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_km
    FROM public.sessions s
    WHERE s.user_id IS NOT NULL
      AND s.end_time IS NOT NULL
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
  ),
  expanded_completed AS (
    SELECT
      cs.user_id,
      tf.timeframe,
      public.leaderboard_period_start(tf.timeframe, cs.start_time) AS period_start,
      cs.doorknocks,
      cs.conversations,
      cs.leads,
      cs.distance_km
    FROM completed_sessions cs
    CROSS JOIN (
      VALUES ('daily'), ('weekly'), ('monthly'), ('all_time')
    ) AS tf(timeframe)
  ),
  finalized_stats AS (
    SELECT
      ec.user_id,
      ec.timeframe,
      ec.period_start,
      COALESCE(SUM(ec.doorknocks), 0)::INTEGER AS doorknocks,
      COALESCE(SUM(ec.conversations), 0)::INTEGER AS conversations,
      COALESCE(SUM(ec.leads), 0)::INTEGER AS leads,
      COALESCE(SUM(ec.distance_km), 0.0)::DOUBLE PRECISION AS distance_km
    FROM expanded_completed ec
    GROUP BY ec.user_id, ec.timeframe, ec.period_start
  ),
  current_period AS (
    SELECT fs.user_id, fs.doorknocks, fs.conversations, fs.leads, fs.distance_km
    FROM finalized_stats fs
    WHERE fs.timeframe = p_timeframe
      AND fs.period_start = v_current_period
      AND (fs.doorknocks > 0 OR fs.conversations > 0 OR fs.leads > 0 OR fs.distance_km > 0)
  ),
  daily_stats AS (
    SELECT *
    FROM finalized_stats fs
    WHERE fs.timeframe = 'daily'
      AND fs.period_start = public.leaderboard_period_start('daily', NOW())
  ),
  weekly_stats AS (
    SELECT *
    FROM finalized_stats fs
    WHERE fs.timeframe = 'weekly'
      AND fs.period_start = public.leaderboard_period_start('weekly', NOW())
  ),
  monthly_stats AS (
    SELECT *
    FROM finalized_stats fs
    WHERE fs.timeframe = 'monthly'
      AND fs.period_start = public.leaderboard_period_start('monthly', NOW())
  ),
  all_time_stats AS (
    SELECT *
    FROM finalized_stats fs
    WHERE fs.timeframe = 'all_time'
      AND fs.period_start = public.leaderboard_period_start('all_time', NOW())
  ),
  active_sessions AS (
    SELECT
      s.user_id,
      s.start_time,
      GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doorknocks,
      GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
      GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads,
      GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_km
    FROM public.sessions s
    WHERE s.user_id IS NOT NULL
      AND s.end_time IS NULL
      AND COALESCE(s.updated_at, s.start_time) >= NOW() - INTERVAL '8 hours'
      AND s.start_time >= NOW() - INTERVAL '48 hours'
      AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
  ),
  pending_period AS (
    SELECT
      a.user_id,
      COALESCE(SUM(a.doorknocks), 0)::INTEGER AS doorknocks,
      COALESCE(SUM(a.conversations), 0)::INTEGER AS conversations,
      COALESCE(SUM(a.leads), 0)::INTEGER AS leads,
      COALESCE(SUM(a.distance_km), 0.0)::DOUBLE PRECISION AS distance_km
    FROM active_sessions a
    WHERE public.leaderboard_period_start(p_timeframe, a.start_time) = v_current_period
    GROUP BY a.user_id
    HAVING COALESCE(SUM(a.doorknocks), 0) > 0
        OR COALESCE(SUM(a.conversations), 0) > 0
        OR COALESCE(SUM(a.leads), 0) > 0
        OR COALESCE(SUM(a.distance_km), 0.0) > 0
  ),
  candidate_users AS (
    SELECT cp.user_id FROM current_period cp
    UNION
    SELECT pp.user_id FROM pending_period pp
  ),
  ranked_users AS (
    SELECT
      cu.user_id::TEXT AS leaderboard_user_id,
      (cp.user_id IS NOT NULL) AS has_finalized_activity,
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
      jsonb_build_object('doorknocks', COALESCE(ats.doorknocks, 0), 'conversations', COALESCE(ats.conversations, 0), 'distance', COALESCE(ats.distance_km, 0.0), 'leads', COALESCE(ats.leads, 0)) AS all_time_snapshot,
      jsonb_build_object('doorknocks', COALESCE(pp.doorknocks, 0), 'conversations', COALESCE(pp.conversations, 0), 'distance', COALESCE(pp.distance_km, 0.0), 'leads', COALESCE(pp.leads, 0)) AS pending_snapshot
    FROM candidate_users cu
    INNER JOIN auth.users au ON au.id = cu.user_id
    LEFT JOIN current_period cp ON cp.user_id = cu.user_id
    LEFT JOIN pending_period pp ON pp.user_id = cu.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = cu.user_id
    LEFT JOIN public.profiles p ON p.id = cu.user_id
    LEFT JOIN daily_stats ds ON ds.user_id = cu.user_id
    LEFT JOIN weekly_stats ws ON ws.user_id = cu.user_id
    LEFT JOIN monthly_stats ms ON ms.user_id = cu.user_id
    LEFT JOIN all_time_stats ats ON ats.user_id = cu.user_id
    WHERE COALESCE(up.leaderboard_hidden, FALSE) = FALSE
      AND COALESCE(p.leaderboard_hidden, FALSE) = FALSE
  ),
  finalized_ranks AS (
    SELECT
      ru.leaderboard_user_id,
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
      ))::INTEGER AS user_rank
    FROM ranked_users ru
    WHERE ru.has_finalized_activity
  )
  SELECT
    ru.leaderboard_user_id,
    ru.leaderboard_user_id,
    ru.display_name,
    ru.user_avatar,
    ru.user_country_code,
    ru.user_brokerage,
    COALESCE(fr.user_rank, 0)::INTEGER,
    ru.user_doorknocks,
    ru.user_leads,
    ru.user_conversations,
    ru.user_distance,
    ru.daily_snapshot,
    ru.weekly_snapshot,
    ru.monthly_snapshot,
    ru.all_time_snapshot,
    ru.pending_snapshot
  FROM ranked_users ru
  LEFT JOIN finalized_ranks fr ON fr.leaderboard_user_id = ru.leaderboard_user_id
  ORDER BY
    CASE WHEN fr.user_rank IS NULL THEN 1 ELSE 0 END,
    COALESCE(fr.user_rank, 2147483647),
    CASE p_metric
      WHEN 'doorknocks' THEN (ru.pending_snapshot->>'doorknocks')::DOUBLE PRECISION
      WHEN 'conversations' THEN (ru.pending_snapshot->>'conversations')::DOUBLE PRECISION
      WHEN 'distance' THEN (ru.pending_snapshot->>'distance')::DOUBLE PRECISION
      WHEN 'leads' THEN (ru.pending_snapshot->>'leads')::DOUBLE PRECISION
      ELSE (ru.pending_snapshot->>'doorknocks')::DOUBLE PRECISION
    END DESC,
    ru.leaderboard_user_id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;

COMMENT ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) IS
  'Snappy canonical leaderboard from ended sessions plus pending active-session snapshot.';

NOTIFY pgrst, 'reload schema';

COMMIT;
