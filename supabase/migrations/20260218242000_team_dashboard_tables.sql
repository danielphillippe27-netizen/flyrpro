-- Team dashboard: workspace_members.color, field_sessions, activity_events, RLS, and RPCs.
-- Gate: owner OR admin see team dashboard; members see own data only.
-- Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) workspace_members: add color for stable per-member map display
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN public.workspace_members.color IS 'Hex color (e.g. #3B82F6) for team map route/marker display; stable per member.';

-- ---------------------------------------------------------------------------
-- 2) field_sessions: Strava-like sessions with optional route geometry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_seconds integer GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL THEN EXTRACT(epoch FROM (ended_at - started_at))::integer ELSE NULL END
  ) STORED,
  route geometry(LineString, 4326),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_sessions_workspace_id ON public.field_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_field_sessions_user_id ON public.field_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_field_sessions_started_at ON public.field_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_sessions_workspace_started ON public.field_sessions(workspace_id, started_at DESC);

COMMENT ON TABLE public.field_sessions IS 'Session records for team map and reporting; route and stats (doors_knocked, conversations, etc.).';

-- ---------------------------------------------------------------------------
-- 3) activity_events: feed events for Activity tab
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('session_completed', 'knock', 'followup', 'appointment')),
  event_time timestamptz NOT NULL,
  ref_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_workspace_id ON public.activity_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_user_id ON public.activity_events(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_event_time ON public.activity_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_workspace_time ON public.activity_events(workspace_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_event_type ON public.activity_events(workspace_id, event_type);

COMMENT ON TABLE public.activity_events IS 'Team activity feed: session_completed, knock, followup, appointment.';

-- ---------------------------------------------------------------------------
-- 4) RLS helper: is workspace owner or admin (for team dashboard access)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_owner_or_admin(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  )
$$;

-- ---------------------------------------------------------------------------
-- 5) RLS: field_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE public.field_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_sessions_owner_admin_read_all" ON public.field_sessions;
CREATE POLICY "field_sessions_owner_admin_read_all"
  ON public.field_sessions FOR SELECT
  USING (public.is_workspace_owner_or_admin(workspace_id));

DROP POLICY IF EXISTS "field_sessions_member_read_own" ON public.field_sessions;
CREATE POLICY "field_sessions_member_read_own"
  ON public.field_sessions FOR SELECT
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "field_sessions_member_insert_own" ON public.field_sessions;
CREATE POLICY "field_sessions_member_insert_own"
  ON public.field_sessions FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 6) RLS: activity_events
-- ---------------------------------------------------------------------------
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_events_owner_admin_read_all" ON public.activity_events;
CREATE POLICY "activity_events_owner_admin_read_all"
  ON public.activity_events FOR SELECT
  USING (public.is_workspace_owner_or_admin(workspace_id));

DROP POLICY IF EXISTS "activity_events_member_read_own" ON public.activity_events;
CREATE POLICY "activity_events_member_read_own"
  ON public.activity_events FOR SELECT
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "activity_events_member_insert_own" ON public.activity_events;
CREATE POLICY "activity_events_member_insert_own"
  ON public.activity_events FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND user_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 7) RPC: get_team_map_data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_map_data(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_limit_sessions integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members jsonb;
  v_sessions jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND NOT (
    p_workspace_id = ANY(public.current_user_workspace_ids())
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- Members with display name and color (owner/admin see all; member sees self only)
  SELECT COALESCE(jsonb_agg(m), '[]'::jsonb) INTO v_members
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
      AND (
        public.is_workspace_owner_or_admin(p_workspace_id)
        OR wm.user_id = auth.uid()
      )
  ) m;

  -- Sessions in range with route as GeoJSON and stats
  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_sessions
  FROM (
    SELECT
      fs.id AS session_id,
      fs.user_id,
      fs.started_at,
      fs.ended_at,
      fs.duration_seconds,
      fs.stats,
      CASE WHEN fs.route IS NOT NULL THEN ST_AsGeoJSON(fs.route)::jsonb ELSE NULL END AS route_geojson
    FROM public.field_sessions fs
    WHERE fs.workspace_id = p_workspace_id
      AND fs.started_at >= p_start_ts
      AND fs.started_at <= p_end_ts
      AND (public.is_workspace_owner_or_admin(p_workspace_id) OR fs.user_id = auth.uid())
    ORDER BY fs.started_at DESC
    LIMIT p_limit_sessions
  ) s;

  v_result := jsonb_build_object(
    'members', COALESCE(v_members, '[]'::jsonb),
    'sessions', COALESCE(v_sessions, '[]'::jsonb)
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, integer)
  IS 'Returns members (with color) and sessions (with route + stats) for team map; owner/admin see all, member sees own.';

-- ---------------------------------------------------------------------------
-- 8) RPC: get_team_activity_feed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_activity_feed(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_type_filter text DEFAULT NULL,
  p_limit_count integer DEFAULT 50,
  p_offset_count integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND NOT (
    p_workspace_id = ANY(public.current_user_workspace_ids())
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.activity_events ae
  WHERE ae.workspace_id = p_workspace_id
    AND ae.event_time >= p_start_ts
    AND ae.event_time <= p_end_ts
    AND (p_type_filter IS NULL OR ae.event_type = p_type_filter)
    AND (public.is_workspace_owner_or_admin(p_workspace_id) OR ae.user_id = auth.uid());

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      ae.id,
      ae.user_id,
      ae.event_type,
      ae.event_time,
      ae.ref_id,
      ae.payload,
      ae.created_at,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name
    FROM public.activity_events ae
    LEFT JOIN auth.users u ON u.id = ae.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = ae.user_id
    WHERE ae.workspace_id = p_workspace_id
      AND ae.event_time >= p_start_ts
      AND ae.event_time <= p_end_ts
      AND (p_type_filter IS NULL OR ae.event_type = p_type_filter)
      AND (public.is_workspace_owner_or_admin(p_workspace_id) OR ae.user_id = auth.uid())
    ORDER BY ae.event_time DESC
    LIMIT p_limit_count
    OFFSET p_offset_count
  ) t;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer)
  IS 'Paginated activity feed for team; owner/admin see all, member sees own.';

