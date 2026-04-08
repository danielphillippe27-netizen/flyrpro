-- Fix last_30_days leaderboard: it previously summed all platform sessions in the last 30 days,
-- which mixed in users outside the rolling challenge cohort. It now uses the SAME participants
-- as challenge_window and only counts sessions in [max(join_at, now()-30d), min(window_end, now())).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_challenge_rolling_leaderboard(
  p_challenge_slug text,
  p_window text,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  score bigint,
  rank bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration integer;
BEGIN
  SELECT ct.duration_days INTO v_duration
  FROM public.challenge_templates ct
  WHERE ct.slug = p_challenge_slug
    AND ct.scope = 'global'
    AND ct.type = 'rolling_onboarding'
    AND ct.status = 'active'
  LIMIT 1;

  IF v_duration IS NULL THEN
    RETURN;
  END IF;

  IF p_window = 'challenge_window' THEN
    RETURN QUERY
    WITH eligible AS (
      SELECT DISTINCT u.id AS uid, u.created_at AS join_at
      FROM auth.users u
      WHERE EXISTS (
        SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id
      )
      OR EXISTS (
        SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.end_time IS NOT NULL
      )
    ),
    parts AS (
      SELECT
        e.uid AS user_id,
        e.join_at,
        e.join_at + (v_duration::text || ' days')::interval AS window_end
      FROM eligible e
      WHERE e.join_at + (v_duration::text || ' days')::interval > now() - interval '800 days'
    ),
    agg AS (
      SELECT
        s.user_id AS uid,
        SUM(COALESCE(s.flyers_delivered, 0))::bigint AS sc
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= p.join_at
        AND s.start_time < LEAST(p.window_end, now())
      GROUP BY s.user_id
    )
    SELECT
      p.user_id,
      COALESCE(
        NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        NULLIF(trim(au.email), ''),
        'Member'
      )::text AS display_name,
      COALESCE(a.sc, 0::bigint) AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.join_at ASC
      )::bigint AS rank
    FROM parts p
    LEFT JOIN agg a ON a.uid = p.user_id
    LEFT JOIN public.user_profiles pr ON pr.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.join_at ASC
    LIMIT p_limit;

    RETURN;
  END IF;

  IF p_window = 'last_30_days' THEN
    RETURN QUERY
    WITH eligible AS (
      SELECT DISTINCT u.id AS uid, u.created_at AS join_at
      FROM auth.users u
      WHERE EXISTS (
        SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id
      )
      OR EXISTS (
        SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.end_time IS NOT NULL
      )
    ),
    parts AS (
      SELECT
        e.uid AS user_id,
        e.join_at,
        e.join_at + (v_duration::text || ' days')::interval AS window_end
      FROM eligible e
      WHERE e.join_at + (v_duration::text || ' days')::interval > now() - interval '800 days'
    ),
    cutoff AS (
      SELECT (now() - interval '30 days') AS ts
    ),
    agg AS (
      SELECT
        s.user_id AS uid,
        SUM(COALESCE(s.flyers_delivered, 0))::bigint AS sc
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      CROSS JOIN cutoff c
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= GREATEST(p.join_at, c.ts)
        AND s.start_time < LEAST(p.window_end, now())
      GROUP BY s.user_id
    )
    SELECT
      p.user_id,
      COALESCE(
        NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        NULLIF(trim(au.email), ''),
        'Member'
      )::text AS display_name,
      COALESCE(a.sc, 0::bigint) AS score,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.join_at ASC
      )::bigint AS rank
    FROM parts p
    LEFT JOIN agg a ON a.uid = p.user_id
    LEFT JOIN public.user_profiles pr ON pr.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.join_at ASC
    LIMIT p_limit;

    RETURN;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_challenge_rolling_leaderboard(text, text, integer) IS
  'Rolling global challenge leaderboards: challenge_window = full personal window; last_30_days = same cohort, sessions only in the last 30 calendar days (clipped to each user window).';

COMMIT;
