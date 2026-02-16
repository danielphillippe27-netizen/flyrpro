-- RPC: get user stats for a time period (daily, weekly, monthly, lifetime).
-- Lifetime returns the existing user_stats row.
-- Daily/weekly/monthly: qr_codes_scanned from scan_events (campaigns.owner_id); other metrics 0 (no time-series source yet).

CREATE OR REPLACE FUNCTION public.get_user_stats_for_period(
  p_user_id uuid,
  p_period text  -- 'daily' | 'weekly' | 'monthly' | 'lifetime'
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  day_streak integer,
  best_streak integer,
  doors_knocked integer,
  flyers integer,
  conversations integer,
  leads_created integer,
  qr_codes_scanned integer,
  distance_walked numeric,
  time_tracked numeric,
  conversation_per_door numeric,
  conversation_lead_rate numeric,
  qr_code_scan_rate numeric,
  qr_code_lead_rate numeric,
  streak_days text[],
  xp integer,
  routes_walked integer,
  updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end   timestamptz := now();
  v_qr   integer;
BEGIN
  IF p_period = 'lifetime' THEN
    -- Return existing user_stats row
    RETURN QUERY
    SELECT
      us.id,
      us.user_id,
      COALESCE(us.day_streak, 0)::integer,
      COALESCE(us.best_streak, 0)::integer,
      COALESCE(us.doors_knocked, 0)::integer,
      COALESCE(us.flyers, 0)::integer,
      COALESCE(us.conversations, 0)::integer,
      COALESCE(us.leads_created, 0)::integer,
      COALESCE(us.qr_codes_scanned, 0)::integer,
      COALESCE(us.distance_walked, 0)::numeric,
      COALESCE(us.time_tracked, 0)::numeric,
      COALESCE(us.conversation_per_door, 0)::numeric,
      COALESCE(us.conversation_lead_rate, 0)::numeric,
      COALESCE(us.qr_code_scan_rate, 0)::numeric,
      COALESCE(us.qr_code_lead_rate, 0)::numeric,
      us.streak_days,
      COALESCE(us.xp, 0)::integer,
      COALESCE(us.routes_walked, 0)::integer,
      us.updated_at,
      us.created_at
    FROM public.user_stats us
    WHERE us.user_id = p_user_id
    LIMIT 1;
    RETURN;
  END IF;

  -- Date range for daily / weekly / monthly
  v_start := CASE p_period
    WHEN 'daily'   THEN date_trunc('day', v_end)
    WHEN 'weekly'  THEN date_trunc('week', v_end)
    WHEN 'monthly' THEN date_trunc('month', v_end)
    ELSE date_trunc('day', v_end)
  END;

  -- QR scans in period: scan_events for campaigns owned by user
  SELECT COUNT(*)::integer INTO v_qr
  FROM public.scan_events se
  JOIN public.campaigns c ON c.id = se.campaign_id AND c.owner_id = p_user_id
  WHERE se.scanned_at >= v_start AND se.scanned_at < v_end;

  -- Return one row with period stats (qr from scan_events; rest 0; streaks/updated_at from user_stats if row exists)
  RETURN QUERY
  SELECT
    gen_random_uuid(),
    p_user_id,
    COALESCE(us.day_streak, 0)::integer,
    COALESCE(us.best_streak, 0)::integer,
    0::integer,
    0::integer,
    0::integer,
    0::integer,
    COALESCE(v_qr, 0),
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    us.streak_days,
    0::integer,
    0::integer,
    COALESCE(us.updated_at, now()),
    us.created_at
  FROM (SELECT 1) dummy
  LEFT JOIN public.user_stats us ON us.user_id = p_user_id
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.get_user_stats_for_period(uuid, text) IS
'Returns user stats for period: lifetime = user_stats row; daily/weekly/monthly = qr_codes_scanned from scan_events, other metrics 0.';

GRANT EXECUTE ON FUNCTION public.get_user_stats_for_period(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_stats_for_period(uuid, text) TO service_role;
