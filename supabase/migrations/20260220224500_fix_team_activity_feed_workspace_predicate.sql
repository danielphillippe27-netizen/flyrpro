-- Fix get_team_activity_feed() for databases where session_events exists
-- but does not yet contain workspace_id.
-- Keeps the 7-arg signature used by web and resolves workspace via sessions when needed.

CREATE OR REPLACE FUNCTION public.get_team_activity_feed(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_type_filter text DEFAULT NULL,
  p_limit_count integer DEFAULT 50,
  p_offset_count integer DEFAULT 0,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_workspace_predicate text;
  v_ref_expr text;
  v_rows jsonb;
  v_total bigint := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit_count, 50), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset_count, 0), 0);
  v_has_session_events_workspace_id boolean := false;
  v_has_activity_events_workspace_id boolean := false;
  v_has_session_events_session_id boolean := false;
  v_has_activity_events_ref_id boolean := false;
  v_has_sessions_workspace_id boolean := false;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'workspace_id'
  ) INTO v_has_session_events_workspace_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_events' AND column_name = 'workspace_id'
  ) INTO v_has_activity_events_workspace_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'session_id'
  ) INTO v_has_session_events_session_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_events' AND column_name = 'ref_id'
  ) INTO v_has_activity_events_ref_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'workspace_id'
  ) INTO v_has_sessions_workspace_id;

  IF to_regclass('public.session_events') IS NOT NULL AND v_has_session_events_workspace_id THEN
    v_source := 'session_events';
    v_workspace_predicate := 'e.workspace_id = $1';
    v_ref_expr := 'NULL::uuid';
  ELSIF to_regclass('public.activity_events') IS NOT NULL AND v_has_activity_events_workspace_id THEN
    v_source := 'activity_events';
    v_workspace_predicate := 'e.workspace_id = $1';
    v_ref_expr := CASE WHEN v_has_activity_events_ref_id THEN 'e.ref_id' ELSE 'NULL::uuid' END;
  ELSIF
    to_regclass('public.session_events') IS NOT NULL
    AND v_has_session_events_session_id
    AND to_regclass('public.sessions') IS NOT NULL
    AND v_has_sessions_workspace_id
  THEN
    v_source := 'session_events';
    v_workspace_predicate := 'EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = e.session_id AND s.workspace_id = $1)';
    v_ref_expr := 'NULL::uuid';
  ELSE
    RETURN jsonb_build_object('events', '[]'::jsonb, 'total', 0);
  END IF;

  EXECUTE format(
    'SELECT COUNT(*)
     FROM public.%I e
     WHERE %s
       AND e.event_time >= $2
       AND e.event_time <= $3
       AND ($4 IS NULL OR e.event_type = $4)
       AND ($5 IS NULL OR e.user_id = $5)',
    v_source,
    v_workspace_predicate
  )
  INTO v_total
  USING p_workspace_id, p_start_ts, p_end_ts, p_type_filter, p_user_id;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), ''[]''::jsonb)
     FROM (
       SELECT
         e.id,
         e.user_id,
         e.event_type,
         e.event_time,
         %s AS ref_id,
         e.payload,
         e.created_at,
         COALESCE(
           NULLIF(trim(COALESCE(up.first_name, '''') || '' '' || COALESCE(up.last_name, '''')), ''''),
           ''Member''
         ) AS display_name
       FROM public.%I e
       LEFT JOIN public.user_profiles up ON up.user_id = e.user_id
       WHERE %s
         AND e.event_time >= $2
         AND e.event_time <= $3
         AND ($4 IS NULL OR e.event_type = $4)
         AND ($5 IS NULL OR e.user_id = $5)
       ORDER BY e.event_time DESC
       LIMIT $6
       OFFSET $7
     ) t',
    v_ref_expr,
    v_source,
    v_workspace_predicate
  )
  INTO v_rows
  USING p_workspace_id, p_start_ts, p_end_ts, p_type_filter, p_user_id, v_limit, v_offset;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', COALESCE(v_total, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO service_role;
