BEGIN;

-- Canonical cross-platform campaign collaboration contract.
-- New backend migrations live in Wolfgrid-WEB/supabase/migrations only.

-- ---------------------------------------------------------------------------
-- Current-state metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.campaign_addresses
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_platform text,
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.campaign_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_client_mutation_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Historical field pins predate actor metadata. Attribute them conservatively to
-- the campaign owner so every live pin has a stable owner/display baseline.
UPDATE public.campaign_addresses ca
SET created_by = coalesce(ca.created_by, c.owner_id),
    updated_by = coalesce(ca.updated_by, ca.created_by, c.owner_id),
    origin_platform = coalesce(ca.origin_platform, 'legacy'),
    revision = greatest(ca.revision, 1)
FROM public.campaigns c
WHERE c.id = ca.campaign_id
  AND ca.match_source = 'field_manual_pin'
  AND (
    ca.created_by IS NULL
    OR ca.updated_by IS NULL
    OR ca.origin_platform IS NULL
    OR ca.revision < 1
  );

ALTER TABLE public.address_statuses
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS last_action_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_home_event_id uuid,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_mutation_id text;

UPDATE public.address_statuses ast
SET campaign_id = ca.campaign_id
FROM public.campaign_addresses ca
WHERE ca.id = ast.campaign_address_id
  AND ast.campaign_id IS NULL;

ALTER TABLE public.address_statuses
  ALTER COLUMN campaign_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_live
  ON public.campaign_addresses(campaign_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_assignment_live
  ON public.campaign_addresses(assignment_id, updated_at DESC)
  WHERE assignment_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_address_statuses_campaign_revision
  ON public.address_statuses(campaign_id, revision DESC);

-- ---------------------------------------------------------------------------
-- Audit events and bounded replay receipts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.campaign_home_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_home_events
  ADD COLUMN IF NOT EXISTS client_mutation_id text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS origin_platform text,
  ADD COLUMN IF NOT EXISTS client_version text,
  ADD COLUMN IF NOT EXISTS client_build integer,
  ADD COLUMN IF NOT EXISTS base_revision bigint,
  ADD COLUMN IF NOT EXISTS result_revision bigint,
  ADD COLUMN IF NOT EXISTS applied_to_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_state jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'address_statuses_last_home_event_id_fkey'
  ) THEN
    ALTER TABLE public.address_statuses
      ADD CONSTRAINT address_statuses_last_home_event_id_fkey
      FOREIGN KEY (last_home_event_id)
      REFERENCES public.campaign_home_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_home_events_permanent_mutation
  ON public.campaign_home_events(user_id, client_mutation_id, campaign_address_id, action_type)
  WHERE client_mutation_id IS NOT NULL AND client_mutation_id <> '';

CREATE INDEX IF NOT EXISTS idx_campaign_home_events_mutation_lookup
  ON public.campaign_home_events(user_id, client_mutation_id, created_at DESC)
  WHERE client_mutation_id IS NOT NULL AND client_mutation_id <> '';

