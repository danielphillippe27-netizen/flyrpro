-- Shared coverage is opt-in and independent of campaign status/revision/notes.
CREATE OR REPLACE FUNCTION public.can_manage_workspace_coverage(p_workspace_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p_workspace_id AND w.owner_id = p_user_id)
    OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_user_id AND lower(m.role) IN ('owner', 'admin'))
  );
$$;

CREATE TABLE public.workspace_coverage_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.workspace_coverage_settings(workspace_id, enabled) SELECT id, false FROM public.workspaces;
ALTER TABLE public.workspace_coverage_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY coverage_settings_read ON public.workspace_coverage_settings FOR SELECT TO authenticated
USING (public.can_manage_workspace_coverage(workspace_id) OR EXISTS (
  SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = workspace_coverage_settings.workspace_id AND m.user_id = auth.uid()
));
-- Only RPC can mutate: existing broad workspace policies cannot change the flag.
REVOKE ALL ON public.workspace_coverage_settings FROM anon, authenticated;
GRANT SELECT ON public.workspace_coverage_settings TO authenticated;
GRANT ALL ON public.workspace_coverage_settings TO service_role;

CREATE OR REPLACE FUNCTION public.set_workspace_coverage(p_workspace_id uuid, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_manage_workspace_coverage(p_workspace_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only workspace owners and managers can change shared coverage';
  END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'enabled is required'; END IF;
  INSERT INTO workspace_coverage_settings(workspace_id, enabled, updated_by)
  VALUES (p_workspace_id, p_enabled, auth.uid())
  ON CONFLICT (workspace_id) DO UPDATE SET enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now();
  RETURN jsonb_build_object('enabled', p_enabled, 'canManage', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_workspace_coverage(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_coverage(uuid, boolean) TO authenticated;

-- Require BOTH an external address identifier and its full label. This avoids
-- collapsing separate doors/units when legacy gers_id actually names a building.
-- A missed match is safer than locking an unrelated home. Dataset changes need
-- explicit reconciliation; synthetic IDs are intentionally not cross-campaign.
CREATE OR REPLACE FUNCTION public.workspace_coverage_key(p_address jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH identity AS (
    SELECT nullif(trim(coalesce(nullif(p_address->>'source_id', ''), p_address->>'gers_id')), '') AS source_id,
      nullif(lower(regexp_replace(trim(coalesce(nullif(p_address->>'formatted', ''), p_address->>'address')), '\s+', ' ', 'g')), '') AS label
  ) SELECT CASE WHEN source_id IS NULL OR label IS NULL
      OR source_id = p_address->>'id'
      OR source_id ~* '(synthetic|manual|reconciliation|building-proxy)'
      OR coalesce(p_address->>'match_source', '') = 'field_manual_pin'
    THEN NULL ELSE 'address-v1:' || md5(jsonb_build_array(source_id, label)::text) END
  FROM identity;
$$;

-- Scalar immutable helper permits an expression index without rewriting the
-- production address table or firing its existing update/realtime triggers.
CREATE OR REPLACE FUNCTION public.campaign_address_coverage_key(
  p_source_id text, p_gers_id text, p_formatted text, p_address text, p_id uuid, p_match_source text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.workspace_coverage_key(jsonb_build_object(
    'source_id', p_source_id, 'gers_id', p_gers_id, 'formatted', p_formatted,
    'address', p_address, 'id', p_id, 'match_source', p_match_source
  ));
$$;
CREATE INDEX campaign_addresses_coverage_key_idx ON public.campaign_addresses(
  public.campaign_address_coverage_key(source_id::text, gers_id::text, formatted, address, id, match_source), campaign_id
);

-- Deliberately no campaign/address FK: deleting or archiving a campaign must not
-- erase the team's history. Only deleting the workspace removes its ledger.
CREATE TABLE public.workspace_home_coverage (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  home_key text NOT NULL,
  campaign_id uuid,
  campaign_address_id uuid,
  campaign_name text,
  last_action_by uuid,
  visited_at timestamptz,
  status text,
  PRIMARY KEY (workspace_id, home_key)
);
ALTER TABLE public.workspace_home_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_home_coverage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_home_coverage TO service_role;

INSERT INTO public.workspace_home_coverage(workspace_id, home_key, campaign_id, campaign_address_id, campaign_name, last_action_by, visited_at, status)
SELECT DISTINCT ON (c.workspace_id, public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source))
  c.workspace_id, public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source), c.id, ca.id, coalesce(c.name, c.title), ast.last_action_by,
  coalesce(ast.last_visited_at, ast.updated_at), ast.status
FROM public.address_statuses ast JOIN public.campaign_addresses ca ON ca.id = ast.campaign_address_id
JOIN public.campaigns c ON c.id = ca.campaign_id
WHERE c.workspace_id IS NOT NULL AND public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source) IS NOT NULL
  AND (ast.status NOT IN ('none', 'untouched') OR ast.last_visited_at IS NOT NULL)
ORDER BY c.workspace_id, public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source), coalesce(ast.last_visited_at, ast.updated_at) DESC, ca.id;

CREATE OR REPLACE FUNCTION public.guard_workspace_home_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workspace uuid; v_key text; v_campaign uuid; v_name text;
  v_previous public.workspace_home_coverage%ROWTYPE;
  v_reason text := nullif(trim(current_setting('wolfgrid.coverage_override_reason', true)), '');
BEGIN
  -- Clearing a campaign status never erases shared visit history.
  IF NEW.status IN ('none', 'untouched') THEN RETURN NEW; END IF;
  SELECT c.workspace_id, public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source), c.id, coalesce(c.name, c.title)
  INTO v_workspace, v_key, v_campaign, v_name
  FROM campaign_addresses ca JOIN campaigns c ON c.id = ca.campaign_id WHERE ca.id = NEW.campaign_address_id;
  IF v_workspace IS NULL OR v_key IS NULL THEN RETURN NEW; END IF;
  INSERT INTO workspace_home_coverage(workspace_id, home_key) VALUES (v_workspace, v_key)
  ON CONFLICT DO NOTHING;
  -- Row locking, including the first insert, serializes simultaneous campaigns.
  SELECT * INTO v_previous FROM workspace_home_coverage
  WHERE workspace_id = v_workspace AND home_key = v_key FOR UPDATE;
  IF v_previous.visited_at IS NOT NULL AND v_previous.campaign_id IS DISTINCT FROM v_campaign
    AND EXISTS (SELECT 1 FROM workspace_coverage_settings WHERE workspace_id = v_workspace AND enabled) THEN
    IF NOT public.can_manage_workspace_coverage(v_workspace) THEN
      RAISE EXCEPTION USING ERRCODE = 'PWC01', MESSAGE = 'WORKSPACE_HOME_ALREADY_VISITED';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION USING ERRCODE = 'PWC02', MESSAGE = 'OVERRIDE_REASON_REQUIRED';
    END IF;
    UPDATE campaign_home_events SET action_type = 'manager_override', override_reason = v_reason
    WHERE id = NEW.last_home_event_id AND user_id = auth.uid();
  END IF;
  UPDATE workspace_home_coverage SET campaign_id = v_campaign, campaign_address_id = NEW.campaign_address_id,
    campaign_name = v_name, last_action_by = coalesce(auth.uid(), NEW.last_action_by),
    visited_at = coalesce(NEW.last_visited_at, now()), status = NEW.status
  WHERE workspace_id = v_workspace AND home_key = v_key;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_workspace_home_coverage BEFORE INSERT OR UPDATE OF status, last_action_by, campaign_address_id ON public.address_statuses
FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_home_coverage();


-- Persist rejected outcomes too, so a retry cannot become a new visit after the
-- policy is disabled. The existing replay mechanism also retains event receipts.
CREATE OR REPLACE FUNCTION public.record_workspace_coverage_rejection(
  p_campaign uuid, p_address uuid, p_mutation text, p_hash text, p_result jsonb, p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid;
BEGIN
  INSERT INTO campaign_home_events(campaign_id, campaign_address_id, user_id, action_type,
    created_at, client_mutation_id, request_hash, applied_to_current, result_state)
  VALUES(p_campaign, p_address, auth.uid(), CASE WHEN p_operation = 'target_status' THEN 'bulk_status_rejected' ELSE 'status_rejected' END,
    now(), trim(p_mutation), p_hash, false, p_result) RETURNING id INTO v_event;
  p_result := jsonb_set(p_result, '{event_id}', to_jsonb(v_event), true);
  UPDATE campaign_home_events SET result_state = p_result WHERE id = v_event;
  PERFORM public.store_campaign_mutation_receipt(auth.uid(), trim(p_mutation), p_campaign, p_operation, p_hash, p_result);
  RETURN p_result;
END;
$$;
REVOKE ALL ON FUNCTION public.record_workspace_coverage_rejection(uuid,uuid,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;

-- Preserve every existing revision, replay, manual-pin and session validation.
ALTER FUNCTION public.v2_record_campaign_address_outcome(uuid,uuid,text,text,timestamptz,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean)
RENAME TO v2_record_campaign_address_outcome_without_workspace_coverage;
REVOKE ALL ON FUNCTION public.v2_record_campaign_address_outcome_without_workspace_coverage(uuid,uuid,text,text,timestamptz,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.v2_record_campaign_address_outcome(
  p_campaign_id uuid, p_campaign_address_id uuid, p_status text, p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(), p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL, p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL, p_lon double precision DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL, p_base_revision bigint DEFAULT 0,
  p_origin_platform text DEFAULT 'web', p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL, p_override_reason text DEFAULT NULL, p_legacy_bridge boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_prior text := current_setting('wolfgrid.coverage_override_reason', true); v_state jsonb; v_hash text;
BEGIN
  PERFORM set_config('wolfgrid.coverage_override_reason', coalesce(p_override_reason, ''), true);
  BEGIN
    v_result := public.v2_record_campaign_address_outcome_without_workspace_coverage(
      p_campaign_id, p_campaign_address_id, p_status, p_notes, p_occurred_at, p_session_id,
      p_session_target_id, p_session_event_type, p_lat, p_lon, p_client_mutation_id,
      p_base_revision, p_origin_platform, p_client_version, p_client_build, p_override_reason, p_legacy_bridge);
  EXCEPTION WHEN SQLSTATE 'PWC01' OR SQLSTATE 'PWC02' THEN
    IF current_setting('wolfgrid.coverage_atomic_target', true) = 'on' THEN RAISE; END IF;
    -- Subtransaction rolls back event, revision and session counters together.
    SELECT to_jsonb(ast) INTO v_state FROM address_statuses ast WHERE ast.campaign_address_id = p_campaign_address_id;
    v_result := jsonb_build_object('applied', false, 'replayed', false, 'error_code', SQLERRM,
      'canonical_state', v_state, 'revision', coalesce((v_state->>'revision')::bigint, 0), 'event_id', NULL);
  v_hash := md5(jsonb_build_object(
    'operation', 'status',
    'campaign_id', p_campaign_id,
    'address_id', p_campaign_address_id,
    'status', lower(trim(coalesce(p_status, 'none'))),
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
    'override_reason', nullif(trim(coalesce(p_override_reason, '')), '')
  )::text);
    v_result := public.record_workspace_coverage_rejection(p_campaign_id, p_campaign_address_id, p_client_mutation_id, v_hash, v_result, 'status');
  END;
  PERFORM set_config('wolfgrid.coverage_override_reason', coalesce(v_prior, ''), true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.v2_record_campaign_address_outcome(uuid,uuid,text,text,timestamptz,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v2_record_campaign_address_outcome(uuid,uuid,text,text,timestamptz,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_workspace_coverage(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_workspace uuid; v_enabled boolean; v_rows jsonb; v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_campaign(p_campaign_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Campaign access denied';
  END IF;
  SELECT workspace_id INTO v_workspace FROM campaigns WHERE id = p_campaign_id;
  -- Membership required even if a campaign was individually shared across teams.
  IF v_workspace IS NULL OR NOT (public.can_manage_workspace_coverage(v_workspace) OR EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = v_workspace AND user_id = auth.uid()
  )) THEN RETURN jsonb_build_object('enabled', false, 'canManage', false, 'homes', '[]'::jsonb); END IF;
  SELECT coalesce((SELECT enabled FROM workspace_coverage_settings WHERE workspace_id = v_workspace), false) INTO v_enabled;
  IF NOT v_enabled THEN RETURN jsonb_build_object('enabled', false, 'canManage', public.can_manage_workspace_coverage(v_workspace), 'homes', '[]'::jsonb); END IF;
  WITH homes AS (
    SELECT ca.id AS address_id,
      CASE WHEN public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source) IS NULL THEN 'unmatched'
        WHEN h.visited_at IS NOT NULL AND h.campaign_id <> p_campaign_id THEN 'visited_elsewhere'
        WHEN other.id IS NOT NULL THEN 'overlap' ELSE 'available' END AS state,
      CASE WHEN h.visited_at IS NOT NULL AND h.campaign_id <> p_campaign_id THEN h.campaign_name ELSE other.name END AS campaign_name,
      CASE WHEN h.campaign_id <> p_campaign_id THEN h.visited_at END AS visited_at,
      CASE WHEN h.campaign_id <> p_campaign_id THEN h.last_action_by END AS last_action_by,
      CASE WHEN h.campaign_id <> p_campaign_id THEN profile.full_name END AS rep_name
    FROM campaign_addresses ca
    LEFT JOIN workspace_home_coverage h ON h.workspace_id = v_workspace AND h.home_key = public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source)
    LEFT JOIN user_profiles profile ON profile.user_id = h.last_action_by
    LEFT JOIN LATERAL (
      SELECT c.id, coalesce(c.name, c.title) AS name
      FROM campaign_addresses peer JOIN campaigns c ON c.id = peer.campaign_id
      WHERE public.campaign_address_coverage_key(peer.source_id::text, peer.gers_id::text, peer.formatted, peer.address, peer.id, peer.match_source) = public.campaign_address_coverage_key(ca.source_id::text, ca.gers_id::text, ca.formatted, ca.address, ca.id, ca.match_source) AND c.workspace_id = v_workspace AND c.id <> p_campaign_id
        AND peer.deleted_at IS NULL AND lower(coalesce(c.status, 'active')) NOT IN ('archived', 'completed', 'deleted', 'cancelled')
        AND nullif(to_jsonb(c)->>'archived_at', '') IS NULL AND nullif(to_jsonb(c)->>'deleted_at', '') IS NULL
      ORDER BY c.created_at, c.id LIMIT 1
    ) other ON true
    WHERE ca.campaign_id = p_campaign_id AND ca.deleted_at IS NULL
  ) SELECT coalesce(jsonb_agg(to_jsonb(homes)) FILTER (WHERE state <> 'available'), '[]'::jsonb),
    jsonb_build_object('total', count(*), 'visited', count(*) FILTER (WHERE state = 'visited_elsewhere'),
      'overlap', count(*) FILTER (WHERE state = 'overlap'), 'available', count(*) FILTER (WHERE state = 'available'),
      'unmatched', count(*) FILTER (WHERE state = 'unmatched'))
  INTO v_rows, v_summary FROM homes;
  RETURN jsonb_build_object('enabled', true, 'canManage', public.can_manage_workspace_coverage(v_workspace), 'homes', v_rows, 'summary', v_summary);
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_workspace_coverage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_workspace_coverage(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_workspace_coverage_settings(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_workspace_coverage(p_workspace_id) OR EXISTS (
    SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()
  )) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Workspace access denied'; END IF;
  RETURN jsonb_build_object('enabled', coalesce((SELECT enabled FROM workspace_coverage_settings WHERE workspace_id = p_workspace_id), false),
    'canManage', public.can_manage_workspace_coverage(p_workspace_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_workspace_coverage_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_coverage_settings(uuid) TO authenticated;

-- Keep multi-address mutations atomic and return a typed offline-sync conflict.
ALTER FUNCTION public.v2_record_campaign_target_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,boolean)
RENAME TO v2_record_campaign_target_outcome_without_workspace_coverage;
REVOKE ALL ON FUNCTION public.v2_record_campaign_target_outcome_without_workspace_coverage(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,boolean) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.v2_record_campaign_target_outcome(
  p_campaign_id uuid, p_campaign_address_ids uuid[], p_status text, p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(), p_session_id uuid DEFAULT NULL,
  p_session_target_id text DEFAULT NULL, p_session_event_type text DEFAULT NULL,
  p_lat double precision DEFAULT NULL, p_lon double precision DEFAULT NULL,
  p_client_mutation_id text DEFAULT NULL, p_base_revisions jsonb DEFAULT '{}'::jsonb,
  p_origin_platform text DEFAULT 'web', p_client_version text DEFAULT NULL,
  p_client_build integer DEFAULT NULL, p_override_reason text DEFAULT NULL, p_legacy_bridge boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_prior text := current_setting('wolfgrid.coverage_atomic_target', true); v_hash text; v_ids uuid[];
BEGIN
  PERFORM set_config('wolfgrid.coverage_atomic_target', 'on', true);
  BEGIN
    v_result := public.v2_record_campaign_target_outcome_without_workspace_coverage(
      p_campaign_id, p_campaign_address_ids, p_status, p_notes, p_occurred_at, p_session_id,
      p_session_target_id, p_session_event_type, p_lat, p_lon, p_client_mutation_id,
      p_base_revisions, p_origin_platform, p_client_version, p_client_build, p_override_reason, p_legacy_bridge);
  EXCEPTION WHEN SQLSTATE 'PWC01' OR SQLSTATE 'PWC02' THEN
    v_result := jsonb_build_object('applied', false, 'replayed', false, 'error_code', SQLERRM,
      'canonical_state', NULL, 'revision', NULL, 'event_id', NULL);
    SELECT array_agg(address_id ORDER BY address_id) INTO v_ids FROM (
      SELECT DISTINCT address_id FROM unnest(p_campaign_address_ids) input(address_id) WHERE address_id IS NOT NULL
    ) ids;
  v_hash := md5(jsonb_build_object(
    'operation', 'target_status', 'campaign_id', p_campaign_id,
    'address_ids', to_jsonb(v_ids), 'status', lower(trim(coalesce(p_status, 'none'))), 'notes', coalesce(p_notes, ''),
    'occurred_at', p_occurred_at, 'session_id', p_session_id,
    'session_target_id', p_session_target_id, 'session_event_type', p_session_event_type,
    'lat', p_lat, 'lon', p_lon,
    'base_revisions', CASE
      WHEN p_legacy_bridge THEN NULL
      ELSE coalesce(p_base_revisions, '{}'::jsonb)
    END,
    'override_reason', nullif(trim(coalesce(p_override_reason, '')), '')
  )::text);
    v_result := public.record_workspace_coverage_rejection(p_campaign_id, v_ids[1], p_client_mutation_id, v_hash, v_result, 'target_status');
  END;
  PERFORM set_config('wolfgrid.coverage_atomic_target', coalesce(v_prior, ''), true);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.v2_record_campaign_target_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v2_record_campaign_target_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,boolean) TO authenticated, service_role;
