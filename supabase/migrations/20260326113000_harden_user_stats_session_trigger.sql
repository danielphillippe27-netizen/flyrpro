-- Make session completion the single writer for session-derived user_stats fields.
-- This prevents double counting when the client also tries to increment user_stats
-- after persisting the same ended session.

BEGIN;

DROP TRIGGER IF EXISTS trigger_update_user_stats_from_session ON public.sessions;
DROP FUNCTION IF EXISTS public.update_user_stats_from_session();

CREATE OR REPLACE FUNCTION public.update_user_stats_from_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_doors_knocked INTEGER := 0;
    v_flyers INTEGER := 0;
    v_conversations INTEGER := 0;
    v_leads_created INTEGER := 0;
    v_appointments INTEGER := 0;
    v_distance_walked DOUBLE PRECISION := 0.0;
    v_time_tracked INTEGER := 0;
BEGIN
    IF NEW.end_time IS NULL THEN
        RETURN NEW;
    END IF;

    -- Only count a session once: either when inserted already-ended,
    -- or on the first transition from active -> ended.
    IF TG_OP = 'UPDATE' AND OLD.end_time IS NOT NULL THEN
        RETURN NEW;
    END IF;

    v_doors_knocked := GREATEST(COALESCE(NEW.doors_hit, NEW.completed_count, NEW.flyers_delivered, 0), 0);
    v_flyers := GREATEST(COALESCE(NEW.flyers_delivered, NEW.completed_count, 0), 0);
    v_conversations := GREATEST(COALESCE(NEW.conversations, 0), 0);
    v_leads_created := GREATEST(COALESCE(NEW.leads_created, 0), 0);
    v_distance_walked := GREATEST(COALESCE(NEW.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0;
    v_time_tracked := GREATEST(
        COALESCE(
            FLOOR(COALESCE(NEW.active_seconds, EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))) / 60.0)::INTEGER,
            0
        ),
        0
    );

    SELECT COALESCE(COUNT(*), 0)::INTEGER
    INTO v_appointments
    FROM public.crm_events ce
    WHERE ce.user_id = NEW.user_id
      AND ce.fub_appointment_id IS NOT NULL
      AND ce.created_at >= NEW.start_time
      AND ce.created_at < NEW.end_time;

    INSERT INTO public.user_stats (
        user_id,
        doors_knocked,
        flyers,
        conversations,
        leads_created,
        appointments,
        distance_walked,
        time_tracked,
        conversation_per_door,
        conversation_lead_rate,
        qr_code_scan_rate,
        qr_code_lead_rate
    )
    VALUES (
        NEW.user_id,
        v_doors_knocked,
        v_flyers,
        v_conversations,
        v_leads_created,
        v_appointments,
        v_distance_walked,
        v_time_tracked,
        CASE
            WHEN v_doors_knocked > 0 THEN v_conversations::DOUBLE PRECISION / v_doors_knocked::DOUBLE PRECISION
            ELSE 0.0
        END,
        CASE
            WHEN v_conversations > 0 THEN v_leads_created::DOUBLE PRECISION / v_conversations::DOUBLE PRECISION
            ELSE 0.0
        END,
        0.0,
        0.0
    )
    ON CONFLICT (user_id) DO UPDATE SET
        doors_knocked = public.user_stats.doors_knocked + EXCLUDED.doors_knocked,
        flyers = public.user_stats.flyers + EXCLUDED.flyers,
        conversations = public.user_stats.conversations + EXCLUDED.conversations,
        leads_created = public.user_stats.leads_created + EXCLUDED.leads_created,
        appointments = public.user_stats.appointments + EXCLUDED.appointments,
        distance_walked = public.user_stats.distance_walked + EXCLUDED.distance_walked,
        time_tracked = public.user_stats.time_tracked + EXCLUDED.time_tracked,
        conversation_per_door = CASE
            WHEN (public.user_stats.doors_knocked + EXCLUDED.doors_knocked) > 0 THEN
                (public.user_stats.conversations + EXCLUDED.conversations)::DOUBLE PRECISION
                / (public.user_stats.doors_knocked + EXCLUDED.doors_knocked)::DOUBLE PRECISION
            ELSE 0.0
        END,
        conversation_lead_rate = CASE
            WHEN (public.user_stats.conversations + EXCLUDED.conversations) > 0 THEN
                (public.user_stats.leads_created + EXCLUDED.leads_created)::DOUBLE PRECISION
                / (public.user_stats.conversations + EXCLUDED.conversations)::DOUBLE PRECISION
            ELSE 0.0
        END,
        qr_code_scan_rate = CASE
            WHEN (public.user_stats.flyers + EXCLUDED.flyers) > 0 THEN
                public.user_stats.qr_codes_scanned::DOUBLE PRECISION
                / (public.user_stats.flyers + EXCLUDED.flyers)::DOUBLE PRECISION
            ELSE 0.0
        END,
        qr_code_lead_rate = CASE
            WHEN public.user_stats.qr_codes_scanned > 0 THEN
                (public.user_stats.leads_created + EXCLUDED.leads_created)::DOUBLE PRECISION
                / public.user_stats.qr_codes_scanned::DOUBLE PRECISION
            ELSE 0.0
        END,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_user_stats_from_session
    AFTER INSERT OR UPDATE OF end_time ON public.sessions
    FOR EACH ROW
    WHEN (NEW.end_time IS NOT NULL)
    EXECUTE FUNCTION public.update_user_stats_from_session();

COMMENT ON FUNCTION public.update_user_stats_from_session IS
    'Roll up ended sessions into user_stats exactly once, including doors, leads, appointments, and derived rates.';

COMMIT;