-- ---------------------------------------------------------------------------
-- 9) RPC: get_team_leaderboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_leaderboard(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color,
      COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0)::int AS doors_knocked,
      COALESCE(SUM((fs.stats->>'conversations')::int), 0)::int AS conversations,
      COALESCE(SUM((fs.stats->>'followups')::int), 0)::int AS followups,
      COALESCE(SUM((fs.stats->>'appointments')::int), 0)::int AS appointments,
      COUNT(fs.id)::int AS sessions_count
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    LEFT JOIN public.field_sessions fs ON fs.workspace_id = wm.workspace_id AND fs.user_id = wm.user_id
      AND fs.started_at >= p_start_ts AND fs.started_at <= p_end_ts
    WHERE wm.workspace_id = p_workspace_id
    GROUP BY wm.user_id, wm.color, up.first_name, up.last_name, u.raw_user_meta_data, u.email
    ORDER BY COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0) DESC,
             COALESCE(SUM((fs.stats->>'conversations')::int), 0) DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_team_leaderboard(uuid, timestamptz, timestamptz)
  IS 'Leaderboard for workspace in date range; doors_knocked then conversations. Owner/admin only.';

-- ---------------------------------------------------------------------------
-- 10) RPC: get_agent_report
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_agent_report(
  p_workspace_id uuid,
  p_user_id uuid,
  p_period text  -- 'weekly' | 'monthly' | 'yearly'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz := now();
  v_knocks int := 0;
  v_convos int := 0;
  v_followups int := 0;
  v_appointments int := 0;
  v_sessions_count int := 0;
  v_active_days int := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_workspace_id != ANY(public.current_user_workspace_ids()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_start := CASE p_period
    WHEN 'weekly'  THEN date_trunc('week', v_end)
    WHEN 'monthly' THEN date_trunc('month', v_end)
    WHEN 'yearly'  THEN date_trunc('year', v_end)
    ELSE date_trunc('week', v_end)
  END;

  SELECT
    COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0),
    COALESCE(SUM((fs.stats->>'conversations')::int), 0),
    COALESCE(SUM((fs.stats->>'followups')::int), 0),
    COALESCE(SUM((fs.stats->>'appointments')::int), 0),
    COUNT(fs.id),
    COUNT(DISTINCT date_trunc('day', fs.started_at)::date)
  INTO v_knocks, v_convos, v_followups, v_appointments, v_sessions_count, v_active_days
  FROM public.field_sessions fs
  WHERE fs.workspace_id = p_workspace_id
    AND fs.user_id = p_user_id
    AND fs.started_at >= v_start
    AND fs.started_at <= v_end;

  v_result := jsonb_build_object(
    'knocks', v_knocks,
    'conversations', v_convos,
    'followups', v_followups,
    'appointments', v_appointments,
    'sessions_count', v_sessions_count,
    'avg_knocks_per_session', CASE WHEN v_sessions_count > 0 THEN round(v_knocks::numeric / v_sessions_count, 1) ELSE 0 END,
    'active_days', v_active_days,
    'period_start', v_start,
    'period_end', v_end
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_agent_report(uuid, uuid, text)
  IS 'Per-agent report for period (weekly/monthly/yearly). Owner/admin can run for any member; member for self.';

-- Grant execute to authenticated (RLS and function checks enforce workspace access)
GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_report(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_agent_report(uuid, uuid, text) TO service_role;

COMMIT;
