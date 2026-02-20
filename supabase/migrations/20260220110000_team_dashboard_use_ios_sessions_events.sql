-- Team dashboard migration: switch canonical reads to public.sessions + public.session_events.
-- Keep legacy field_sessions/activity_events tables untouched (no reads/writes in app paths).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) sessions.workspace_id (workspace-scoped team reporting)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE public.sessions
      ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'campaign_id'
    ) THEN
      UPDATE public.sessions s
      SET workspace_id = c.workspace_id
      FROM public.campaigns c
      WHERE s.campaign_id = c.id
        AND s.workspace_id IS NULL
        AND c.workspace_id IS NOT NULL;
    END IF;

    UPDATE public.sessions s
    SET workspace_id = (
      SELECT wm.workspace_id
      FROM public.workspace_members wm
      WHERE wm.user_id = s.user_id
      ORDER BY wm.created_at ASC
      LIMIT 1
    )
    WHERE s.workspace_id IS NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) workspace_members.color
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_members_color_hex_check'
      AND conrelid = 'public.workspace_members'::regclass
  ) THEN
    ALTER TABLE public.workspace_members
      ADD CONSTRAINT workspace_members_color_hex_check
      CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) session_events.workspace_id + backfill
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.session_events') IS NOT NULL THEN
    ALTER TABLE public.session_events
      ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'session_id'
    ) THEN
      UPDATE public.session_events se
      SET workspace_id = s.workspace_id
      FROM public.sessions s
      WHERE se.session_id = s.id
        AND se.workspace_id IS NULL
        AND s.workspace_id IS NOT NULL;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'campaign_id'
    ) THEN
      UPDATE public.session_events se
      SET workspace_id = c.workspace_id
      FROM public.campaigns c
      WHERE se.campaign_id = c.id
        AND se.workspace_id IS NULL
        AND c.workspace_id IS NOT NULL;
    END IF;

    UPDATE public.session_events se
    SET workspace_id = (
      SELECT wm.workspace_id
      FROM public.workspace_members wm
      WHERE wm.user_id = se.user_id
      ORDER BY wm.created_at ASC
      LIMIT 1
    )
    WHERE se.workspace_id IS NULL;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Indexes for team dashboard reads
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_start_time
      ON public.sessions(workspace_id, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_user_start_time
      ON public.sessions(workspace_id, user_id, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace_end_time
      ON public.sessions(workspace_id, end_time DESC);
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.session_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_session_events_workspace_event_time
      ON public.session_events(workspace_id, event_time DESC);
    CREATE INDEX IF NOT EXISTS idx_session_events_workspace_user_event_time
      ON public.session_events(workspace_id, user_id, event_time DESC);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5) RLS policies for sessions/session_events (workspace-aware)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "sessions_owner_admin_read_all" ON public.sessions;
    CREATE POLICY "sessions_owner_admin_read_all"
      ON public.sessions FOR SELECT
      USING (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND public.is_workspace_owner_or_admin(workspace_id)
      );

    DROP POLICY IF EXISTS "sessions_member_read_own" ON public.sessions;
    CREATE POLICY "sessions_member_read_own"
      ON public.sessions FOR SELECT
      USING (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      );

    DROP POLICY IF EXISTS "sessions_member_insert_own" ON public.sessions;
    CREATE POLICY "sessions_member_insert_own"
      ON public.sessions FOR INSERT
      WITH CHECK (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      );

    DROP POLICY IF EXISTS "sessions_member_update_own" ON public.sessions;
    CREATE POLICY "sessions_member_update_own"
      ON public.sessions FOR UPDATE
      USING (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      )
      WITH CHECK (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.session_events') IS NOT NULL THEN
    ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "session_events_owner_admin_read_all" ON public.session_events;
    CREATE POLICY "session_events_owner_admin_read_all"
      ON public.session_events FOR SELECT
      USING (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND public.is_workspace_owner_or_admin(workspace_id)
      );

    DROP POLICY IF EXISTS "session_events_member_read_own" ON public.session_events;
    CREATE POLICY "session_events_member_read_own"
      ON public.session_events FOR SELECT
      USING (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      );

    DROP POLICY IF EXISTS "session_events_member_insert_own" ON public.session_events;
    CREATE POLICY "session_events_member_insert_own"
      ON public.session_events FOR INSERT
      WITH CHECK (
        workspace_id = ANY(public.current_user_workspace_ids())
        AND user_id = auth.uid()
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 6) Team RPCs switched to sessions/session_events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_map_data(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_mode text DEFAULT 'routes',
  p_limit_sessions integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members jsonb;
  v_sessions jsonb;
  v_knock_points jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.display_name), '[]'::jsonb) INTO v_members
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
    ORDER BY 2
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.start_time DESC), '[]'::jsonb) INTO v_sessions
  FROM (
    SELECT
      ss.id AS session_id,
      ss.user_id,
      ss.start_time AS started_at,
      ss.end_time AS ended_at,
      COALESCE(ss.active_seconds, 0)::int AS duration_seconds,
      COALESCE(ss.distance_meters, 0)::int AS distance_meters,
      COALESCE(ss.doors_hit, 0)::int AS doors_hit,
      COALESCE(ss.conversations, 0)::int AS conversations,
      COALESCE(ss.flyers_delivered, 0)::int AS flyers_delivered,
      ss.path_geojson
    FROM public.sessions ss
    WHERE ss.workspace_id = p_workspace_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
    ORDER BY ss.start_time DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit_sessions, 500), 1), 2000)
  ) s;

  SELECT COALESCE(jsonb_agg(row_to_json(k)::jsonb ORDER BY k.event_time DESC), '[]'::jsonb) INTO v_knock_points
  FROM (
    SELECT
      se.id,
      se.user_id,
      se.event_time,
      se.event_type,
      se.payload,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name
    FROM public.session_events se
    LEFT JOIN auth.users u ON u.id = se.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = se.user_id
    WHERE se.workspace_id = p_workspace_id
      AND se.event_time >= p_start_ts
      AND se.event_time <= p_end_ts
      AND se.event_type = 'knock'
      AND jsonb_typeof(se.payload) = 'object'
      AND (se.payload ? 'lat')
      AND (se.payload ? 'lng')
    ORDER BY se.event_time DESC
  ) k;

  RETURN jsonb_build_object(
    'members', COALESCE(v_members, '[]'::jsonb),
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'knockPoints', COALESCE(v_knock_points, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_activity_feed(
  p_workspace_id uuid,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_type_filter text DEFAULT NULL,
  p_limit_count integer DEFAULT 50,
  p_offset_count integer DEFAULT 0,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.session_events se
  WHERE se.workspace_id = p_workspace_id
    AND se.event_time >= p_start_ts
    AND se.event_time <= p_end_ts
    AND (p_type_filter IS NULL OR se.event_type = p_type_filter)
    AND (p_user_id IS NULL OR se.user_id = p_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      se.id,
      se.user_id,
      se.event_type,
      se.event_time,
      NULL::uuid AS ref_id,
      se.payload,
      se.created_at,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name
    FROM public.session_events se
    LEFT JOIN auth.users u ON u.id = se.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = se.user_id
    WHERE se.workspace_id = p_workspace_id
      AND se.event_time >= p_start_ts
      AND se.event_time <= p_end_ts
      AND (p_type_filter IS NULL OR se.event_type = p_type_filter)
      AND (p_user_id IS NULL OR se.user_id = p_user_id)
    ORDER BY se.event_time DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit_count, 50), 1), 500)
    OFFSET GREATEST(COALESCE(p_offset_count, 0), 0)
  ) t;

  -- Fallback to synthetic "session_completed" feed from sessions when no session_events are present.
  IF v_total = 0 AND (p_type_filter IS NULL OR p_type_filter = 'session_completed') THEN
    SELECT COUNT(*) INTO v_total
    FROM public.sessions ss
    WHERE ss.workspace_id = p_workspace_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
      AND (p_user_id IS NULL OR ss.user_id = p_user_id);

    SELECT COALESCE(jsonb_agg(row_to_json(t2)::jsonb), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT
        ss.id,
        ss.user_id,
        'session_completed'::text AS event_type,
        COALESCE(ss.end_time, ss.start_time) AS event_time,
        ss.id AS ref_id,
        jsonb_build_object(
          'doors_hit', COALESCE(ss.doors_hit, 0),
          'conversations', COALESCE(ss.conversations, 0),
          'flyers_delivered', COALESCE(ss.flyers_delivered, 0),
          'active_seconds', COALESCE(ss.active_seconds, 0),
          'distance_meters', COALESCE(ss.distance_meters, 0)
        ) AS payload,
        ss.created_at,
        COALESCE(
          trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
          u.raw_user_meta_data->>'full_name',
          split_part(u.email, '@', 1),
          'Member'
        ) AS display_name
      FROM public.sessions ss
      LEFT JOIN auth.users u ON u.id = ss.user_id
      LEFT JOIN public.user_profiles up ON up.user_id = ss.user_id
      WHERE ss.workspace_id = p_workspace_id
        AND ss.start_time >= p_start_ts
        AND ss.start_time <= p_end_ts
        AND (p_user_id IS NULL OR ss.user_id = p_user_id)
      ORDER BY COALESCE(ss.end_time, ss.start_time) DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit_count, 50), 1), 500)
      OFFSET GREATEST(COALESCE(p_offset_count, 0), 0)
    ) t2;
  END IF;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', COALESCE(v_total, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_leaderboard(
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
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color,
      COALESCE(SUM(ss.doors_hit), 0)::int AS doors_knocked,
      COALESCE(SUM(ss.conversations), 0)::int AS conversations,
      COALESCE(SUM(ss.flyers_delivered), 0)::int AS flyers_delivered,
      COUNT(ss.id)::int AS sessions_count,
      COUNT(DISTINCT date_trunc('day', ss.start_time)::date)::int AS active_days,
      COALESCE(SUM(ss.active_seconds), 0)::int AS total_duration_seconds,
      COALESCE(SUM(ss.distance_meters), 0)::int AS distance_meters,
      MAX(ss.start_time) AS last_active_at
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    LEFT JOIN public.sessions ss
      ON ss.workspace_id = wm.workspace_id
      AND ss.user_id = wm.user_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
    WHERE wm.workspace_id = p_workspace_id
    GROUP BY wm.user_id, wm.color, up.first_name, up.last_name, u.raw_user_meta_data, u.email
    ORDER BY COALESCE(SUM(ss.doors_hit), 0) DESC, COALESCE(SUM(ss.conversations), 0) DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_report(
  p_workspace_id uuid,
  p_user_id uuid,
  p_period text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_end timestamptz := now();
  v_knocks int := 0;
  v_convos int := 0;
  v_flyers int := 0;
  v_sessions_count int := 0;
  v_active_days int := 0;
  v_buckets jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_start := CASE p_period
    WHEN 'weekly'  THEN date_trunc('week', v_end)
    WHEN 'monthly' THEN date_trunc('month', v_end)
    WHEN 'yearly'  THEN date_trunc('year', v_end)
    ELSE date_trunc('week', v_end)
  END;

  SELECT
    COALESCE(SUM(ss.doors_hit), 0)::int,
    COALESCE(SUM(ss.conversations), 0)::int,
    COALESCE(SUM(ss.flyers_delivered), 0)::int,
    COUNT(ss.id)::int,
    COUNT(DISTINCT date_trunc('day', ss.start_time)::date)::int
  INTO v_knocks, v_convos, v_flyers, v_sessions_count, v_active_days
  FROM public.sessions ss
  WHERE ss.workspace_id = p_workspace_id
    AND ss.user_id = p_user_id
    AND ss.start_time >= v_start
    AND ss.start_time <= v_end;

  SELECT COALESCE(jsonb_agg(row_to_json(b)::jsonb ORDER BY b.bucket_start), '[]'::jsonb) INTO v_buckets
  FROM (
    SELECT
      CASE
        WHEN p_period = 'yearly' THEN date_trunc('month', ss.start_time)::date
        ELSE date_trunc('day', ss.start_time)::date
      END AS bucket_start,
      COALESCE(SUM(ss.doors_hit), 0)::int AS doors,
      COALESCE(SUM(ss.conversations), 0)::int AS conversations,
      COALESCE(SUM(ss.flyers_delivered), 0)::int AS flyers_delivered,
      COUNT(ss.id)::int AS sessions_count
    FROM public.sessions ss
    WHERE ss.workspace_id = p_workspace_id
      AND ss.user_id = p_user_id
      AND ss.start_time >= v_start
      AND ss.start_time <= v_end
    GROUP BY 1
  ) b;

  RETURN jsonb_build_object(
    'knocks', v_knocks,
    'conversations', v_convos,
    'flyers_delivered', v_flyers,
    'sessions_count', v_sessions_count,
    'active_days', v_active_days,
    'avg_knocks_per_session', CASE WHEN v_sessions_count > 0 THEN round(v_knocks::numeric / v_sessions_count, 1) ELSE 0 END,
    'period_start', v_start,
    'period_end', v_end,
    'buckets', COALESCE(v_buckets, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_members_with_stats(
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
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(
    jsonb_agg(row_to_json(t)::jsonb ORDER BY t.doors_knocked DESC, t.last_active_at DESC NULLS LAST),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT
      wm.user_id,
      wm.role,
      COALESCE(wm.color, '#3B82F6') AS color,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      MAX(ss.start_time) AS last_active_at,
      COALESCE(SUM(ss.doors_hit), 0)::int AS doors_knocked,
      COALESCE(SUM(ss.conversations), 0)::int AS conversations,
      COALESCE(SUM(ss.flyers_delivered), 0)::int AS flyers_delivered,
      COUNT(ss.id)::int AS sessions_count,
      COUNT(DISTINCT date_trunc('day', ss.start_time)::date)::int AS active_days
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    LEFT JOIN public.sessions ss
      ON ss.workspace_id = wm.workspace_id
      AND ss.user_id = wm.user_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
    WHERE wm.workspace_id = p_workspace_id
    GROUP BY wm.user_id, wm.role, wm.color, up.first_name, up.last_name, u.raw_user_meta_data, u.email
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

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
  v_cur_flyers int := 0;
  v_cur_sessions int := 0;
  v_cur_duration int := 0;
  v_prev_doors int := 0;
  v_prev_convos int := 0;
  v_prev_flyers int := 0;
  v_prev_sessions int := 0;
  v_prev_duration int := 0;
  v_doors_by_day jsonb;
  v_interval interval;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_interval := p_end_ts - p_start_ts;
  v_prev_end := p_start_ts;
  v_prev_start := p_start_ts - v_interval;

  SELECT
    COALESCE(SUM(ss.doors_hit), 0)::int,
    COALESCE(SUM(ss.conversations), 0)::int,
    COALESCE(SUM(ss.flyers_delivered), 0)::int,
    COUNT(ss.id)::int,
    COALESCE(SUM(ss.active_seconds), 0)::int
  INTO v_cur_doors, v_cur_convos, v_cur_flyers, v_cur_sessions, v_cur_duration
  FROM public.sessions ss
  WHERE ss.workspace_id = p_workspace_id
    AND ss.start_time >= p_start_ts
    AND ss.start_time <= p_end_ts;

  SELECT
    COALESCE(SUM(ss.doors_hit), 0)::int,
    COALESCE(SUM(ss.conversations), 0)::int,
    COALESCE(SUM(ss.flyers_delivered), 0)::int,
    COUNT(ss.id)::int,
    COALESCE(SUM(ss.active_seconds), 0)::int
  INTO v_prev_doors, v_prev_convos, v_prev_flyers, v_prev_sessions, v_prev_duration
  FROM public.sessions ss
  WHERE ss.workspace_id = p_workspace_id
    AND ss.start_time >= v_prev_start
    AND ss.start_time < v_prev_end;

  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.day_date), '[]'::jsonb) INTO v_doors_by_day
  FROM (
    SELECT
      date_trunc('day', ss.start_time)::date AS day_date,
      COALESCE(SUM(ss.doors_hit), 0)::int AS doors
    FROM public.sessions ss
    WHERE ss.workspace_id = p_workspace_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
    GROUP BY date_trunc('day', ss.start_time)::date
  ) d;

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'doors', v_cur_doors,
      'convos', v_cur_convos,
      'flyers', v_cur_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_cur_sessions,
      'total_duration_seconds', v_cur_duration
    ),
    'previousTotals', jsonb_build_object(
      'doors', v_prev_doors,
      'convos', v_prev_convos,
      'flyers', v_prev_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_prev_sessions,
      'total_duration_seconds', v_prev_duration
    ),
    'deltas', jsonb_build_object(
      'doors', v_cur_doors - v_prev_doors,
      'convos', v_cur_convos - v_prev_convos,
      'flyers', v_cur_flyers - v_prev_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_cur_sessions - v_prev_sessions,
      'total_duration_seconds', v_cur_duration - v_prev_duration
    ),
    'doorsByDay', COALESCE(v_doors_by_day, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_map_data(uuid, timestamptz, timestamptz, text, integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_activity_feed(uuid, timestamptz, timestamptz, text, integer, integer, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_leaderboard(uuid, timestamptz, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_agent_report(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agent_report(uuid, uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_team_members_with_stats(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_members_with_stats(uuid, timestamptz, timestamptz) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_dashboard_summary(uuid, timestamptz, timestamptz) TO service_role;

COMMIT;
