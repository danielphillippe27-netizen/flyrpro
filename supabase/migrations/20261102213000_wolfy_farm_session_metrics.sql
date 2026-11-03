-- Count saved Farm session totals when no individual visit events were recorded.
CREATE OR REPLACE FUNCTION public.wolfy_home_metrics(
  p_workspace uuid, p_day timestamptz, p_week timestamptz, p_until timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = p_workspace AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Workspace access required' USING ERRCODE = '42501'; END IF;
  IF p_week > p_day OR p_day > p_until OR p_until - p_week > interval '8 days' THEN
    RAISE EXCEPTION 'Invalid reporting interval';
  END IF;
  WITH ranked AS (
    SELECT e.*, row_number() OVER (
      PARTITION BY e.session_id, coalesce(e.building_id::text, e.address_id::text, e.id::text)
      ORDER BY e.created_at DESC, e.id DESC
    ) AS ordinal
    FROM public.session_events e JOIN public.sessions s ON s.id = e.session_id
    WHERE s.user_id = auth.uid() AND s.workspace_id = p_workspace
      AND e.created_at >= p_week AND e.created_at <= p_until
      AND e.event_type IN ('flyer_left', 'conversation', 'completed_manual', 'completed_auto', 'completion_undone')
  ), visits AS (
    SELECT * FROM ranked WHERE ordinal = 1 AND event_type <> 'completion_undone'
  ), farm_sessions_without_events AS (
    SELECT s.start_time, greatest(coalesce(s.doors_hit, 0), 0) AS doors
    FROM public.sessions s
    WHERE s.user_id = auth.uid() AND s.workspace_id = p_workspace
      AND s.farm_id IS NOT NULL AND s.start_time >= p_week AND s.start_time <= p_until
      AND NOT EXISTS (SELECT 1 FROM public.session_events e WHERE e.session_id = s.id
        AND e.event_type IN ('flyer_left', 'conversation', 'completed_manual', 'completed_auto', 'completion_undone'))
  ) SELECT jsonb_build_object(
    'doors', (SELECT count(*) FROM visits WHERE created_at >= p_day) + coalesce((SELECT sum(doors) FROM farm_sessions_without_events WHERE start_time >= p_day), 0),
    'weekly_doors', (SELECT count(*) FROM visits) + coalesce((SELECT sum(doors) FROM farm_sessions_without_events), 0),
    'conversations', (SELECT count(*) FROM visits WHERE created_at >= p_day AND event_type = 'conversation'
      AND coalesce(metadata->>'address_status', outcome, '') NOT IN ('no_answer', 'noAnswer', 'do_not_knock', 'doNotKnock')),
    'leads', (SELECT count(*) FROM public.contacts WHERE user_id = auth.uid() AND workspace_id = p_workspace
      AND lead_kind = 'field' AND created_at >= p_day AND created_at <= p_until),
    'appointments', (SELECT count(*) FROM public.contact_activities a JOIN public.contacts c ON c.id = a.contact_id
      WHERE c.user_id = auth.uid() AND c.workspace_id = p_workspace AND a.type = 'meeting'
        AND a.created_at >= p_day AND a.created_at <= p_until)
  ) INTO result;
  RETURN result;
END $$;