CREATE TABLE IF NOT EXISTS public.campaign_mutation_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_mutation_id text NOT NULL,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  operation text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  PRIMARY KEY (user_id, client_mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_mutation_receipts_expiry
  ON public.campaign_mutation_receipts(expires_at);

ALTER TABLE public.campaign_mutation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_mutation_receipts FROM anon, authenticated;
GRANT ALL ON public.campaign_mutation_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_expired_campaign_mutation_receipts(
  p_limit integer DEFAULT 10000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH expired AS (
    SELECT user_id, client_mutation_id
    FROM public.campaign_mutation_receipts
    WHERE expires_at <= now()
    ORDER BY expires_at
    LIMIT greatest(1, least(coalesce(p_limit, 10000), 50000))
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.campaign_mutation_receipts r
  USING expired e
  WHERE r.user_id = e.user_id
    AND r.client_mutation_id = e.client_mutation_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_campaign_mutation_receipts(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_campaign_mutation_receipts(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Mobile rollout policy and adoption observations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mobile_client_policies (
  platform text PRIMARY KEY CHECK (platform IN ('ios', 'android', 'legacy')),
  minimum_campaign_mutation_build integer,
  candidate_available_at timestamptz,
  enforce_after timestamptz,
  store_url text,
  warning_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_client_build_observations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  client_version text,
  client_build integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_mutated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

ALTER TABLE public.mobile_client_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_client_build_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobile_client_policies_read ON public.mobile_client_policies;
CREATE POLICY mobile_client_policies_read
  ON public.mobile_client_policies FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.campaign_client_build_observations FROM anon, authenticated;
GRANT SELECT ON public.mobile_client_policies TO authenticated;
GRANT ALL ON public.mobile_client_policies, public.campaign_client_build_observations TO service_role;

INSERT INTO public.mobile_client_policies(platform)
VALUES ('ios'), ('android'), ('legacy')
ON CONFLICT (platform) DO NOTHING;

CREATE OR REPLACE FUNCTION public.observe_campaign_client_build(
  p_platform text,
  p_client_version text,
  p_client_build integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_platform text := lower(trim(coalesce(p_platform, '')));
BEGIN
  IF v_actor IS NULL OR v_platform NOT IN ('ios', 'android', 'web') THEN
    RETURN;
  END IF;

  INSERT INTO public.campaign_client_build_observations(
    user_id, platform, client_version, client_build, first_seen_at, last_seen_at, last_mutated_at
  ) VALUES (
    v_actor, v_platform, nullif(trim(coalesce(p_client_version, '')), ''), p_client_build,
    now(), now(), now()
  )
  ON CONFLICT (user_id, platform) DO UPDATE SET
    client_version = excluded.client_version,
    client_build = excluded.client_build,
    last_seen_at = now(),
    last_mutated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_client_mutation_allowed(
  p_platform text,
  p_client_build integer
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_minimum integer;
  v_enforce_after timestamptz;
BEGIN
  IF v_platform = 'legacy' THEN
    RETURN coalesce(
      (SELECT enforce_after IS NULL OR enforce_after > now()
       FROM public.mobile_client_policies WHERE platform = 'legacy'),
      true
    );
  END IF;

  IF v_platform NOT IN ('ios', 'android') THEN
    RETURN true;
  END IF;

  SELECT minimum_campaign_mutation_build, enforce_after
  INTO v_minimum, v_enforce_after
  FROM public.mobile_client_policies
  WHERE platform = v_platform;

  IF NOT FOUND OR v_enforce_after IS NULL OR v_enforce_after > now() OR v_minimum IS NULL THEN
    RETURN true;
  END IF;

  RETURN coalesce(p_client_build, -1) >= v_minimum;
END;
$$;

CREATE OR REPLACE FUNCTION public.legacy_campaign_mutations_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT enforce_after IS NULL OR enforce_after > now()
     FROM public.mobile_client_policies WHERE platform = 'legacy'),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.observe_campaign_client_build(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_client_mutation_allowed(text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- One campaign access vocabulary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_campaign(
  p_campaign_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND (
        c.owner_id = p_user_id
        OR (
          c.workspace_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = c.workspace_id AND w.owner_id = p_user_id
          )
        )
        OR (
          c.workspace_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = c.workspace_id
              AND wm.user_id = p_user_id
              AND lower(wm.role) IN ('owner', 'admin')
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_campaign(
  p_campaign_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_campaign(p_campaign_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.campaign_assignments ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.assigned_to_user_id = p_user_id
        AND ca.status IN ('accepted', 'in_progress', 'completed')
    );
$$;

CREATE OR REPLACE FUNCTION public.can_mutate_campaign_address(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_campaign(p_campaign_id, p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.campaign_assignments ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.assigned_to_user_id = p_user_id
        AND ca.status IN ('accepted', 'in_progress')
        AND (
          ca.mode = 'whole_team'
          OR (
            ca.mode = 'zone_split'
            AND EXISTS (
              SELECT 1
              FROM public.campaign_assignment_homes cah
              WHERE cah.assignment_id = ca.id
                AND cah.campaign_address_id = p_campaign_address_id
            )
          )
        )
    );
$$;

-- Existing callers keep working, but no longer gain access merely by sharing a workspace.
CREATE OR REPLACE FUNCTION public.is_campaign_member(
  p_campaign_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_campaign(p_campaign_id, p_user_id);
$$;

DROP TRIGGER IF EXISTS sync_campaign_members_from_campaign ON public.campaigns;
DROP TRIGGER IF EXISTS sync_campaign_members_from_workspace_member ON public.workspace_members;

GRANT EXECUTE ON FUNCTION public.can_manage_campaign(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_campaign(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_mutate_campaign_address(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_campaign_member(uuid, uuid) TO authenticated, service_role;

-- Replace permissive OR-combined policies with the canonical predicates.
DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('campaign_addresses', 'address_statuses', 'campaign_home_events')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  END LOOP;
END $$;

ALTER TABLE public.campaign_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.address_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_home_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_addresses_view_v2
  ON public.campaign_addresses FOR SELECT TO authenticated
  USING (public.can_view_campaign(campaign_id));

CREATE POLICY campaign_addresses_insert_v2
  ON public.campaign_addresses FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_campaign(campaign_id));

CREATE POLICY campaign_addresses_update_v2
  ON public.campaign_addresses FOR UPDATE TO authenticated
  USING (public.can_mutate_campaign_address(campaign_id, id))
  WITH CHECK (public.can_mutate_campaign_address(campaign_id, id));

CREATE POLICY campaign_addresses_delete_v2
  ON public.campaign_addresses FOR DELETE TO authenticated
  USING (public.can_mutate_campaign_address(campaign_id, id));

CREATE POLICY address_statuses_view_v2
  ON public.address_statuses FOR SELECT TO authenticated
  USING (public.can_view_campaign(campaign_id));

CREATE POLICY address_statuses_insert_v2
  ON public.address_statuses FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_campaign_address(campaign_id, campaign_address_id));

CREATE POLICY address_statuses_update_v2
  ON public.address_statuses FOR UPDATE TO authenticated
  USING (public.can_mutate_campaign_address(campaign_id, campaign_address_id))
  WITH CHECK (public.can_mutate_campaign_address(campaign_id, campaign_address_id));

CREATE POLICY address_statuses_delete_v2
  ON public.address_statuses FOR DELETE TO authenticated
  USING (public.can_mutate_campaign_address(campaign_id, campaign_address_id));

CREATE POLICY campaign_home_events_view_v2
  ON public.campaign_home_events FOR SELECT TO authenticated
  USING (public.can_view_campaign(campaign_id));

GRANT SELECT ON public.campaign_home_events TO authenticated;
GRANT ALL ON public.campaign_home_events TO service_role;

-- Campaign directory is derived from real campaign access, not all workspace members.
CREATE OR REPLACE FUNCTION public.rpc_get_campaign_member_directory(p_campaign_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT c.owner_id AS user_id, 'owner'::text AS role, c.created_at
    FROM public.campaigns c
    WHERE c.id = p_campaign_id

    UNION

    SELECT wm.user_id,
      CASE WHEN lower(wm.role) = 'owner' THEN 'owner' ELSE 'admin' END,
      wm.created_at
    FROM public.campaigns c
    JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
    WHERE c.id = p_campaign_id AND lower(wm.role) IN ('owner', 'admin')

    UNION

    SELECT ca.assigned_to_user_id, 'member'::text, ca.created_at
    FROM public.campaign_assignments ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.status IN ('accepted', 'in_progress', 'completed')
  )
  SELECT DISTINCT ON (m.user_id)
    m.user_id,
    m.role,
    COALESCE(
      NULLIF(trim(concat_ws(' ', up.first_name, up.last_name)), ''),
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(split_part(coalesce(au.email, ''), '@', 1), ''),
      left(m.user_id::text, 8)
    ) AS display_name,
    au.email,
    COALESCE(
      NULLIF(trim(up.avatar_url), ''),
      NULLIF(trim(p.avatar_url), ''),
      NULLIF(trim(au.raw_user_meta_data->>'avatar_url'), '')
    ) AS avatar_url,
    m.created_at
  FROM members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = m.user_id
  LEFT JOIN auth.users au ON au.id = m.user_id
  WHERE public.can_view_campaign(p_campaign_id)
  ORDER BY m.user_id,
    CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_member_directory(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mutation replay helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.campaign_mutation_replay(
  p_user_id uuid,
  p_client_mutation_id text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_response jsonb;
BEGIN
  SELECT request_hash, response
  INTO v_hash, v_response
  FROM public.campaign_mutation_receipts
  WHERE user_id = p_user_id
    AND client_mutation_id = p_client_mutation_id;

  IF FOUND THEN
    IF v_hash IS DISTINCT FROM p_request_hash THEN
      RETURN jsonb_build_object(
        'applied', false,
        'replayed', false,
        'error_code', 'IDEMPOTENCY_KEY_REUSED',
        'canonical_state', NULL,
        'revision', NULL,
        'event_id', NULL
      );
    END IF;
    RETURN jsonb_set(v_response, '{replayed}', 'true'::jsonb, true);
  END IF;

  SELECT request_hash, result_state
  INTO v_hash, v_response
  FROM public.campaign_home_events
  WHERE user_id = p_user_id
    AND client_mutation_id = p_client_mutation_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_hash IS DISTINCT FROM p_request_hash THEN
      RETURN jsonb_build_object(
        'applied', false,
        'replayed', false,
        'error_code', 'IDEMPOTENCY_KEY_REUSED',
        'canonical_state', NULL,
        'revision', NULL,
        'event_id', NULL
      );
    END IF;
    RETURN jsonb_set(coalesce(v_response, '{}'::jsonb), '{replayed}', 'true'::jsonb, true);
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_campaign_mutation_receipt(
  p_user_id uuid,
  p_client_mutation_id text,
  p_campaign_id uuid,
  p_operation text,
  p_request_hash text,
  p_response jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.campaign_mutation_receipts(
    user_id, client_mutation_id, campaign_id, operation, request_hash, response,
    created_at, expires_at
  ) VALUES (
    p_user_id, p_client_mutation_id, p_campaign_id, p_operation, p_request_hash,
    p_response, now(), now() + interval '90 days'
  )
  ON CONFLICT (user_id, client_mutation_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.campaign_mutation_replay(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_campaign_mutation_receipt(uuid, text, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_mutation_replay(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_campaign_mutation_receipt(uuid, text, uuid, text, text, jsonb) TO service_role;

-- Preserve the pre-v2 implementation so v2 can retain session-event and counter behavior.
DO $$
BEGIN
  IF to_regprocedure(
    'public.record_campaign_address_outcome_legacy_impl(uuid,uuid,uuid,text,text,timestamp with time zone,uuid,text,text,double precision,double precision)'
  ) IS NULL
  AND to_regprocedure(
    'public.record_campaign_address_outcome(uuid,uuid,uuid,text,text,timestamp with time zone,uuid,text,text,double precision,double precision)'
  ) IS NOT NULL THEN
    ALTER FUNCTION public.record_campaign_address_outcome(
      uuid, uuid, uuid, text, text, timestamptz, uuid, text, text, double precision, double precision
    ) RENAME TO record_campaign_address_outcome_legacy_impl;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- v2 status mutations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.v2_record_campaign_address_outcome(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL,
  p_base_revision bigint DEFAULT 0,
  p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_legacy_bridge boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_current_state jsonb;
  v_current_revision bigint := 0;
  v_current_actor uuid;
  v_current_occurred timestamptz;
  v_result_revision bigint;
  v_event_id uuid;
  v_is_manager boolean;
  v_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_applied boolean := false;
  v_error_code text;
  v_visited boolean;
  v_session_user_id uuid;
  v_session_campaign_id uuid;
  v_session_event_id uuid;
  v_session_event_building_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'AUTH_REQUIRED');
  END IF;
  IF v_mutation_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_MUTATION_ID_REQUIRED');
  END IF;
  IF v_status NOT IN ('none', 'no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead') THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'UNSUPPORTED_STATUS');
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'status',
    'campaign_id', p_campaign_id,
    'address_id', p_campaign_address_id,
    'status', v_status,
    'notes', coalesce(p_notes, ''),
    'occurred_at', p_occurred_at,
    'session_id', p_session_id,
    'session_target_id', p_session_target_id,
    'session_event_type', p_session_event_type,
    'lat', p_lat,
    'lon', p_lon,
    -- A legacy retry reconstructs the current server revision because old clients
    -- never sent one. Keep that derived value out of the idempotency hash so the
    -- stable legacy fingerprint can replay after the first write increments it.
    'base_revision', CASE WHEN p_legacy_bridge THEN NULL ELSE p_base_revision END,
    'override_reason', v_reason
  )::text);

  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF NOT public.campaign_client_mutation_allowed(v_platform, p_client_build) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
    RETURN v_response;
  END IF;
  PERFORM public.observe_campaign_client_build(v_platform, p_client_version, p_client_build);

  -- The address lock serializes both first status writes and later updates.
  PERFORM 1
  FROM public.campaign_addresses ca
  WHERE ca.id = p_campaign_address_id
    AND ca.campaign_id = p_campaign_id
    AND ca.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_mutate_campaign_address(p_campaign_id, p_campaign_address_id, v_actor) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_ACCESS_DENIED',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'status', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  SELECT to_jsonb(ast), ast.revision, ast.last_action_by, ast.source_occurred_at
  INTO v_current_state, v_current_revision, v_current_actor, v_current_occurred
  FROM public.address_statuses ast
  WHERE ast.campaign_address_id = p_campaign_address_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_current_revision := 0;
    v_current_state := jsonb_build_object(
      'campaign_address_id', p_campaign_address_id,
      'campaign_id', p_campaign_id,
      'status', 'none',
      'revision', 0
    );
  END IF;

  IF p_legacy_bridge THEN
    IF v_current_occurred IS NOT NULL AND v_current_occurred > coalesce(p_occurred_at, now()) THEN
      v_error_code := 'REVISION_CONFLICT';
    ELSE
      p_base_revision := v_current_revision;
    END IF;
  ELSIF coalesce(p_base_revision, -1) <> v_current_revision THEN
    v_error_code := 'REVISION_CONFLICT';
  END IF;

  IF v_error_code IS NOT NULL THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', v_error_code,
      'canonical_state', v_current_state, 'revision', v_current_revision, 'event_id', NULL
    );
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, session_id, action_type, note, created_at,
      client_mutation_id, request_hash, origin_platform, client_version, client_build,
      base_revision, result_revision, applied_to_current, override_reason, result_state
    ) VALUES (
      p_campaign_id, p_campaign_address_id, v_actor, p_session_id, 'status_conflict', p_notes, now(),
      v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
      p_base_revision, v_current_revision, false, v_reason, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'status', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  v_is_manager := public.can_manage_campaign(p_campaign_id, v_actor);
  IF v_current_actor IS NOT NULL AND v_current_actor <> v_actor THEN
    IF NOT v_is_manager THEN
      v_error_code := 'TEAMMATE_STATUS_LOCKED';
    ELSIF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 200 THEN
      v_error_code := 'OVERRIDE_REASON_REQUIRED';
    END IF;
  END IF;

  IF v_error_code IS NOT NULL THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', v_error_code,
      'canonical_state', v_current_state, 'revision', v_current_revision, 'event_id', NULL
    );
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, session_id, action_type, note, created_at,
      client_mutation_id, request_hash, origin_platform, client_version, client_build,
      base_revision, result_revision, applied_to_current, override_reason, result_state
    ) VALUES (
      p_campaign_id, p_campaign_address_id, v_actor, p_session_id, 'status_rejected', p_notes, now(),
      v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
      p_base_revision, v_current_revision, false, v_reason, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'status', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  v_result_revision := v_current_revision + 1;
  v_visited := v_status <> 'none';

  IF p_session_id IS NOT NULL THEN
    SELECT s.user_id, s.campaign_id
    INTO v_session_user_id, v_session_campaign_id
    FROM public.sessions s
    WHERE s.id = p_session_id;

    IF v_session_user_id IS NULL OR v_session_user_id <> v_actor THEN
      RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'SESSION_ACCESS_DENIED');
    END IF;
    IF v_session_campaign_id IS DISTINCT FROM p_campaign_id THEN
      RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'SESSION_CAMPAIGN_MISMATCH');
    END IF;
  END IF;

  INSERT INTO public.campaign_home_events(
    campaign_id, campaign_address_id, user_id, session_id, action_type, note,
    created_at, occurred_at, client_mutation_id, request_hash, origin_platform,
    client_version, client_build, base_revision, result_revision,
    applied_to_current, override_reason
  ) VALUES (
    p_campaign_id, p_campaign_address_id, v_actor, p_session_id,
    CASE
      WHEN v_current_actor IS NOT NULL AND v_current_actor <> v_actor AND v_is_manager
        THEN 'manager_override'
      ELSE v_status
    END,
    p_notes, now(), coalesce(p_occurred_at, now()), v_mutation_id, v_request_hash,
    v_platform, p_client_version, p_client_build, p_base_revision,
    v_result_revision, true, v_reason
  ) RETURNING id INTO v_event_id;

  INSERT INTO public.address_statuses(
    campaign_address_id, campaign_id, status, notes, last_visited_at, visit_count,
    last_action_by, last_session_id, last_home_event_id, revision,
    source_occurred_at, last_client_mutation_id, created_at, updated_at
  ) VALUES (
    p_campaign_address_id, p_campaign_id, v_status,
    nullif(trim(coalesce(p_notes, '')), ''),
    CASE WHEN v_visited THEN coalesce(p_occurred_at, now()) ELSE NULL END,
    CASE WHEN v_visited THEN 1 ELSE 0 END,
    v_actor, p_session_id, v_event_id, v_result_revision,
    coalesce(p_occurred_at, now()), v_mutation_id, now(), now()
  )
  ON CONFLICT (campaign_address_id) DO UPDATE SET
    campaign_id = excluded.campaign_id,
    status = excluded.status,
    notes = CASE
      WHEN excluded.status = 'none' THEN excluded.notes
      ELSE coalesce(excluded.notes, public.address_statuses.notes)
    END,
    last_visited_at = CASE
      WHEN excluded.status = 'none' THEN public.address_statuses.last_visited_at
      ELSE excluded.last_visited_at
    END,
    visit_count = CASE
      WHEN excluded.status = 'none' THEN public.address_statuses.visit_count
      ELSE public.address_statuses.visit_count + 1
    END,
    last_action_by = excluded.last_action_by,
    last_session_id = excluded.last_session_id,
    last_home_event_id = excluded.last_home_event_id,
    revision = excluded.revision,
    source_occurred_at = excluded.source_occurred_at,
    last_client_mutation_id = excluded.last_client_mutation_id,
    updated_at = now()
  RETURNING to_jsonb(address_statuses) INTO v_current_state;

  UPDATE public.campaign_addresses
  SET visited = v_visited
  WHERE id = p_campaign_address_id;

  IF p_session_id IS NOT NULL AND p_session_event_type IS NOT NULL THEN
    IF p_session_event_type NOT IN (
      'flyer_left', 'conversation', 'address_tap',
      'completed_manual', 'completed_auto', 'completion_undone'
    ) THEN
      RAISE EXCEPTION 'Unsupported session event type: %', p_session_event_type;
    END IF;

    v_session_event_building_id := NULL;
    IF nullif(trim(coalesce(p_session_target_id, '')), '') IS NOT NULL THEN
      BEGIN
        v_session_event_building_id := trim(p_session_target_id)::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_session_event_building_id := NULL;
      END;
    END IF;

    INSERT INTO public.session_events(
      session_id, building_id, address_id, event_type, created_at, lat, lon,
      event_location, metadata, user_id
    ) VALUES (
      p_session_id, v_session_event_building_id, p_campaign_address_id,
      p_session_event_type, coalesce(p_occurred_at, now()), p_lat, p_lon,
      CASE WHEN p_lon IS NOT NULL AND p_lat IS NOT NULL
        THEN st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
        ELSE NULL
      END,
      jsonb_build_object('address_status', v_status, 'source', 'v2_record_campaign_address_outcome'),
      v_session_user_id
    ) RETURNING id INTO v_session_event_id;

    IF p_session_event_type IN ('flyer_left', 'conversation', 'completed_manual', 'completed_auto') THEN
      UPDATE public.sessions
      SET completed_count = completed_count + 1, updated_at = now()
      WHERE id = p_session_id;
    ELSIF p_session_event_type = 'completion_undone' THEN
      UPDATE public.sessions
      SET completed_count = greatest(0, completed_count - 1), updated_at = now()
      WHERE id = p_session_id;
    END IF;
  END IF;

  v_response := jsonb_build_object(
    'applied', true,
    'replayed', false,
    'error_code', NULL,
    'canonical_state', v_current_state,
    'revision', v_result_revision,
    'event_id', v_event_id
  );

  UPDATE public.campaign_home_events
  SET result_state = v_response
  WHERE id = v_event_id;

  PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'status', v_request_hash, v_response);
  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.v2_record_campaign_address_outcome(
  uuid, uuid, text, text, timestamptz, uuid, text, text, double precision, double precision,
  text, bigint, text, text, integer, text, boolean
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- v2 manual pin mutations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.v2_create_campaign_manual_pin(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_formatted text,
  p_lat double precision,
  p_lon double precision,
  p_house_number text DEFAULT NULL,
  p_street_name text DEFAULT NULL,
  p_locality text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_assignment_id uuid DEFAULT NULL,
  p_building_gers_id text DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL,
  p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_formatted text := nullif(trim(coalesce(p_formatted, '')), '');
  v_assignment_id uuid := p_assignment_id;
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_state jsonb;
  v_event_id uuid;
  v_seq integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'AUTH_REQUIRED');
  END IF;
  IF p_campaign_address_id IS NULL OR v_mutation_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'PIN_ID_AND_MUTATION_ID_REQUIRED');
  END IF;
  IF v_formatted IS NULL OR p_lat IS NULL OR p_lon IS NULL
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lon NOT BETWEEN -180 AND 180
     OR NOT st_isvalid(st_setsrid(st_makepoint(p_lon, p_lat), 4326)) THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'INVALID_PIN');
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'pin_create', 'campaign_id', p_campaign_id,
    'address_id', p_campaign_address_id, 'formatted', v_formatted,
    'lat', p_lat, 'lon', p_lon, 'house_number', p_house_number,
    'street_name', p_street_name, 'locality', p_locality,
    'region', p_region, 'postal_code', p_postal_code,
    'assignment_id', p_assignment_id, 'building_gers_id', p_building_gers_id
  )::text);

  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF NOT public.campaign_client_mutation_allowed(v_platform, p_client_build) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
    RETURN v_response;
  END IF;
  PERFORM public.observe_campaign_client_build(v_platform, p_client_version, p_client_build);

  IF public.can_manage_campaign(p_campaign_id, v_actor) THEN
    IF v_assignment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.campaign_assignments ca
      WHERE ca.id = v_assignment_id AND ca.campaign_id = p_campaign_id
    ) THEN
      v_assignment_id := NULL;
    END IF;
  ELSE
    SELECT ca.id
    INTO v_assignment_id
    FROM public.campaign_assignments ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.assigned_to_user_id = v_actor
      AND ca.status IN ('accepted', 'in_progress')
      AND (p_assignment_id IS NULL OR ca.id = p_assignment_id)
    ORDER BY CASE ca.status WHEN 'in_progress' THEN 0 ELSE 1 END, ca.updated_at DESC
    LIMIT 1;

    IF v_assignment_id IS NULL THEN
      v_response := jsonb_build_object(
        'applied', false, 'replayed', false, 'error_code', 'ACTIVE_ASSIGNMENT_REQUIRED',
        'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
      );
      PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_create', v_request_hash, v_response);
      RETURN v_response;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.campaign_addresses ca WHERE ca.id = p_campaign_address_id) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'ADDRESS_ID_CONFLICT',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_create', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  -- Serialize sequence allocation without substituting a server-generated pin id.
  PERFORM 1 FROM public.campaigns c WHERE c.id = p_campaign_id FOR UPDATE;

  SELECT coalesce(max(ca.seq), 0) + 1
  INTO v_seq
  FROM public.campaign_addresses ca
  WHERE ca.campaign_id = p_campaign_id;

  INSERT INTO public.campaign_addresses(
    id, campaign_id, address, formatted, house_number, street_name, locality, region,
    postal_code, building_gers_id, source, match_source, geom, coordinate, visited, seq,
    created_by, updated_by, origin_platform, assignment_id, revision,
    last_client_mutation_id, created_at, updated_at, deleted_at
  ) OVERRIDING SYSTEM VALUE VALUES (
    p_campaign_address_id, p_campaign_id, v_formatted, v_formatted,
    nullif(trim(coalesce(p_house_number, '')), ''),
    nullif(trim(coalesce(p_street_name, '')), ''),
    nullif(trim(coalesce(p_locality, '')), ''),
    nullif(trim(coalesce(p_region, '')), ''),
    nullif(trim(coalesce(p_postal_code, '')), ''),
    nullif(trim(coalesce(p_building_gers_id, '')), ''),
    'manual', 'field_manual_pin',
    st_setsrid(st_makepoint(p_lon, p_lat), 4326),
    jsonb_build_object('lat', p_lat, 'lon', p_lon), false, v_seq,
    v_actor, v_actor, v_platform, v_assignment_id, 1,
    v_mutation_id, now(), now(), NULL
  )
  RETURNING to_jsonb(campaign_addresses) INTO v_state;

  IF v_assignment_id IS NOT NULL THEN
    INSERT INTO public.campaign_assignment_homes(assignment_id, campaign_address_id, sequence)
    VALUES (
      v_assignment_id,
      p_campaign_address_id,
      coalesce((SELECT max(sequence) + 1 FROM public.campaign_assignment_homes WHERE assignment_id = v_assignment_id), 1)
    )
    ON CONFLICT (assignment_id, campaign_address_id) DO NOTHING;
  END IF;

  INSERT INTO public.campaign_home_events(
    campaign_id, campaign_address_id, user_id, action_type, note, created_at,
    client_mutation_id, request_hash, origin_platform, client_version, client_build,
    base_revision, result_revision, applied_to_current, result_state
  ) VALUES (
    p_campaign_id, p_campaign_address_id, v_actor, 'pin_create', NULL, now(),
    v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
    0, 1, true, NULL
  ) RETURNING id INTO v_event_id;

  v_response := jsonb_build_object(
    'applied', true, 'replayed', false, 'error_code', NULL,
    'canonical_state', v_state, 'revision', 1, 'event_id', v_event_id
  );
  UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
  PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_create', v_request_hash, v_response);
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_update_campaign_manual_pin(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_base_revision bigint,
  p_formatted text,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL,
  p_house_number text DEFAULT NULL,
  p_street_name text DEFAULT NULL,
  p_locality text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL,
  p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL,
  p_legacy_bridge boolean DEFAULT false,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_formatted text := nullif(trim(coalesce(p_formatted, '')), '');
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_state jsonb;
  v_current_revision bigint;
  v_current_updated_at timestamptz;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('applied', false, 'error_code', 'AUTH_REQUIRED'); END IF;
  IF v_mutation_id IS NULL THEN RETURN jsonb_build_object('applied', false, 'error_code', 'CLIENT_MUTATION_ID_REQUIRED'); END IF;
  IF v_formatted IS NULL
     OR (p_lat IS NULL) <> (p_lon IS NULL)
     OR (p_lat IS NOT NULL AND p_lat NOT BETWEEN -90 AND 90)
     OR (p_lon IS NOT NULL AND p_lon NOT BETWEEN -180 AND 180) THEN
    RETURN jsonb_build_object('applied', false, 'error_code', 'INVALID_PIN');
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'pin_update', 'campaign_id', p_campaign_id,
    'address_id', p_campaign_address_id,
    'base_revision', CASE WHEN p_legacy_bridge THEN NULL ELSE p_base_revision END,
    'formatted', v_formatted, 'lat', p_lat, 'lon', p_lon,
    'house_number', p_house_number, 'street_name', p_street_name,
    'locality', p_locality, 'region', p_region, 'postal_code', p_postal_code
  )::text);
  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF NOT public.campaign_client_mutation_allowed(v_platform, p_client_build) THEN
    v_response := jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED');
    RETURN v_response;
  END IF;
  PERFORM public.observe_campaign_client_build(v_platform, p_client_version, p_client_build);

  SELECT ca.revision, ca.updated_at, to_jsonb(ca)
  INTO v_current_revision, v_current_updated_at, v_state
  FROM public.campaign_addresses ca
  WHERE ca.id = p_campaign_address_id
    AND ca.campaign_id = p_campaign_id
    AND ca.match_source = 'field_manual_pin'
    AND ca.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_mutate_campaign_address(p_campaign_id, p_campaign_address_id, v_actor) THEN
    v_response := jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_ACCESS_DENIED');
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_update', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  IF (p_legacy_bridge AND v_current_updated_at > coalesce(p_occurred_at, now()))
     OR (NOT p_legacy_bridge AND coalesce(p_base_revision, -1) <> v_current_revision) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'REVISION_CONFLICT',
      'canonical_state', v_state, 'revision', v_current_revision, 'event_id', NULL
    );
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, action_type, created_at,
      client_mutation_id, request_hash, origin_platform, client_version, client_build,
      base_revision, result_revision, applied_to_current, result_state
    ) VALUES (
      p_campaign_id, p_campaign_address_id, v_actor, 'pin_update_conflict', now(),
      v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
      p_base_revision, v_current_revision, false, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_update', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  UPDATE public.campaign_addresses ca
  SET address = v_formatted,
      formatted = v_formatted,
      house_number = nullif(trim(coalesce(p_house_number, '')), ''),
      street_name = nullif(trim(coalesce(p_street_name, '')), ''),
      locality = nullif(trim(coalesce(p_locality, '')), ''),
      region = nullif(trim(coalesce(p_region, '')), ''),
      postal_code = nullif(trim(coalesce(p_postal_code, '')), ''),
      geom = CASE WHEN p_lat IS NOT NULL THEN st_setsrid(st_makepoint(p_lon, p_lat), 4326) ELSE ca.geom END,
      coordinate = CASE WHEN p_lat IS NOT NULL THEN jsonb_build_object('lat', p_lat, 'lon', p_lon) ELSE ca.coordinate END,
      updated_by = v_actor,
      origin_platform = v_platform,
      revision = v_current_revision + 1,
      last_client_mutation_id = v_mutation_id,
      updated_at = now()
  WHERE ca.id = p_campaign_address_id
  RETURNING to_jsonb(ca) INTO v_state;

  INSERT INTO public.campaign_home_events(
    campaign_id, campaign_address_id, user_id, action_type, created_at,
    client_mutation_id, request_hash, origin_platform, client_version, client_build,
    base_revision, result_revision, applied_to_current
  ) VALUES (
    p_campaign_id, p_campaign_address_id, v_actor, 'pin_update', now(),
    v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
    v_current_revision, v_current_revision + 1, true
  ) RETURNING id INTO v_event_id;

  v_response := jsonb_build_object(
    'applied', true, 'replayed', false, 'error_code', NULL,
    'canonical_state', v_state, 'revision', v_current_revision + 1, 'event_id', v_event_id
  );
  UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
  PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_update', v_request_hash, v_response);
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_delete_campaign_manual_pin(
  p_campaign_id uuid,
  p_campaign_address_id uuid,
  p_base_revision bigint,
  p_client_mutation_id text,
  p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL,
  p_legacy_bridge boolean DEFAULT false,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_state jsonb;
  v_current_revision bigint;
  v_current_updated_at timestamptz;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('applied', false, 'error_code', 'AUTH_REQUIRED'); END IF;
  IF v_mutation_id IS NULL THEN RETURN jsonb_build_object('applied', false, 'error_code', 'CLIENT_MUTATION_ID_REQUIRED'); END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'pin_delete', 'campaign_id', p_campaign_id,
    'address_id', p_campaign_address_id,
    'base_revision', CASE WHEN p_legacy_bridge THEN NULL ELSE p_base_revision END
  )::text);
  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF NOT public.campaign_client_mutation_allowed(v_platform, p_client_build) THEN
    v_response := jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED');
    RETURN v_response;
  END IF;
  PERFORM public.observe_campaign_client_build(v_platform, p_client_version, p_client_build);

  SELECT ca.revision, ca.updated_at, to_jsonb(ca)
  INTO v_current_revision, v_current_updated_at, v_state
  FROM public.campaign_addresses ca
  WHERE ca.id = p_campaign_address_id
    AND ca.campaign_id = p_campaign_id
    AND ca.match_source = 'field_manual_pin'
    AND ca.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_mutate_campaign_address(p_campaign_id, p_campaign_address_id, v_actor) THEN
    v_response := jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_ACCESS_DENIED');
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_delete', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  IF (p_legacy_bridge AND v_current_updated_at > coalesce(p_occurred_at, now()))
     OR (NOT p_legacy_bridge AND coalesce(p_base_revision, -1) <> v_current_revision) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'REVISION_CONFLICT',
      'canonical_state', v_state, 'revision', v_current_revision, 'event_id', NULL
    );
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, action_type, created_at,
      client_mutation_id, request_hash, origin_platform, client_version, client_build,
      base_revision, result_revision, applied_to_current, result_state
    ) VALUES (
      p_campaign_id, p_campaign_address_id, v_actor, 'pin_delete_conflict', now(),
      v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
      p_base_revision, v_current_revision, false, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_delete', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  UPDATE public.campaign_addresses ca
  SET deleted_at = now(),
      updated_by = v_actor,
      origin_platform = v_platform,
      revision = v_current_revision + 1,
      last_client_mutation_id = v_mutation_id,
      updated_at = now()
  WHERE ca.id = p_campaign_address_id
  RETURNING to_jsonb(ca) INTO v_state;

  INSERT INTO public.campaign_home_events(
    campaign_id, campaign_address_id, user_id, action_type, created_at,
    client_mutation_id, request_hash, origin_platform, client_version, client_build,
    base_revision, result_revision, applied_to_current
  ) VALUES (
    p_campaign_id, p_campaign_address_id, v_actor, 'pin_delete', now(),
    v_mutation_id, v_request_hash, v_platform, p_client_version, p_client_build,
    v_current_revision, v_current_revision + 1, true
  ) RETURNING id INTO v_event_id;

  v_response := jsonb_build_object(
    'applied', true, 'replayed', false, 'error_code', NULL,
    'canonical_state', v_state, 'revision', v_current_revision + 1, 'event_id', v_event_id
  );
  UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
  PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'pin_delete', v_request_hash, v_response);
  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.v2_create_campaign_manual_pin(
  uuid, uuid, text, double precision, double precision, text, text, text, text, text,
  uuid, text, text, text, text, integer
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.v2_update_campaign_manual_pin(
  uuid, uuid, bigint, text, double precision, double precision, text, text, text, text,
  text, text, text, text, integer, boolean, timestamptz
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.v2_delete_campaign_manual_pin(
  uuid, uuid, bigint, text, text, text, integer, boolean, timestamptz
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic multi-address status mutations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.v2_record_campaign_target_outcome(
  p_campaign_id uuid,
  p_campaign_address_ids uuid[],
  p_status text,
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL,
  p_base_revisions jsonb DEFAULT '{}'::jsonb,
  p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_legacy_bridge boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_address_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_child jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_revisions jsonb := '{}'::jsonb;
  v_current_state jsonb;
  v_current_revision bigint;
  v_expected_revision bigint;
  v_current_actor uuid;
  v_current_occurred timestamptz;
  v_is_manager boolean;
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'AUTH_REQUIRED');
  END IF;
  IF v_mutation_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_MUTATION_ID_REQUIRED');
  END IF;
  IF v_status NOT IN ('none', 'no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead') THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'UNSUPPORTED_STATUS');
  END IF;

  SELECT coalesce(array_agg(address_id ORDER BY address_id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT DISTINCT address_id
    FROM unnest(coalesce(p_campaign_address_ids, ARRAY[]::uuid[])) input(address_id)
    WHERE address_id IS NOT NULL
  ) deduped;

  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_IDS_REQUIRED');
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'target_status', 'campaign_id', p_campaign_id,
    'address_ids', to_jsonb(v_ids), 'status', v_status, 'notes', coalesce(p_notes, ''),
    'occurred_at', p_occurred_at, 'session_id', p_session_id,
    'session_target_id', p_session_target_id, 'session_event_type', p_session_event_type,
    'lat', p_lat, 'lon', p_lon,
    'base_revisions', CASE
      WHEN p_legacy_bridge THEN NULL
      ELSE coalesce(p_base_revisions, '{}'::jsonb)
    END,
    'override_reason', v_reason
  )::text);

  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  IF NOT public.campaign_client_mutation_allowed(v_platform, p_client_build) THEN
    RETURN jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
  END IF;
  PERFORM public.observe_campaign_client_build(v_platform, p_client_version, p_client_build);

  -- A deterministic lock order makes the all-or-nothing preflight safe under concurrency.
  PERFORM 1
  FROM public.campaign_addresses ca
  WHERE ca.id = ANY(v_ids)
    AND ca.campaign_id = p_campaign_id
    AND ca.deleted_at IS NULL
  ORDER BY ca.id
  FOR UPDATE;

  IF (SELECT count(*) FROM public.campaign_addresses ca
      WHERE ca.id = ANY(v_ids) AND ca.campaign_id = p_campaign_id AND ca.deleted_at IS NULL)
     <> array_length(v_ids, 1) THEN
    v_response := jsonb_build_object(
      'applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_ACCESS_DENIED',
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL
    );
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'target_status', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  v_is_manager := public.can_manage_campaign(p_campaign_id, v_actor);

  FOREACH v_address_id IN ARRAY v_ids LOOP
    IF NOT public.can_mutate_campaign_address(p_campaign_id, v_address_id, v_actor) THEN
      v_response := jsonb_build_object(
        'applied', false, 'replayed', false, 'error_code', 'CAMPAIGN_ADDRESS_ACCESS_DENIED',
        'conflicting_address_id', v_address_id, 'canonical_state', NULL,
        'revision', NULL, 'event_id', NULL
      );
      EXIT;
    END IF;

    SELECT to_jsonb(ast), ast.revision, ast.last_action_by, ast.source_occurred_at
    INTO v_current_state, v_current_revision, v_current_actor, v_current_occurred
    FROM public.address_statuses ast
    WHERE ast.campaign_address_id = v_address_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_current_revision := 0;
      v_current_actor := NULL;
      v_current_occurred := NULL;
      v_current_state := jsonb_build_object(
        'campaign_address_id', v_address_id, 'campaign_id', p_campaign_id,
        'status', 'none', 'revision', 0
      );
    END IF;

    v_expected_revision := coalesce((p_base_revisions ->> v_address_id::text)::bigint, -1);
    IF (p_legacy_bridge AND v_current_occurred IS NOT NULL
        AND v_current_occurred > coalesce(p_occurred_at, now()))
       OR (NOT p_legacy_bridge AND v_expected_revision <> v_current_revision) THEN
      v_response := jsonb_build_object(
        'applied', false, 'replayed', false, 'error_code', 'REVISION_CONFLICT',
        'conflicting_address_id', v_address_id, 'canonical_state', v_current_state,
        'revision', v_current_revision, 'event_id', NULL
      );
      EXIT;
    END IF;

    IF v_current_actor IS NOT NULL AND v_current_actor <> v_actor THEN
      IF NOT v_is_manager THEN
        v_response := jsonb_build_object(
          'applied', false, 'replayed', false, 'error_code', 'TEAMMATE_STATUS_LOCKED',
          'conflicting_address_id', v_address_id, 'canonical_state', v_current_state,
          'revision', v_current_revision, 'event_id', NULL
        );
        EXIT;
      ELSIF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 200 THEN
        v_response := jsonb_build_object(
          'applied', false, 'replayed', false, 'error_code', 'OVERRIDE_REASON_REQUIRED',
          'conflicting_address_id', v_address_id, 'canonical_state', v_current_state,
          'revision', v_current_revision, 'event_id', NULL
        );
        EXIT;
      END IF;
    END IF;

    v_revisions := jsonb_set(v_revisions, ARRAY[v_address_id::text], to_jsonb(v_current_revision), true);
  END LOOP;

  IF v_response IS NOT NULL THEN
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, session_id, action_type,
      note, created_at, occurred_at, client_mutation_id, request_hash,
      origin_platform, client_version, client_build, base_revision,
      result_revision, applied_to_current, override_reason, result_state
    ) VALUES (
      p_campaign_id, coalesce((v_response ->> 'conflicting_address_id')::uuid, v_ids[1]),
      v_actor, p_session_id, 'bulk_status_rejected', p_notes, now(),
      coalesce(p_occurred_at, now()), v_mutation_id, v_request_hash, v_platform,
      p_client_version, p_client_build, NULL, (v_response ->> 'revision')::bigint,
      false, v_reason, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'target_status', v_request_hash, v_response);
    RETURN v_response;
  END IF;

  FOREACH v_address_id IN ARRAY v_ids LOOP
    v_child := public.v2_record_campaign_address_outcome(
      p_campaign_id => p_campaign_id,
      p_campaign_address_id => v_address_id,
      p_status => v_status,
      p_notes => p_notes,
      p_occurred_at => p_occurred_at,
      p_session_id => p_session_id,
      p_session_target_id => p_session_target_id,
      p_session_event_type => CASE WHEN v_address_id = v_ids[1] THEN p_session_event_type ELSE NULL END,
      p_lat => p_lat,
      p_lon => p_lon,
      p_client_mutation_id => v_mutation_id || ':' || v_address_id::text,
      p_base_revision => (v_revisions ->> v_address_id::text)::bigint,
      p_origin_platform => v_platform,
      p_client_version => p_client_version,
      p_client_build => p_client_build,
      p_override_reason => v_reason,
      p_legacy_bridge => p_legacy_bridge
    );

    IF coalesce((v_child ->> 'applied')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Atomic target mutation child failed after preflight: %', v_child;
    END IF;

    v_outcomes := v_outcomes || jsonb_build_array(v_child);
    v_revisions := jsonb_set(
      v_revisions, ARRAY[v_address_id::text], to_jsonb((v_child ->> 'revision')::bigint), true
    );
  END LOOP;

  v_response := jsonb_build_object(
    'applied', true, 'replayed', false, 'error_code', NULL,
    'canonical_state', v_outcomes, 'revision', v_revisions, 'event_id', NULL
  );

  -- A non-current parent event preserves permanent idempotency after the receipt TTL.
  INSERT INTO public.campaign_home_events(
    campaign_id, campaign_address_id, user_id, session_id, action_type, note,
    created_at, occurred_at, client_mutation_id, request_hash, origin_platform,
    client_version, client_build, applied_to_current, override_reason, result_state
  ) VALUES (
    p_campaign_id, v_ids[1], v_actor, p_session_id, 'bulk_status_receipt', p_notes,
    now(), coalesce(p_occurred_at, now()), v_mutation_id, v_request_hash, v_platform,
    p_client_version, p_client_build, false, v_reason, v_response
  ) RETURNING id INTO v_event_id;

  v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
  UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
  PERFORM public.store_campaign_mutation_receipt(v_actor, v_mutation_id, p_campaign_id, 'target_status', v_request_hash, v_response);
  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.v2_record_campaign_target_outcome(
  uuid, uuid[], text, text, timestamptz, uuid, text, text, double precision,
  double precision, text, jsonb, text, text, integer, text, boolean
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Legacy transition bridge. These names remain as rejection shims after cutoff.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_campaign_address_outcome(
  p_campaign_id uuid,
  p_campaign_address_id uuid DEFAULT NULL,
  p_address_id uuid DEFAULT NULL,
  p_status text DEFAULT 'none',
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_address_id uuid := coalesce(p_campaign_address_id, p_address_id);
  v_mutation_id text;
  v_revision bigint := 0;
  v_result jsonb;
  v_state jsonb;
BEGIN
  IF NOT public.legacy_campaign_mutations_allowed() THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED');
  END IF;

  v_mutation_id := 'legacy:' || md5(concat_ws('|',
    v_actor::text, p_campaign_id::text, v_address_id::text,
    lower(trim(coalesce(p_status, 'none'))), coalesce(p_notes, ''),
    p_occurred_at::text, p_session_id::text, coalesce(p_session_target_id, ''),
    coalesce(p_session_event_type, ''), p_lat::text, p_lon::text
  ));

  SELECT coalesce(ast.revision, 0)
  INTO v_revision
  FROM public.address_statuses ast
  WHERE ast.campaign_address_id = v_address_id;

  v_result := public.v2_record_campaign_address_outcome(
    p_campaign_id => p_campaign_id,
    p_campaign_address_id => v_address_id,
    p_status => p_status,
    p_notes => p_notes,
    p_occurred_at => p_occurred_at,
    p_session_id => p_session_id,
    p_session_target_id => p_session_target_id,
    p_session_event_type => p_session_event_type,
    p_lat => p_lat,
    p_lon => p_lon,
    p_client_mutation_id => v_mutation_id,
    p_base_revision => coalesce(v_revision, 0),
    p_origin_platform => 'legacy',
    p_legacy_bridge => true
  );

  v_state := v_result -> 'canonical_state';
  IF v_state IS NULL OR jsonb_typeof(v_state) <> 'object' THEN
    v_state := '{}'::jsonb;
  END IF;
  RETURN v_state || jsonb_build_object(
    'applied', coalesce((v_result ->> 'applied')::boolean, false),
    'replayed', coalesce((v_result ->> 'replayed')::boolean, false),
    'error_code', v_result ->> 'error_code',
    'revision', v_result -> 'revision',
    'campaign_home_event_id', v_result -> 'event_id',
    'visited', lower(trim(coalesce(p_status, 'none'))) <> 'none'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_campaign_target_outcome(
  p_campaign_id uuid,
  p_campaign_address_ids uuid[],
  p_status text DEFAULT 'none',
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_revisions jsonb := '{}'::jsonb;
  v_mutation_id text;
  v_result jsonb;
BEGIN
  IF NOT public.legacy_campaign_mutations_allowed() THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_UPGRADE_REQUIRED');
  END IF;

  SELECT coalesce(array_agg(address_id ORDER BY address_id), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT DISTINCT address_id
    FROM unnest(coalesce(p_campaign_address_ids, ARRAY[]::uuid[])) input(address_id)
    WHERE address_id IS NOT NULL
  ) deduped;

  FOREACH v_id IN ARRAY v_ids LOOP
    v_revisions := jsonb_set(
      v_revisions,
      ARRAY[v_id::text],
      to_jsonb(coalesce((SELECT ast.revision FROM public.address_statuses ast WHERE ast.campaign_address_id = v_id), 0)),
      true
    );
  END LOOP;

  v_mutation_id := 'legacy:' || md5(concat_ws('|',
    v_actor::text, p_campaign_id::text, array_to_string(v_ids, ','),
    lower(trim(coalesce(p_status, 'none'))), coalesce(p_notes, ''),
    p_occurred_at::text, p_session_id::text, coalesce(p_session_target_id, ''),
    coalesce(p_session_event_type, ''), p_lat::text, p_lon::text
  ));

  v_result := public.v2_record_campaign_target_outcome(
    p_campaign_id => p_campaign_id,
    p_campaign_address_ids => v_ids,
    p_status => p_status,
    p_notes => p_notes,
    p_occurred_at => p_occurred_at,
    p_session_id => p_session_id,
    p_session_target_id => p_session_target_id,
    p_session_event_type => p_session_event_type,
    p_lat => p_lat,
    p_lon => p_lon,
    p_client_mutation_id => v_mutation_id,
    p_base_revisions => v_revisions,
    p_origin_platform => 'legacy',
    p_legacy_bridge => true
  );

  RETURN jsonb_build_object(
    'applied', coalesce((v_result ->> 'applied')::boolean, false),
    'replayed', coalesce((v_result ->> 'replayed')::boolean, false),
    'error_code', v_result ->> 'error_code',
    'campaign_address_ids', to_jsonb(v_ids),
    'status', lower(trim(coalesce(p_status, 'none'))),
    'visited', lower(trim(coalesce(p_status, 'none'))) <> 'none',
    'affected_count', CASE WHEN coalesce((v_result ->> 'applied')::boolean, false) THEN array_length(v_ids, 1) ELSE 0 END,
    'address_outcomes', coalesce(v_result -> 'canonical_state', '[]'::jsonb),
    'event_id', v_result -> 'event_id',
    'revision', v_result -> 'revision'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_campaign_address_outcome(
  uuid, uuid, uuid, text, text, timestamptz, uuid, text, text, double precision, double precision
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_target_outcome(
  uuid, uuid[], text, text, timestamptz, uuid, text, text, double precision, double precision
) TO authenticated, service_role;

-- Snapshot used after subscription confirmation and reconnect repair.
CREATE OR REPLACE FUNCTION public.rpc_get_campaign_collaboration_state(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.can_view_campaign(p_campaign_id) THEN jsonb_build_object(
    'server_time', now(),
    'statuses', coalesce((
      SELECT jsonb_agg(to_jsonb(ast) ORDER BY ast.campaign_address_id)
      FROM public.address_statuses ast
      WHERE ast.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'manual_pins', coalesce((
      SELECT jsonb_agg(to_jsonb(ca) ORDER BY ca.updated_at, ca.id)
      FROM public.campaign_addresses ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.match_source = 'field_manual_pin'
    ), '[]'::jsonb),
    'editable_address_ids', coalesce((
      SELECT jsonb_agg(ca.id ORDER BY ca.id)
      FROM public.campaign_addresses ca
      WHERE ca.campaign_id = p_campaign_id
        AND ca.deleted_at IS NULL
        AND public.can_mutate_campaign_address(p_campaign_id, ca.id)
    ), '[]'::jsonb)
  ) ELSE NULL END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_collaboration_state(uuid) TO authenticated, service_role;

-- Dynamic state is published independently from cold-start map bundles.
ALTER TABLE public.campaign_addresses REPLICA IDENTITY FULL;
ALTER TABLE public.address_statuses REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_assignment_homes REPLICA IDENTITY FULL;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'campaign_addresses', 'address_statuses',
    'campaign_assignments', 'campaign_assignment_homes'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.campaign_mutation_receipts IS
  '90-day response cache only. campaign_home_events keeps permanent mutation uniqueness.';
COMMENT ON FUNCTION public.v2_record_campaign_address_outcome(
  uuid, uuid, text, text, timestamptz, uuid, text, text, double precision,
  double precision, text, bigint, text, text, integer, text, boolean
) IS 'Revision-checked, ownership-aware, idempotent single-address campaign status mutation.';

NOTIFY pgrst, 'reload schema';
COMMIT;
