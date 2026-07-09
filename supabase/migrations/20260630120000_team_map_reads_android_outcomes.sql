-- Make the team "knocked homes" map see Android/iOS campaign outcome events.
--
-- Older mobile outcome writes land in session_events as conversation/flyer_left
-- with created_at + lat/lon. The team map RPC expects knock events with
-- event_time + payload.lat/lng. This compatibility read keeps both shapes
-- visible without requiring an immediate data backfill.

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
  v_has_session_events boolean := false;
  v_has_session_events_workspace_id boolean := false;
  v_has_session_events_session_id boolean := false;
  v_has_session_events_event_time boolean := false;
  v_has_session_events_payload boolean := false;
  v_has_session_events_lat boolean := false;
  v_has_session_events_lon boolean := false;
  v_has_session_events_timestamp boolean := false;
  v_has_session_events_created_at boolean := false;
  v_join_sql text := '';
  v_workspace_predicate text := 'false';
  v_event_time_expr text := 'now()';
  v_payload_expr text := '''{}''::jsonb';
  v_lat_expr text := 'NULL::double precision';
  v_lng_expr text := 'NULL::double precision';
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.display_name), '[]'::jsonb)
  INTO v_members
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
    SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.started_at DESC), '[]'::jsonb)
    INTO v_sessions
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

  v_has_session_events := to_regclass('public.session_events') IS NOT NULL;

  IF v_has_session_events THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'workspace_id'
    ) INTO v_has_session_events_workspace_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'session_id'
    ) INTO v_has_session_events_session_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'event_time'
    ) INTO v_has_session_events_event_time;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'payload'
    ) INTO v_has_session_events_payload;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'lat'
    ) INTO v_has_session_events_lat;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'lon'
    ) INTO v_has_session_events_lon;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'timestamp'
    ) INTO v_has_session_events_timestamp;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'created_at'
    ) INTO v_has_session_events_created_at;

    IF v_has_session_events_session_id AND v_has_sessions_workspace_id THEN
      v_join_sql := 'LEFT JOIN public.sessions ss ON ss.id = se.session_id';
      v_workspace_predicate := CASE
        WHEN v_has_session_events_workspace_id THEN 'COALESCE(se.workspace_id, ss.workspace_id) = $1'
        ELSE 'ss.workspace_id = $1'
      END;
    ELSIF v_has_session_events_workspace_id THEN
      v_workspace_predicate := 'se.workspace_id = $1';
    END IF;

    IF v_has_session_events_event_time THEN
      v_event_time_expr := 'se.event_time';
    ELSIF v_has_session_events_timestamp THEN
      v_event_time_expr := 'se."timestamp"';
    ELSIF v_has_session_events_created_at THEN
      v_event_time_expr := 'se.created_at';
    END IF;

    IF v_has_session_events_payload THEN
      v_payload_expr := 'CASE WHEN jsonb_typeof(se.payload) = ''object'' THEN se.payload ELSE ''{}''::jsonb END';
    END IF;

    IF v_has_session_events_lat THEN
      v_lat_expr := 'se.lat';
    ELSIF v_has_session_events_payload THEN
      v_lat_expr := 'NULLIF(se.payload->>''lat'', '''')::double precision';
    END IF;

    IF v_has_session_events_lon THEN
      v_lng_expr := 'se.lon';
    ELSIF v_has_session_events_payload THEN
      v_lng_expr := 'NULLIF(COALESCE(se.payload->>''lng'', se.payload->>''lon''), '''')::double precision';
    END IF;

    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(row_to_json(k)::jsonb ORDER BY k.event_time DESC), ''[]''::jsonb)
       FROM (
         SELECT
           se.id,
           se.user_id,
           %1$s AS event_time,
           ''knock'' AS event_type,
           %2$s
             || jsonb_build_object(
               ''lat'', %3$s,
               ''lng'', %4$s,
               ''event_type_original'', se.event_type
             ) AS payload,
           COALESCE(
             NULLIF(trim(COALESCE(up.first_name, '''') || '' '' || COALESCE(up.last_name, '''')), ''''),
             ''Member''
           ) AS display_name
         FROM public.session_events se
         %5$s
         LEFT JOIN public.user_profiles up ON up.user_id = se.user_id
         WHERE %6$s
           AND %1$s >= $2
           AND %1$s <= $3
           AND se.event_type IN (''knock'', ''conversation'', ''flyer_left'', ''completed_manual'', ''completed_auto'')
           AND %3$s IS NOT NULL
           AND %4$s IS NOT NULL
         ORDER BY %1$s DESC
       ) k',
      v_event_time_expr,
      v_payload_expr,
      v_lat_expr,
      v_lng_expr,
      v_join_sql,
      v_workspace_predicate
    )
    INTO v_knock_points
    USING p_workspace_id, p_start_ts, p_end_ts;
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
