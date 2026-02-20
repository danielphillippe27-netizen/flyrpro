-- Team dashboard: get_team_members_with_stats (role, last_active_at) and get_team_activity_feed p_user_id filter.
-- Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) RPC: get_team_members_with_stats (owner/admin only; for Members tab and Dashboard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_members_with_stats(
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

  SELECT COALESCE(
    jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doors_knocked DESC, t.last_active_at DESC NULLS LAST),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT
      wm.user_id,
      wm.role,
      COALESCE(wm.color, '#3B82F6') AS color,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      (
        SELECT MAX(ae.event_time)
        FROM public.activity_events ae
        WHERE ae.workspace_id = wm.workspace_id AND ae.user_id = wm.user_id
      ) AS last_active_at,
      COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0)::int AS doors_knocked,
      COALESCE(SUM((fs.stats->>'conversations')::int), 0)::int AS conversations,
      COALESCE(SUM((fs.stats->>'followups')::int), 0)::int AS followups,
      COALESCE(SUM((fs.stats->>'appointments')::int), 0)::int AS appointments,
      COUNT(fs.id)::int AS sessions_count,
      COUNT(DISTINCT date_trunc('day', fs.started_at)::date)::int AS active_days
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    LEFT JOIN public.field_sessions fs ON fs.workspace_id = wm.workspace_id AND fs.user_id = wm.user_id
      AND fs.started_at >= p_start_ts AND fs.started_at <= p_end_ts
    WHERE wm.workspace_id = p_workspace_id
    GROUP BY wm.user_id, wm.role, wm.color, wm.workspace_id, up.first_name, up.last_name, u.raw_user_meta_data, u.email
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_team_members_with_stats(uuid, timestamptz, timestamptz)
  IS 'Members with role, last_active_at, and range stats; owner/admin only.';

GRANT EXECUTE ON FUNCTION public.get_team_members_with_stats(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_members_with_stats(uuid, timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Extend get_team_activity_feed: add optional p_user_id to filter by member
-- ---------------------------------------------------------------------------
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
    AND (p_user_id IS NULL OR ae.user_id = p_user_id)
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
      AND (p_user_id IS NULL OR ae.user_id = p_user_id)
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

COMMENT ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid)
  IS 'Paginated activity feed; optional p_user_id to filter by member (owner/admin only).';

GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) RPC: get_team_dashboard_summary (current + previous totals, deltas, doors_by_day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_dashboard_summary(
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
  v_cur_doors int := 0;
  v_cur_convos int := 0;
  v_cur_followups int := 0;
  v_cur_appointments int := 0;
  v_cur_sessions int := 0;
  v_prev_doors int := 0;
  v_prev_convos int := 0;
  v_prev_followups int := 0;
  v_prev_appointments int := 0;
  v_prev_sessions int := 0;
  v_doors_by_day jsonb;
  v_interval interval;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_interval := p_end_ts - p_start_ts;
  v_prev_end := p_start_ts;
  v_prev_start := p_start_ts - v_interval;

  SELECT
    COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0),
    COALESCE(SUM((fs.stats->>'conversations')::int), 0),
    COALESCE(SUM((fs.stats->>'followups')::int), 0),
    COALESCE(SUM((fs.stats->>'appointments')::int), 0),
    COUNT(fs.id)::int
  INTO v_cur_doors, v_cur_convos, v_cur_followups, v_cur_appointments, v_cur_sessions
  FROM public.field_sessions fs
  WHERE fs.workspace_id = p_workspace_id
    AND fs.started_at >= p_start_ts
    AND fs.started_at <= p_end_ts;

  SELECT
    COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0),
    COALESCE(SUM((fs.stats->>'conversations')::int), 0),
    COALESCE(SUM((fs.stats->>'followups')::int), 0),
    COALESCE(SUM((fs.stats->>'appointments')::int), 0),
    COUNT(fs.id)::int
  INTO v_prev_doors, v_prev_convos, v_prev_followups, v_prev_appointments, v_prev_sessions
  FROM public.field_sessions fs
  WHERE fs.workspace_id = p_workspace_id
    AND fs.started_at >= v_prev_start
    AND fs.started_at < v_prev_end;

  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.day_date), '[]'::jsonb) INTO v_doors_by_day
  FROM (
    SELECT
      date_trunc('day', fs.started_at)::date AS day_date,
      COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0)::int AS doors
    FROM public.field_sessions fs
    WHERE fs.workspace_id = p_workspace_id
      AND fs.started_at >= p_start_ts
      AND fs.started_at <= p_end_ts
    GROUP BY date_trunc('day', fs.started_at)::date
  ) d;

  v_result := jsonb_build_object(
    'totals', jsonb_build_object(
      'doors', v_cur_doors,
      'convos', v_cur_convos,
      'followups', v_cur_followups,
      'appointments', v_cur_appointments,
      'sessions_count', v_cur_sessions
    ),
    'previousTotals', jsonb_build_object(
      'doors', v_prev_doors,
      'convos', v_prev_convos,
      'followups', v_prev_followups,
      'appointments', v_prev_appointments,
      'sessions_count', v_prev_sessions
    ),
    'deltas', jsonb_build_object(
      'doors', v_cur_doors - v_prev_doors,
      'convos', v_cur_convos - v_prev_convos,
      'followups', v_cur_followups - v_prev_followups,
      'appointments', v_cur_appointments - v_prev_appointments,
      'sessions_count', v_cur_sessions - v_prev_sessions
    ),
    'doorsByDay', COALESCE(v_doors_by_day, '[]'::jsonb)
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz)
  IS 'Dashboard summary: totals, previous period totals, deltas, doors by day; owner/admin only.';

GRANT EXECUTE ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
