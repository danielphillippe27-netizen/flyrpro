-- Add total_duration_seconds (team time) to get_team_dashboard_summary for time card.
-- Idempotent.

BEGIN;

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
  v_cur_duration_sec bigint := 0;
  v_prev_doors int := 0;
  v_prev_convos int := 0;
  v_prev_followups int := 0;
  v_prev_appointments int := 0;
  v_prev_sessions int := 0;
  v_prev_duration_sec bigint := 0;
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
    COUNT(fs.id)::int,
    COALESCE(SUM(fs.duration_seconds) FILTER (WHERE fs.duration_seconds IS NOT NULL), 0)::bigint
  INTO v_cur_doors, v_cur_convos, v_cur_followups, v_cur_appointments, v_cur_sessions, v_cur_duration_sec
  FROM public.field_sessions fs
  WHERE fs.workspace_id = p_workspace_id
    AND fs.started_at >= p_start_ts
    AND fs.started_at <= p_end_ts;

  SELECT
    COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0),
    COALESCE(SUM((fs.stats->>'conversations')::int), 0),
    COALESCE(SUM((fs.stats->>'followups')::int), 0),
    COALESCE(SUM((fs.stats->>'appointments')::int), 0),
    COUNT(fs.id)::int,
    COALESCE(SUM(fs.duration_seconds) FILTER (WHERE fs.duration_seconds IS NOT NULL), 0)::bigint
  INTO v_prev_doors, v_prev_convos, v_prev_followups, v_prev_appointments, v_prev_sessions, v_prev_duration_sec
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
      'sessions_count', v_cur_sessions,
      'total_duration_seconds', v_cur_duration_sec
    ),
    'previousTotals', jsonb_build_object(
      'doors', v_prev_doors,
      'convos', v_prev_convos,
      'followups', v_prev_followups,
      'appointments', v_prev_appointments,
      'sessions_count', v_prev_sessions,
      'total_duration_seconds', v_prev_duration_sec
    ),
    'deltas', jsonb_build_object(
      'doors', v_cur_doors - v_prev_doors,
      'convos', v_cur_convos - v_prev_convos,
      'followups', v_cur_followups - v_prev_followups,
      'appointments', v_cur_appointments - v_prev_appointments,
      'sessions_count', v_cur_sessions - v_prev_sessions,
      'total_duration_seconds', v_cur_duration_sec - v_prev_duration_sec
    ),
    'doorsByDay', COALESCE(v_doors_by_day, '[]'::jsonb)
  );
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz)
  IS 'Dashboard summary: totals (incl. total_duration_seconds), previous period, deltas, doors by day; owner/admin only.';

COMMIT;
