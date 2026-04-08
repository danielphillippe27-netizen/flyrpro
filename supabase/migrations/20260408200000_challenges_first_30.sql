-- Global / team challenge templates and leaderboard RPC for rolling onboarding challenges.
-- Seeds "Your First 30 Days on FLYR" (slug: first-30-days).

BEGIN;

CREATE TABLE IF NOT EXISTS public.challenge_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  scope text NOT NULL CHECK (scope IN ('global', 'team')),
  type text NOT NULL CHECK (type IN ('fixed_date', 'rolling_onboarding')),
  metric text NOT NULL,
  metric_label_override text,
  start_date timestamptz,
  end_date timestamptz,
  duration_days integer,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'archived')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'workspace_private')),
  target_audience text,
  include_all_members boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_templates_slug_unique UNIQUE (slug),
  CONSTRAINT challenge_templates_workspace_team CHECK (
    (scope = 'global' AND workspace_id IS NULL) OR (scope = 'team' AND workspace_id IS NOT NULL)
  ),
  CONSTRAINT challenge_templates_dates CHECK (
    (type = 'fixed_date' AND start_date IS NOT NULL AND end_date IS NOT NULL AND duration_days IS NULL)
    OR (type = 'rolling_onboarding' AND duration_days IS NOT NULL AND duration_days > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_challenge_templates_scope_status
  ON public.challenge_templates(scope, status);

COMMENT ON TABLE public.challenge_templates IS 'Challenge definitions: global platform or per-workspace team challenges.';

ALTER TABLE public.challenge_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "challenge_templates_select_authenticated" ON public.challenge_templates;
CREATE POLICY "challenge_templates_select_authenticated"
  ON public.challenge_templates FOR SELECT
  TO authenticated
  USING (
    scope = 'global'
    OR (
      scope = 'team'
      AND workspace_id IS NOT NULL
      AND workspace_id = ANY (public.current_user_workspace_ids())
    )
  );

DROP POLICY IF EXISTS "challenge_templates_all_service" ON public.challenge_templates;
CREATE POLICY "challenge_templates_all_service"
  ON public.challenge_templates FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Rolling-window leaderboard: challenge_window = score inside each user's personal window;
-- last_30_days: superseded by 20260408213000_fix_challenge_last_30_same_cohort.sql (same cohort, clipped dates).
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
    WITH cutoff AS (
      SELECT (now() - interval '30 days') AS ts
    ),
    agg AS (
      SELECT
        s.user_id AS uid,
        SUM(COALESCE(s.flyers_delivered, 0))::bigint AS sc
      FROM public.sessions s, cutoff c
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= c.ts
      GROUP BY s.user_id
    )
    SELECT
      a.uid AS user_id,
      COALESCE(
        NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        NULLIF(trim(au.email), ''),
        'Member'
      )::text AS display_name,
      a.sc AS score,
      ROW_NUMBER() OVER (ORDER BY a.sc DESC, a.uid ASC)::bigint AS rank
    FROM agg a
    LEFT JOIN public.user_profiles pr ON pr.user_id = a.uid
    LEFT JOIN auth.users au ON au.id = a.uid
    WHERE a.sc > 0
    ORDER BY a.sc DESC, a.uid ASC
    LIMIT p_limit;

    RETURN;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_challenge_rolling_leaderboard(text, text, integer) IS
  'Leaderboard for rolling global challenges: challenge_window (per-user join + duration) or last_30_days (calendar).';

GRANT EXECUTE ON FUNCTION public.get_challenge_rolling_leaderboard(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_challenge_rolling_leaderboard(text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.count_challenge_rolling_participants(p_challenge_slug text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration integer;
  v_count bigint;
BEGIN
  SELECT ct.duration_days INTO v_duration
  FROM public.challenge_templates ct
  WHERE ct.slug = p_challenge_slug
    AND ct.scope = 'global'
    AND ct.type = 'rolling_onboarding'
    AND ct.status = 'active'
  LIMIT 1;

  IF v_duration IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::bigint INTO v_count
  FROM (
    SELECT DISTINCT u.id AS uid
    FROM auth.users u
    WHERE (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id)
      OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.end_time IS NOT NULL))
      AND u.created_at + (v_duration::text || ' days')::interval > now() - interval '800 days'
  ) sub;

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_challenge_rolling_participants(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_challenge_rolling_participants(text) TO service_role;

-- Seed the canonical first-30 challenge (idempotent)
INSERT INTO public.challenge_templates (
  slug,
  title,
  description,
  scope,
  type,
  metric,
  metric_label_override,
  duration_days,
  status,
  visibility,
  target_audience
)
VALUES (
  'first-30-days',
  'Your First 30 Days on FLYR',
  'Every new member gets 30 days to compete, build momentum, and see how they stack up on FLYR.',
  'global',
  'rolling_onboarding',
  'homes_reached',
  'homes reached',
  30,
  'active',
  'public',
  'All new members (rolling from join date)'
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
