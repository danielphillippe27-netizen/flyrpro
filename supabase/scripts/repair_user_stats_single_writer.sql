-- Repair user_stats from persisted sessions after double-counting or legacy client-side increments.
-- This recomputes only session-derived fields and preserves streaks, XP, and QR scan counts.

WITH per_session AS (
    SELECT
        s.user_id,
        GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doors_knocked,
        GREATEST(COALESCE(s.flyers_delivered, s.completed_count, 0), 0)::INTEGER AS flyers,
        GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
        GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads_created,
        GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_walked,
        GREATEST(
            COALESCE(
                FLOOR(COALESCE(s.active_seconds, EXTRACT(EPOCH FROM (s.end_time - s.start_time))) / 60.0)::INTEGER,
                0
            ),
            0
        ) AS time_tracked,
        (
            SELECT COALESCE(COUNT(*), 0)::INTEGER
            FROM public.crm_events ce
            WHERE ce.user_id = s.user_id
              AND ce.fub_appointment_id IS NOT NULL
              AND ce.created_at >= s.start_time
              AND ce.created_at < s.end_time
        ) AS appointments
    FROM public.sessions s
    WHERE s.end_time IS NOT NULL
),
rollups AS (
    SELECT
        ps.user_id,
        COALESCE(SUM(ps.doors_knocked), 0)::INTEGER AS doors_knocked,
        COALESCE(SUM(ps.flyers), 0)::INTEGER AS flyers,
        COALESCE(SUM(ps.conversations), 0)::INTEGER AS conversations,
        COALESCE(SUM(ps.leads_created), 0)::INTEGER AS leads_created,
        COALESCE(SUM(ps.appointments), 0)::INTEGER AS appointments,
        COALESCE(SUM(ps.distance_walked), 0)::DOUBLE PRECISION AS distance_walked,
        COALESCE(SUM(ps.time_tracked), 0)::INTEGER AS time_tracked
    FROM per_session ps
    GROUP BY ps.user_id
),
all_users AS (
    SELECT user_id FROM public.user_stats
    UNION
    SELECT user_id FROM rollups
)
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
    qr_code_lead_rate,
    updated_at
)
SELECT
    au.user_id,
    COALESCE(r.doors_knocked, 0),
    COALESCE(r.flyers, 0),
    COALESCE(r.conversations, 0),
    COALESCE(r.leads_created, 0),
    COALESCE(r.appointments, 0),
    COALESCE(r.distance_walked, 0.0),
    COALESCE(r.time_tracked, 0),
    CASE
        WHEN COALESCE(r.doors_knocked, 0) > 0 THEN COALESCE(r.conversations, 0)::DOUBLE PRECISION / r.doors_knocked::DOUBLE PRECISION
        ELSE 0.0
    END,
    CASE
        WHEN COALESCE(r.conversations, 0) > 0 THEN COALESCE(r.leads_created, 0)::DOUBLE PRECISION / r.conversations::DOUBLE PRECISION
        ELSE 0.0
    END,
    0.0,
    0.0,
    NOW()
FROM all_users au
LEFT JOIN rollups r ON r.user_id = au.user_id
ON CONFLICT (user_id) DO UPDATE SET
    doors_knocked = EXCLUDED.doors_knocked,
    flyers = EXCLUDED.flyers,
    conversations = EXCLUDED.conversations,
    leads_created = EXCLUDED.leads_created,
    appointments = EXCLUDED.appointments,
    distance_walked = EXCLUDED.distance_walked,
    time_tracked = EXCLUDED.time_tracked,
    conversation_per_door = EXCLUDED.conversation_per_door,
    conversation_lead_rate = EXCLUDED.conversation_lead_rate,
    qr_code_scan_rate = CASE
        WHEN EXCLUDED.flyers > 0 THEN public.user_stats.qr_codes_scanned::DOUBLE PRECISION / EXCLUDED.flyers::DOUBLE PRECISION
        ELSE 0.0
    END,
    qr_code_lead_rate = CASE
        WHEN public.user_stats.qr_codes_scanned > 0 THEN EXCLUDED.leads_created::DOUBLE PRECISION / public.user_stats.qr_codes_scanned::DOUBLE PRECISION
        ELSE 0.0
    END,
    updated_at = NOW();

SELECT
    user_id,
    doors_knocked,
    flyers,
    conversations,
    leads_created,
    appointments,
    distance_walked,
    time_tracked,
    conversation_per_door,
    conversation_lead_rate
FROM public.user_stats
ORDER BY updated_at DESC
LIMIT 20;
