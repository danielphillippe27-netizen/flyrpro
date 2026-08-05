BEGIN;

-- Canonical outcome functions construct geography values. Supabase installs
-- PostGIS in `extensions`, so an explicit function-level `public` search path
-- must include that schema as well.
DO $$
DECLARE
  candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'v2_record_campaign_address_outcome',
        'v2_record_campaign_address_outcome_creator_unchecked',
        'v2_record_campaign_target_outcome',
        'record_campaign_address_outcome_legacy_impl'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, extensions',
      candidate.oid::regprocedure
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.session_appointment_count(p_session_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    (
      SELECT COUNT(DISTINCT COALESCE(se.address_id::TEXT, se.id::TEXT))::INTEGER
      FROM public.session_events se
      WHERE se.session_id = p_session_id
        AND (
          lower(COALESCE(se.outcome, '')) = 'appointment'
          OR lower(COALESCE(se.conversation_type, '')) = 'appointment'
          OR lower(COALESCE(se.metadata->>'address_status', '')) = 'appointment'
        )
    ),
    (
      SELECT COUNT(DISTINCT ce.fub_appointment_id)::INTEGER
      FROM public.sessions s
      JOIN public.crm_events ce
        ON ce.user_id = s.user_id
       AND ce.fub_appointment_id IS NOT NULL
       AND ce.created_at >= s.start_time
       AND ce.created_at < COALESCE(s.end_time, now())
      WHERE s.id = p_session_id
    )
  );
$$;

COMMENT ON FUNCTION public.session_appointment_count(UUID) IS
  'Canonical per-session appointment count. Reconciles native field outcomes with imported CRM appointments without double-counting the common mirrored case.';

CREATE OR REPLACE VIEW public.session_analytics AS
SELECT
  s.id,
  s.user_id,
  s.start_time,
  s.end_time,
  s.distance_meters,
  s.goal_type,
  s.goal_amount,
  s.path_geojson,
  s.created_at,
  s.updated_at,
  s.campaign_id,
  s.doors_hit,
  s.conversations,
  s.summary_png_url,
  s.route_data,
  s.flyers_delivered,
  s.is_paused,
  s.active_seconds,
  s.target_building_ids,
  s.completed_count,
  s.auto_complete_enabled,
  s.auto_complete_threshold_m,
  s.auto_complete_dwell_seconds,
  s.notes,
  s.target_count,
  s.workspace_id,
  s.leads_created,
  pace.doors_per_hour,
  pace.conversations_per_hour,
  pace.completions_per_km,
  CASE WHEN base.doors_total > 0
    THEN base.conversations_total::DOUBLE PRECISION / base.doors_total::DOUBLE PRECISION
    ELSE 0.0
  END AS conversations_per_door,
  CASE WHEN base.conversations_total > 0
    THEN base.leads_total::DOUBLE PRECISION / base.conversations_total::DOUBLE PRECISION
    ELSE 0.0
  END AS leads_per_conversation,
  appts.appointments_count,
  CASE WHEN base.conversations_total > 0
    THEN appts.appointments_count::DOUBLE PRECISION / base.conversations_total::DOUBLE PRECISION
    ELSE 0.0
  END AS appointments_per_conversation
FROM public.sessions s
CROSS JOIN LATERAL (
  SELECT
    GREATEST(COALESCE(s.doors_hit, s.flyers_delivered, s.completed_count, 0), 0) AS doors_total,
    GREATEST(COALESCE(s.conversations, 0), 0) AS conversations_total,
    GREATEST(COALESCE(s.leads_created, 0), 0) AS leads_total,
    GREATEST(COALESCE(s.distance_meters, 0), 0) / 1000.0 AS distance_km,
    GREATEST(
      COALESCE(
        NULLIF(s.active_seconds, 0)::DOUBLE PRECISION,
        EXTRACT(EPOCH FROM (COALESCE(s.end_time, now()) - s.start_time))
      ),
      0.0
    ) AS duration_seconds
) base
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN base.duration_seconds > 0
      THEN base.doors_total::DOUBLE PRECISION / (base.duration_seconds / 3600.0)
      ELSE 0.0
    END AS doors_per_hour,
    CASE WHEN base.duration_seconds > 0
      THEN base.conversations_total::DOUBLE PRECISION / (base.duration_seconds / 3600.0)
      ELSE 0.0
    END AS conversations_per_hour,
    CASE WHEN base.distance_km > 0
      THEN base.doors_total::DOUBLE PRECISION / base.distance_km
      ELSE 0.0
    END AS completions_per_km
) pace
CROSS JOIN LATERAL (
  SELECT public.session_appointment_count(s.id) AS appointments_count
) appts;

ALTER VIEW public.session_analytics SET (security_invoker = true);
GRANT SELECT ON public.session_analytics TO authenticated;

COMMENT ON VIEW public.session_analytics IS
  'Sessions with derived pace and conversion metrics. Appointment totals reconcile native field outcomes and CRM appointment imports.';

DO $$
BEGIN
  IF to_regprocedure('public.refresh_user_stats_from_sessions_base(uuid)') IS NULL THEN
    ALTER FUNCTION public.refresh_user_stats_from_sessions(UUID)
      RENAME TO refresh_user_stats_from_sessions_base;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_user_stats_from_sessions(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_user_stats_from_sessions_base(p_user_id);

  UPDATE public.user_stats us
  SET appointments = metrics.appointments,
      updated_at = now()
  FROM (
    SELECT COALESCE(SUM(public.session_appointment_count(s.id)), 0)::INTEGER AS appointments
    FROM public.sessions s
    WHERE s.user_id = p_user_id
      AND s.end_time IS NOT NULL
  ) metrics
  WHERE us.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.session_appointment_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_stats_from_sessions(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
