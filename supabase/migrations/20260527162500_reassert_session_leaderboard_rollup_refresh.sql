BEGIN;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

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

CREATE OR REPLACE FUNCTION public.refresh_user_projections_from_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF to_regprocedure('public.refresh_user_stats_from_sessions(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT public.refresh_user_stats_from_sessions($1)' USING OLD.user_id;
    END IF;
    PERFORM public.refresh_leaderboard_rollups_for_user(OLD.user_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    IF to_regprocedure('public.refresh_user_stats_from_sessions(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT public.refresh_user_stats_from_sessions($1)' USING OLD.user_id;
    END IF;
    PERFORM public.refresh_leaderboard_rollups_for_user(OLD.user_id);
  END IF;

  IF to_regprocedure('public.refresh_user_stats_from_sessions(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.refresh_user_stats_from_sessions($1)' USING NEW.user_id;
  END IF;
  PERFORM public.refresh_leaderboard_rollups_for_user(NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_user_stats_from_session ON public.sessions;
CREATE TRIGGER trigger_update_user_stats_from_session
  AFTER INSERT OR UPDATE OR DELETE ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_user_projections_from_session();

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT s.user_id
    FROM public.sessions s
    WHERE s.user_id IS NOT NULL
      AND s.end_time IS NOT NULL
      AND (
        COALESCE(s.updated_at, s.end_time, s.start_time) >= NOW() - INTERVAL '48 hours'
        OR s.end_time >= NOW() - INTERVAL '48 hours'
      )
  LOOP
    IF to_regprocedure('public.refresh_user_stats_from_sessions(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT public.refresh_user_stats_from_sessions($1)' USING v_user_id;
    END IF;
    PERFORM public.refresh_leaderboard_rollups_for_user(v_user_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_rollups_for_user(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
