-- Extend session analytics with lead conversion metrics.

CREATE OR REPLACE VIEW public.session_analytics AS
SELECT
    s.*,
    pace.doors_per_hour,
    pace.conversations_per_hour,
    pace.completions_per_km,
    CASE
        WHEN base.doors_total > 0 THEN
            base.conversations_total::DOUBLE PRECISION / base.doors_total::DOUBLE PRECISION
        ELSE 0.0
    END AS conversations_per_door,
    CASE
        WHEN base.conversations_total > 0 THEN
            base.leads_total::DOUBLE PRECISION / base.conversations_total::DOUBLE PRECISION
        ELSE 0.0
    END AS leads_per_conversation,
    appts.appointments_count,
    CASE
        WHEN base.conversations_total > 0 THEN
            appts.appointments_count::DOUBLE PRECISION / base.conversations_total::DOUBLE PRECISION
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
        CASE
            WHEN base.duration_seconds > 0 THEN
                base.doors_total::DOUBLE PRECISION / (base.duration_seconds / 3600.0)
            ELSE 0.0
        END AS doors_per_hour,
        CASE
            WHEN base.duration_seconds > 0 THEN
                base.conversations_total::DOUBLE PRECISION / (base.duration_seconds / 3600.0)
            ELSE 0.0
        END AS conversations_per_hour,
        CASE
            WHEN base.distance_km > 0 THEN
                base.doors_total::DOUBLE PRECISION / base.distance_km
            ELSE 0.0
        END AS completions_per_km
) pace
CROSS JOIN LATERAL (
    SELECT COALESCE(COUNT(*), 0)::INTEGER AS appointments_count
    FROM public.crm_events ce
    WHERE ce.user_id = s.user_id
      AND ce.fub_appointment_id IS NOT NULL
      AND ce.created_at >= s.start_time
      AND ce.created_at < COALESCE(s.end_time, now())
) appts;

ALTER VIEW public.session_analytics SET (security_invoker = true);

GRANT SELECT ON public.session_analytics TO authenticated;

COMMENT ON VIEW public.session_analytics IS
    'Sessions with derived pace and conversion metrics, including conversations per door, leads per conversation, and appointment counts inferred from crm_events in the session time window.';

NOTIFY pgrst, 'reload schema';
