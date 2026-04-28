BEGIN;

CREATE TABLE IF NOT EXISTS public.leaderboard_rollups (
  scope_key TEXT NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('daily', 'weekly', 'monthly', 'all_time')),
  period_start TIMESTAMPTZ NOT NULL,
  doorknocks INTEGER NOT NULL DEFAULT 0,
  conversations INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  distance_km DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_key, user_id, timeframe, period_start)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rollups_scope_period
  ON public.leaderboard_rollups(scope_key, timeframe, period_start);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rollups_workspace_period
  ON public.leaderboard_rollups(workspace_id, timeframe, period_start)
  WHERE workspace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.leaderboard_period_start(
  p_timeframe TEXT,
  p_reference TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.refresh_user_stats_from_sessions(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doors_knocked INTEGER := 0;
  v_flyers INTEGER := 0;
  v_conversations INTEGER := 0;
  v_leads_created INTEGER := 0;
  v_appointments INTEGER := 0;
  v_distance_walked DOUBLE PRECISION := 0.0;
  v_time_tracked INTEGER := 0;
  v_day_streak INTEGER := 0;
  v_best_streak INTEGER := 0;
  v_streak_days TEXT[] := ARRAY[]::TEXT[];
BEGIN
  WITH session_metrics AS (
    SELECT
      s.id,
      (s.start_time AT TIME ZONE 'UTC')::DATE AS session_day,
      GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doors_knocked,
      GREATEST(COALESCE(s.flyers_delivered, s.completed_count, 0), 0)::INTEGER AS flyers,
      GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
      GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads_created,
      GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_walked,
      GREATEST(
        COALESCE(
          FLOOR(COALESCE(s.active_seconds, EXTRACT(EPOCH FROM (s.end_time - s.start_time))) / 60.0)::INTEGER,
          0
        ),
        0
      ) AS time_tracked,
      COALESCE(appts.appointments_count, 0)::INTEGER AS appointments
    FROM public.sessions s
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::INTEGER AS appointments_count
      FROM public.crm_events ce
      WHERE ce.user_id = s.user_id
        AND ce.fub_appointment_id IS NOT NULL
        AND ce.created_at >= s.start_time
        AND ce.created_at < s.end_time
    ) appts ON TRUE
    WHERE s.user_id = p_user_id
      AND s.end_time IS NOT NULL
  ),
  totals AS (
    SELECT
      COALESCE(SUM(sm.doors_knocked), 0)::INTEGER AS doors_knocked,
      COALESCE(SUM(sm.flyers), 0)::INTEGER AS flyers,
      COALESCE(SUM(sm.conversations), 0)::INTEGER AS conversations,
      COALESCE(SUM(sm.leads_created), 0)::INTEGER AS leads_created,
      COALESCE(SUM(sm.appointments), 0)::INTEGER AS appointments,
      COALESCE(SUM(sm.distance_walked), 0.0)::DOUBLE PRECISION AS distance_walked,
      COALESCE(SUM(sm.time_tracked), 0)::INTEGER AS time_tracked
    FROM session_metrics sm
  ),
  distinct_days AS (
    SELECT DISTINCT sm.session_day
    FROM session_metrics sm
  ),
  streak_base AS (
    SELECT
      dd.session_day,
      LAG(dd.session_day) OVER (ORDER BY dd.session_day) AS previous_session_day
    FROM distinct_days dd
  ),
  streak_markers AS (
    SELECT
      sb.session_day,
      CASE
        WHEN sb.previous_session_day IS NULL THEN 1
        WHEN sb.session_day = (sb.previous_session_day + INTERVAL '1 day')::DATE THEN 0
        ELSE 1
      END AS starts_new_group
    FROM streak_base sb
  ),
  streak_groups AS (
    SELECT
      MIN(sgm.session_day) AS streak_start,
      MAX(sgm.session_day) AS streak_end,
      COUNT(*)::INTEGER AS streak_length
    FROM (
      SELECT
        sm.session_day,
        SUM(sm.starts_new_group) OVER (ORDER BY sm.session_day) AS streak_group
      FROM streak_markers sm
    ) sgm
    GROUP BY sgm.streak_group
  ),
  streak_summary AS (
    SELECT
      COALESCE(MAX(sg.streak_length), 0)::INTEGER AS best_streak,
      COALESCE(
        MAX(
          CASE
            WHEN sg.streak_end >= CURRENT_DATE - INTERVAL '1 day' THEN sg.streak_length
            ELSE 0
          END
        ),
        0
      )::INTEGER AS day_streak
    FROM streak_groups sg
  ),
  streak_days AS (
    SELECT COALESCE(
      array_agg(to_char(dd.session_day, 'YYYY-MM-DD') ORDER BY dd.session_day DESC),
      ARRAY[]::TEXT[]
    ) AS days
    FROM distinct_days dd
  )
  SELECT
    t.doors_knocked,
    t.flyers,
    t.conversations,
    t.leads_created,
    t.appointments,
    t.distance_walked,
    t.time_tracked,
    ss.day_streak,
    ss.best_streak,
    sd.days
  INTO
    v_doors_knocked,
    v_flyers,
    v_conversations,
    v_leads_created,
    v_appointments,
    v_distance_walked,
    v_time_tracked,
    v_day_streak,
    v_best_streak,
    v_streak_days
  FROM totals t
  CROSS JOIN streak_summary ss
  CROSS JOIN streak_days sd;

  INSERT INTO public.user_stats (
    user_id,
    day_streak,
    best_streak,
    streak_days,
    doors_knocked,
    flyers,
    conversations,
    leads_created,
    appointments,
    distance_walked,
    time_tracked,
    conversation_per_door,
    conversation_lead_rate,
    qr_code_scan_rate,
    qr_code_lead_rate
  )
  VALUES (
    p_user_id,
    v_day_streak,
    v_best_streak,
    NULLIF(v_streak_days, ARRAY[]::TEXT[]),
    v_doors_knocked,
    v_flyers,
    v_conversations,
    v_leads_created,
    v_appointments,
    v_distance_walked,
    v_time_tracked,
    CASE
      WHEN v_doors_knocked > 0 THEN v_conversations::DOUBLE PRECISION / v_doors_knocked::DOUBLE PRECISION
      ELSE 0.0
    END,
    CASE
      WHEN v_conversations > 0 THEN v_leads_created::DOUBLE PRECISION / v_conversations::DOUBLE PRECISION
      ELSE 0.0
    END,
    0.0,
    0.0
  )
  ON CONFLICT (user_id) DO UPDATE SET
    day_streak = EXCLUDED.day_streak,
    best_streak = EXCLUDED.best_streak,
    streak_days = EXCLUDED.streak_days,
    doors_knocked = EXCLUDED.doors_knocked,
    flyers = EXCLUDED.flyers,
    conversations = EXCLUDED.conversations,
    leads_created = EXCLUDED.leads_created,
    appointments = EXCLUDED.appointments,
    distance_walked = EXCLUDED.distance_walked,
    time_tracked = EXCLUDED.time_tracked,
    conversation_per_door = EXCLUDED.conversation_per_door,
    conversation_lead_rate = EXCLUDED.conversation_lead_rate,
    qr_code_scan_rate = CASE
      WHEN EXCLUDED.flyers > 0 THEN public.user_stats.qr_codes_scanned::DOUBLE PRECISION / EXCLUDED.flyers::DOUBLE PRECISION
      ELSE 0.0
    END,
    qr_code_lead_rate = CASE
      WHEN public.user_stats.qr_codes_scanned > 0 THEN EXCLUDED.leads_created::DOUBLE PRECISION / public.user_stats.qr_codes_scanned::DOUBLE PRECISION
      ELSE 0.0
    END,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_rollups_for_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.leaderboard_rollups
  WHERE user_id = p_user_id;

  WITH completed_sessions AS (
    SELECT
      s.user_id,
      s.workspace_id,
      s.start_time,
      GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doorknocks,
      GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
      GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads,
      GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_km
    FROM public.sessions s
    WHERE s.user_id = p_user_id
      AND s.end_time IS NOT NULL
  ),
  scoped_sessions AS (
    SELECT
      'global'::TEXT AS scope_key,
      NULL::UUID AS workspace_id,
      cs.user_id,
      cs.start_time,
      cs.doorknocks,
      cs.conversations,
      cs.leads,
      cs.distance_km
    FROM completed_sessions cs
    UNION ALL
    SELECT
      'workspace:' || cs.workspace_id::TEXT AS scope_key,
      cs.workspace_id,
      cs.user_id,
      cs.start_time,
      cs.doorknocks,
      cs.conversations,
      cs.leads,
      cs.distance_km
    FROM completed_sessions cs
    WHERE cs.workspace_id IS NOT NULL
  ),
  expanded AS (
    SELECT
      ss.scope_key,
      ss.workspace_id,
      ss.user_id,
      tf.timeframe,
      public.leaderboard_period_start(tf.timeframe, ss.start_time) AS period_start,
      ss.doorknocks,
      ss.conversations,
      ss.leads,
      ss.distance_km
    FROM scoped_sessions ss
    CROSS JOIN (
      VALUES ('daily'), ('weekly'), ('monthly'), ('all_time')
    ) AS tf(timeframe)
  )
  INSERT INTO public.leaderboard_rollups (
    scope_key,
    workspace_id,
    user_id,
    timeframe,
    period_start,
    doorknocks,
    conversations,
    leads,
    distance_km
  )
  SELECT
    e.scope_key,
    e.workspace_id,
    e.user_id,
    e.timeframe,
    e.period_start,
    COALESCE(SUM(e.doorknocks), 0)::INTEGER,
    COALESCE(SUM(e.conversations), 0)::INTEGER,
    COALESCE(SUM(e.leads), 0)::INTEGER,
    COALESCE(SUM(e.distance_km), 0.0)::DOUBLE PRECISION
  FROM expanded e
  GROUP BY
    e.scope_key,
    e.workspace_id,
    e.user_id,
    e.timeframe,
    e.period_start;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_user_stats_from_session ON public.sessions;
DROP FUNCTION IF EXISTS public.update_user_stats_from_session();

CREATE OR REPLACE FUNCTION public.refresh_user_projections_from_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_user_stats_from_sessions(OLD.user_id);
    PERFORM public.refresh_leaderboard_rollups_for_user(OLD.user_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.refresh_user_stats_from_sessions(OLD.user_id);
    PERFORM public.refresh_leaderboard_rollups_for_user(OLD.user_id);
  END IF;

  PERFORM public.refresh_user_stats_from_sessions(NEW.user_id);
  PERFORM public.refresh_leaderboard_rollups_for_user(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_user_stats_from_session
  AFTER INSERT OR UPDATE OR DELETE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_user_projections_from_session();

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
    SELECT
      lr.user_id,
      lr.doorknocks,
      lr.conversations,
      lr.leads,
      lr.distance_km
    FROM public.leaderboard_rollups lr
    WHERE lr.scope_key = v_scope_key
      AND lr.timeframe = p_timeframe
      AND lr.period_start = v_current_period
      AND (
        lr.doorknocks > 0
        OR lr.conversations > 0
        OR lr.leads > 0
        OR lr.distance_km > 0
      )
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
        NULLIF(BTRIM(CONCAT_WS(
          ' ',
          NULLIF(BTRIM(up.first_name), ''),
          NULLIF(BTRIM(up.last_name), '')
        )), ''),
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
      NULLIF(BTRIM(COALESCE(au.raw_user_meta_data->>'brokerage', '')), '') AS user_brokerage,
      COALESCE(cp.doorknocks, 0) AS user_doorknocks,
      COALESCE(cp.conversations, 0) AS user_conversations,
      COALESCE(cp.leads, 0) AS user_leads,
      COALESCE(cp.distance_km, 0.0) AS user_distance,
      jsonb_build_object(
        'doorknocks', COALESCE(ds.doorknocks, 0),
        'conversations', COALESCE(ds.conversations, 0),
        'distance', COALESCE(ds.distance_km, 0.0),
        'leads', COALESCE(ds.leads, 0)
      ) AS daily_snapshot,
      jsonb_build_object(
        'doorknocks', COALESCE(ws.doorknocks, 0),
        'conversations', COALESCE(ws.conversations, 0),
        'distance', COALESCE(ws.distance_km, 0.0),
        'leads', COALESCE(ws.leads, 0)
      ) AS weekly_snapshot,
      jsonb_build_object(
        'doorknocks', COALESCE(ms.doorknocks, 0),
        'conversations', COALESCE(ms.conversations, 0),
        'distance', COALESCE(ms.distance_km, 0.0),
        'leads', COALESCE(ms.leads, 0)
      ) AS monthly_snapshot,
      jsonb_build_object(
        'doorknocks', COALESCE(ats.doorknocks, 0),
        'conversations', COALESCE(ats.conversations, 0),
        'distance', COALESCE(ats.distance_km, 0.0),
        'leads', COALESCE(ats.leads, 0)
      ) AS all_time_snapshot
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
    ru.user_brokerage,
    (
      ROW_NUMBER() OVER (
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
      )
    )::INTEGER AS user_rank,
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

GRANT EXECUTE ON FUNCTION public.refresh_user_stats_from_sessions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_rollups_for_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER) TO service_role;

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT s.user_id
    FROM public.sessions s
    WHERE s.user_id IS NOT NULL
  LOOP
    PERFORM public.refresh_user_stats_from_sessions(v_user_id);
    PERFORM public.refresh_leaderboard_rollups_for_user(v_user_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.get_leaderboard(TEXT, TEXT, UUID, INTEGER, INTEGER)
  IS 'Canonical leaderboard projection from ended sessions with daily/weekly/monthly/all_time snapshots.';

NOTIFY pgrst, 'reload schema';

COMMIT;
