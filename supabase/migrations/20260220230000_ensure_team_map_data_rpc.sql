-- Ensure map RPC exists with the 5-arg signature used by web:
-- public.get_team_map_data(p_workspace_id, p_start_ts, p_end_ts, p_mode, p_limit_sessions)
--
-- This is a compatibility heal for environments missing the newer signature.

CREATE OR REPLACE FUNCTION public.get_team_map_data(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_mode text DEFAULT 'routes',
  p_limit_sessions integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members jsonb := '[]'::jsonb;
  v_sessions jsonb := '[]'::jsonb;
  v_knock_points jsonb := '[]'::jsonb;
  v_has_sessions_workspace_id boolean := false;
  v_has_session_events_workspace_id boolean := false;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.display_name), '[]'::jsonb) INTO v_members
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        NULLIF(trim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color
    FROM public.workspace_members wm
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
    ORDER BY 2
  ) t;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'workspace_id'
  ) INTO v_has_sessions_workspace_id;

  IF to_regclass('public.sessions') IS NOT NULL AND v_has_sessions_workspace_id THEN
    SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.started_at DESC), '[]'::jsonb) INTO v_sessions
    FROM (
      SELECT
        ss.id AS session_id,
        ss.user_id,
        ss.start_time AS started_at,
        ss.end_time AS ended_at,
        COALESCE(ss.active_seconds, 0)::int AS duration_seconds,
        COALESCE(ss.distance_meters, 0)::int AS distance_meters,
        COALESCE(ss.doors_hit, 0)::int AS doors_hit,
        COALESCE(ss.conversations, 0)::int AS conversations,
        COALESCE(ss.flyers_delivered, 0)::int AS flyers_delivered,
        ss.path_geojson
      FROM public.sessions ss
      WHERE ss.workspace_id = p_workspace_id
        AND ss.start_time >= p_start_ts
        AND ss.start_time <= p_end_ts
      ORDER BY ss.start_time DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit_sessions, 500), 1), 2000)
    ) s;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'workspace_id'
  ) INTO v_has_session_events_workspace_id;

  IF to_regclass('public.session_events') IS NOT NULL AND v_has_session_events_workspace_id THEN
    SELECT COALESCE(jsonb_agg(row_to_json(k)::jsonb ORDER BY k.event_time DESC), '[]'::jsonb) INTO v_knock_points
    FROM (
      SELECT
        se.id,
        se.user_id,
        se.event_time,
        se.event_type,
        se.payload,
        COALESCE(
          NULLIF(trim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
          'Member'
        ) AS display_name
      FROM public.session_events se
      LEFT JOIN public.user_profiles up ON up.user_id = se.user_id
      WHERE se.workspace_id = p_workspace_id
        AND se.event_time >= p_start_ts
        AND se.event_time <= p_end_ts
        AND se.event_type = 'knock'
        AND jsonb_typeof(se.payload) = 'object'
        AND (se.payload ? 'lat')
        AND (se.payload ? 'lng')
      ORDER BY se.event_time DESC
    ) k;
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE(v_members, '[]'::jsonb),
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'knockPoints', COALESCE(v_knock_points, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
