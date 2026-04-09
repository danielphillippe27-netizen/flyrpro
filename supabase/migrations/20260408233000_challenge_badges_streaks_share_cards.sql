BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text,
  message text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_type
  ON public.notifications(user_id, type, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notifications_all_service" ON public.notifications;
CREATE POLICY "notifications_all_service"
  ON public.notifications FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.notifications IS
  'In-app notification queue used by mobile/web surfaces and push fan-out workers.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'share-cards',
  'share-cards',
  true,
  10485760,
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public read share-cards" ON storage.objects;
CREATE POLICY "Public read share-cards"
ON storage.objects FOR SELECT
USING (bucket_id = 'share-cards');

DROP POLICY IF EXISTS "Service role full access share-cards" ON storage.objects;
CREATE POLICY "Service role full access share-cards"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'share-cards')
WITH CHECK (bucket_id = 'share-cards');

CREATE TABLE IF NOT EXISTS public.challenge_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES public.challenge_templates(id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  is_permanent boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_badges_badge_unique UNIQUE (user_id, challenge_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_badges_active
  ON public.challenge_badges(challenge_id, user_id, is_active);

ALTER TABLE public.challenge_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "challenge_badges_select_authenticated" ON public.challenge_badges;
CREATE POLICY "challenge_badges_select_authenticated"
  ON public.challenge_badges FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "challenge_badges_all_service" ON public.challenge_badges;
CREATE POLICY "challenge_badges_all_service"
  ON public.challenge_badges FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.challenge_badges IS
  'Earned and active challenge badges for rolling leaderboard surfaces. challenge_id points at challenge_templates for the current First 30 Days system.';

CREATE TABLE IF NOT EXISTS public.accountability_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_id uuid NOT NULL REFERENCES public.challenge_templates(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  iso_week text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  doors_this_week integer NOT NULL DEFAULT 0,
  conversations_this_week integer NOT NULL DEFAULT 0,
  appointments_this_week integer NOT NULL DEFAULT 0,
  next_week_goal integer NOT NULL DEFAULT 0,
  card_path text,
  card_public_url text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accountability_posts_week_unique UNIQUE (user_id, challenge_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_accountability_posts_challenge_week
  ON public.accountability_posts(challenge_id, week_start DESC);

ALTER TABLE public.accountability_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accountability_posts_select_own" ON public.accountability_posts;
CREATE POLICY "accountability_posts_select_own"
  ON public.accountability_posts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "accountability_posts_update_own" ON public.accountability_posts;
CREATE POLICY "accountability_posts_update_own"
  ON public.accountability_posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "accountability_posts_all_service" ON public.accountability_posts;
CREATE POLICY "accountability_posts_all_service"
  ON public.accountability_posts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at_now()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS challenge_badges_set_updated_at ON public.challenge_badges;
CREATE TRIGGER challenge_badges_set_updated_at
BEFORE UPDATE ON public.challenge_badges
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

DROP TRIGGER IF EXISTS accountability_posts_set_updated_at ON public.accountability_posts;
CREATE TRIGGER accountability_posts_set_updated_at
BEFORE UPDATE ON public.accountability_posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

CREATE OR REPLACE VIEW public.challenge_rolling_participants AS
WITH active_templates AS (
  SELECT
    ct.id AS challenge_id,
    ct.slug AS challenge_slug,
    ct.duration_days
  FROM public.challenge_templates ct
  WHERE ct.scope = 'global'
    AND ct.type = 'rolling_onboarding'
    AND ct.status = 'active'
),
eligible_users AS (
  SELECT DISTINCT
    u.id AS user_id,
    u.created_at AS joined_at,
    COALESCE(NULLIF(u.raw_user_meta_data->>'timezone', ''), 'America/Toronto') AS timezone
  FROM auth.users u
  WHERE EXISTS (
    SELECT 1 FROM public.workspace_members wm WHERE wm.user_id = u.id
  )
  OR EXISTS (
    SELECT 1 FROM public.sessions s WHERE s.user_id = u.id AND s.end_time IS NOT NULL
  )
)
SELECT
  t.challenge_id,
  t.challenge_slug,
  e.user_id,
  e.joined_at,
  e.timezone,
  e.joined_at + make_interval(days => t.duration_days) AS window_end
FROM active_templates t
JOIN eligible_users e
  ON e.joined_at + make_interval(days => t.duration_days) > now() - interval '800 days';

COMMENT ON VIEW public.challenge_rolling_participants IS
  'Current rolling participant cohort for active onboarding challenges. joined_at is auth.users.created_at in the existing First 30 Days system.';

CREATE OR REPLACE VIEW public.challenge_user_current_streaks AS
WITH active_days AS (
  SELECT
    p.challenge_id,
    p.user_id,
    p.timezone,
    ((s.start_time AT TIME ZONE p.timezone)::date) AS active_day
  FROM public.challenge_rolling_participants p
  JOIN public.sessions s
    ON s.user_id = p.user_id
  WHERE s.end_time IS NOT NULL
    AND COALESCE(s.doors_hit, s.flyers_delivered, s.completed_count, 0) > 0
    AND s.start_time >= p.joined_at
    AND s.start_time < LEAST(p.window_end, now())
  GROUP BY 1, 2, 3, 4
),
anchors AS (
  SELECT
    p.challenge_id,
    p.user_id,
    p.timezone,
    EXISTS (
      SELECT 1
      FROM active_days ad
      WHERE ad.challenge_id = p.challenge_id
        AND ad.user_id = p.user_id
        AND ad.active_day = (now() AT TIME ZONE p.timezone)::date
    ) AS has_activity_today,
    EXISTS (
      SELECT 1
      FROM active_days ad
      WHERE ad.challenge_id = p.challenge_id
        AND ad.user_id = p.user_id
        AND ad.active_day = ((now() AT TIME ZONE p.timezone)::date - 1)
    ) AS had_activity_yesterday
  FROM public.challenge_rolling_participants p
),
ranked_days AS (
  SELECT
    a.challenge_id,
    a.user_id,
    a.has_activity_today,
    a.had_activity_yesterday,
    CASE
      WHEN a.has_activity_today THEN (now() AT TIME ZONE a.timezone)::date
      WHEN a.had_activity_yesterday THEN ((now() AT TIME ZONE a.timezone)::date - 1)
      ELSE NULL
    END AS anchor_day,
    ad.active_day,
    row_number() OVER (
      PARTITION BY a.challenge_id, a.user_id
      ORDER BY ad.active_day DESC
    ) AS day_rank
  FROM anchors a
  LEFT JOIN active_days ad
    ON ad.challenge_id = a.challenge_id
   AND ad.user_id = a.user_id
),
streaks AS (
  SELECT
    rd.challenge_id,
    rd.user_id,
    rd.has_activity_today,
    rd.had_activity_yesterday,
    COALESCE(
      COUNT(*) FILTER (
        WHERE rd.anchor_day IS NOT NULL
          AND rd.active_day = (rd.anchor_day - (rd.day_rank - 1))
      ),
      0
    )::integer AS current_streak
  FROM ranked_days rd
  GROUP BY 1, 2, 3, 4
)
SELECT
  s.challenge_id,
  s.user_id,
  s.current_streak,
  s.has_activity_today,
  s.had_activity_yesterday
FROM streaks s;

COMMENT ON VIEW public.challenge_user_current_streaks IS
  'Current consecutive active-day streak for rolling challenge participants, anchored to today or yesterday in the participant timezone.';

CREATE OR REPLACE FUNCTION public.get_challenge_rolling_leaderboard(
  p_challenge_slug text,
  p_window text,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  score bigint,
  rank bigint,
  active_badges text[],
  current_streak integer,
  accountability_posted boolean,
  latest_session_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge_id uuid;
BEGIN
  SELECT ct.id INTO v_challenge_id
  FROM public.challenge_templates ct
  WHERE ct.slug = p_challenge_slug
    AND ct.scope = 'global'
    AND ct.type = 'rolling_onboarding'
    AND ct.status = 'active'
  LIMIT 1;

  IF v_challenge_id IS NULL THEN
    RETURN;
  END IF;

  IF p_window = 'challenge_window' THEN
    RETURN QUERY
    WITH parts AS (
      SELECT
        p.challenge_id,
        p.user_id,
        p.joined_at,
        p.window_end
      FROM public.challenge_rolling_participants p
      WHERE p.challenge_id = v_challenge_id
    ),
    agg AS (
      SELECT
        s.user_id AS uid,
        SUM(COALESCE(s.doors_hit, s.flyers_delivered, 0))::bigint AS sc
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= p.joined_at
        AND s.start_time < LEAST(p.window_end, now())
      GROUP BY s.user_id
    ),
    latest_sessions AS (
      SELECT DISTINCT ON (s.user_id)
        s.user_id,
        s.id
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= p.joined_at
        AND s.start_time < LEAST(p.window_end, now())
      ORDER BY s.user_id, s.end_time DESC NULLS LAST, s.start_time DESC, s.id DESC
    ),
    posted AS (
      SELECT ap.user_id, true AS posted
      FROM public.accountability_posts ap
      WHERE ap.challenge_id = v_challenge_id
        AND ap.week_start = date_trunc('week', now())::date
        AND ap.shared_at IS NOT NULL
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
        ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.joined_at ASC
      )::bigint AS rank,
      COALESCE((
        SELECT array_agg(cb.badge_id ORDER BY cb.badge_id)
        FROM public.challenge_badges cb
        WHERE cb.challenge_id = v_challenge_id
          AND cb.user_id = p.user_id
          AND cb.is_active = true
      ), ARRAY[]::text[]) AS active_badges,
      COALESCE(st.current_streak, 0) AS current_streak,
      COALESCE(po.posted, false) AS accountability_posted,
      ls.id AS latest_session_id
    FROM parts p
    LEFT JOIN agg a ON a.uid = p.user_id
    LEFT JOIN public.user_profiles pr ON pr.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    LEFT JOIN public.challenge_user_current_streaks st
      ON st.challenge_id = v_challenge_id AND st.user_id = p.user_id
    LEFT JOIN posted po ON po.user_id = p.user_id
    LEFT JOIN latest_sessions ls ON ls.user_id = p.user_id
    ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.joined_at ASC
    LIMIT p_limit;

    RETURN;
  END IF;

  IF p_window = 'last_30_days' THEN
    RETURN QUERY
    WITH parts AS (
      SELECT
        p.challenge_id,
        p.user_id,
        p.joined_at,
        p.window_end
      FROM public.challenge_rolling_participants p
      WHERE p.challenge_id = v_challenge_id
    ),
    cutoff AS (
      SELECT (now() - interval '30 days') AS ts
    ),
    agg AS (
      SELECT
        s.user_id AS uid,
        SUM(COALESCE(s.doors_hit, s.flyers_delivered, 0))::bigint AS sc
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      CROSS JOIN cutoff c
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= GREATEST(p.joined_at, c.ts)
        AND s.start_time < LEAST(p.window_end, now())
      GROUP BY s.user_id
    ),
    latest_sessions AS (
      SELECT DISTINCT ON (s.user_id)
        s.user_id,
        s.id
      FROM public.sessions s
      INNER JOIN parts p ON p.user_id = s.user_id
      CROSS JOIN cutoff c
      WHERE s.end_time IS NOT NULL
        AND s.start_time >= GREATEST(p.joined_at, c.ts)
        AND s.start_time < LEAST(p.window_end, now())
      ORDER BY s.user_id, s.end_time DESC NULLS LAST, s.start_time DESC, s.id DESC
    ),
    posted AS (
      SELECT ap.user_id, true AS posted
      FROM public.accountability_posts ap
      WHERE ap.challenge_id = v_challenge_id
        AND ap.week_start = date_trunc('week', now())::date
        AND ap.shared_at IS NOT NULL
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
        ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.joined_at ASC
      )::bigint AS rank,
      COALESCE((
        SELECT array_agg(cb.badge_id ORDER BY cb.badge_id)
        FROM public.challenge_badges cb
        WHERE cb.challenge_id = v_challenge_id
          AND cb.user_id = p.user_id
          AND cb.is_active = true
      ), ARRAY[]::text[]) AS active_badges,
      COALESCE(st.current_streak, 0) AS current_streak,
      COALESCE(po.posted, false) AS accountability_posted,
      ls.id AS latest_session_id
    FROM parts p
    LEFT JOIN agg a ON a.uid = p.user_id
    LEFT JOIN public.user_profiles pr ON pr.user_id = p.user_id
    LEFT JOIN auth.users au ON au.id = p.user_id
    LEFT JOIN public.challenge_user_current_streaks st
      ON st.challenge_id = v_challenge_id AND st.user_id = p.user_id
    LEFT JOIN posted po ON po.user_id = p.user_id
    LEFT JOIN latest_sessions ls ON ls.user_id = p.user_id
    ORDER BY COALESCE(a.sc, 0::bigint) DESC, p.joined_at ASC
    LIMIT p_limit;

    RETURN;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.get_challenge_rolling_leaderboard(text, text, integer) IS
  'Rolling First 30 Days leaderboard with badges, streaks, accountability-post indicator, and latest session id for share cards.';

COMMIT;
