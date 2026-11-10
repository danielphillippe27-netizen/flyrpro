-- One visit definition and one atomic campaign + farm mutation. No historical data rewrite.
CREATE OR REPLACE FUNCTION public.outcome_counts_as_visit(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(lower(trim(p_status)) IN ('no_answer','delivered','talked','appointment','future_seller','hot_lead'), false)
$$;

-- Retain the existing outer manual-pin and workspace-coverage guards.
CREATE OR REPLACE FUNCTION public.v2_record_campaign_address_outcome_creator_unchecked(
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
  v_effective_event_type text;
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
  v_visited := public.outcome_counts_as_visit(v_status);

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
      WHEN NOT public.outcome_counts_as_visit(excluded.status) THEN public.address_statuses.last_visited_at
      ELSE excluded.last_visited_at
    END,
    visit_count = CASE
      WHEN NOT public.outcome_counts_as_visit(excluded.status) THEN public.address_statuses.visit_count
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

  -- An exclusion/reset retracts this session's credit, without erasing history.
  v_effective_event_type := p_session_event_type;
  IF NOT v_visited THEN
    v_effective_event_type := CASE WHEN p_session_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.session_events e WHERE e.session_id = p_session_id
        AND e.address_id = p_campaign_address_id
        AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto')
    ) THEN 'completion_undone' ELSE NULL END;
  END IF;

  IF p_session_id IS NOT NULL AND v_effective_event_type IS NOT NULL THEN
    IF v_effective_event_type NOT IN (
      'flyer_left', 'conversation', 'address_tap',
      'completed_manual', 'completed_auto', 'completion_undone'
    ) THEN
      RAISE EXCEPTION 'Unsupported session event type: %', v_effective_event_type;
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
      v_effective_event_type, coalesce(p_occurred_at, now()), p_lat, p_lon,
      CASE WHEN p_lon IS NOT NULL AND p_lat IS NOT NULL
        THEN st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
        ELSE NULL
      END,
      jsonb_build_object('address_status', v_status, 'source', 'v2_record_campaign_address_outcome', 'revision', v_result_revision),
      v_session_user_id
    ) RETURNING id INTO v_session_event_id;

    IF v_effective_event_type IN ('flyer_left', 'conversation', 'completed_manual', 'completed_auto') THEN
      UPDATE public.sessions
      SET completed_count = (SELECT count(*) FROM (
        SELECT DISTINCT ON (coalesce(e.building_id::text,e.address_id::text,e.id::text)) e.event_type, e.metadata
        FROM public.session_events e WHERE e.session_id = p_session_id
          AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
        ORDER BY coalesce(e.building_id::text,e.address_id::text,e.id::text), e.created_at DESC, coalesce((e.metadata->>'revision')::bigint,0) DESC, e.id DESC
      ) latest WHERE event_type <> 'completion_undone'
        AND coalesce(metadata->>'address_status','delivered') NOT IN ('none','do_not_knock')), updated_at = now()
      WHERE id = p_session_id;
    ELSIF v_effective_event_type = 'completion_undone' THEN
      UPDATE public.sessions
      SET completed_count = (SELECT count(*) FROM (
        SELECT DISTINCT ON (coalesce(e.building_id::text,e.address_id::text,e.id::text)) e.event_type, e.metadata
        FROM public.session_events e WHERE e.session_id = p_session_id
          AND e.event_type IN ('flyer_left','conversation','completed_manual','completed_auto','completion_undone')
        ORDER BY coalesce(e.building_id::text,e.address_id::text,e.id::text), e.created_at DESC, coalesce((e.metadata->>'revision')::bigint,0) DESC, e.id DESC
      ) latest WHERE event_type <> 'completion_undone'
        AND coalesce(metadata->>'address_status','delivered') NOT IN ('none','do_not_knock')), updated_at = now()
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

CREATE OR REPLACE FUNCTION public.apply_farm_address_outcome(
  p_farm_id uuid,
  p_farm_touch_id uuid,
  p_farm_address_id uuid DEFAULT NULL,
  p_campaign_address_id uuid DEFAULT NULL,
  p_status text DEFAULT 'delivered',
  p_notes text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_revision_checked boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(trim(coalesce(p_status, 'delivered')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_farm_address_id uuid := p_farm_address_id;
  v_visit_count integer := 0;
  v_latest_visit record;
  v_touch_farm_id uuid;
  v_address_farm_id uuid;
  v_touch_homes_reached integer := 0;
  v_campaign_id uuid;
  v_previous public.farm_touch_addresses%ROWTYPE;
  v_last_visit_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_farm_id IS NULL THEN
    RAISE EXCEPTION 'farm id is required';
  END IF;

  IF p_farm_touch_id IS NULL THEN
    RAISE EXCEPTION 'farm touch id is required';
  END IF;

  IF v_status NOT IN (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  ) THEN
    RAISE EXCEPTION 'Unsupported farm address status: %', v_status;
  END IF;

  PERFORM 1
  FROM public.farms f
  LEFT JOIN public.workspace_members wm
    ON wm.workspace_id = f.workspace_id
  WHERE f.id = p_farm_id
    AND (
      f.owner_id = auth.uid()
      OR wm.user_id = auth.uid()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Farm not found or access denied';
  END IF;

  -- All writers serialize the farm before touching its aggregates.
  SELECT linked_campaign_id INTO v_campaign_id FROM public.farms WHERE id = p_farm_id FOR UPDATE;
  IF p_occurred_at IS NULL THEN RAISE EXCEPTION 'Outcome timestamp required'; END IF;

  SELECT farm_id
  INTO v_touch_farm_id
  FROM public.farm_touches
  WHERE id = p_farm_touch_id;

  IF v_touch_farm_id IS NULL OR v_touch_farm_id IS DISTINCT FROM p_farm_id THEN
    RAISE EXCEPTION 'Farm touch not found or does not belong to the farm';
  END IF;

  IF v_farm_address_id IS NULL AND p_campaign_address_id IS NOT NULL THEN
    SELECT id
    INTO v_farm_address_id
    FROM public.farm_addresses
    WHERE farm_id = p_farm_id
      AND campaign_address_id = p_campaign_address_id
    ;
    IF (SELECT count(*) FROM public.farm_addresses WHERE farm_id = p_farm_id
        AND campaign_address_id = p_campaign_address_id) <> 1 THEN
      RAISE EXCEPTION 'FARM_ADDRESS_LINK_REQUIRED: resolve the farm home link before syncing';
    END IF;
  END IF;

  IF v_farm_address_id IS NULL THEN
    RAISE EXCEPTION 'farm address id or campaign address id is required';
  END IF;

  SELECT farm_id
  INTO v_address_farm_id
  FROM public.farm_addresses
  WHERE id = v_farm_address_id;

  IF v_address_farm_id IS NULL OR v_address_farm_id IS DISTINCT FROM p_farm_id THEN
    RAISE EXCEPTION 'Farm address not found or does not belong to the farm';
  END IF;

  IF p_campaign_address_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.farm_addresses fa JOIN public.campaign_addresses ca ON ca.id = fa.campaign_address_id
    WHERE fa.id = v_farm_address_id AND ca.id = p_campaign_address_id
      AND ca.campaign_id = v_campaign_id AND ca.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'FARM_ADDRESS_LINK_MISMATCH'; END IF;

  SELECT * INTO v_previous FROM public.farm_touch_addresses
    WHERE farm_touch_id = p_farm_touch_id AND farm_address_id = v_farm_address_id;
  IF FOUND AND NOT p_revision_checked AND (v_previous.occurred_at > p_occurred_at OR (
      v_previous.occurred_at = p_occurred_at AND (v_previous.status <> v_status
        OR (v_notes IS NOT NULL AND v_previous.notes IS DISTINCT FROM v_notes)))) THEN
    RAISE EXCEPTION 'FARM_OUTCOME_CONFLICT: a newer outcome is already saved';
  END IF;

  INSERT INTO public.farm_touch_addresses (
    farm_id,
    farm_touch_id,
    farm_address_id,
    campaign_address_id,
    status,
    notes,
    occurred_at,
    created_by,
    updated_at
  )
  SELECT
    p_farm_id,
    p_farm_touch_id,
    fa.id,
    COALESCE(p_campaign_address_id, fa.campaign_address_id),
    v_status,
    v_notes,
    p_occurred_at,
    auth.uid(),
    now()
  FROM public.farm_addresses fa
  WHERE fa.id = v_farm_address_id
  ON CONFLICT (farm_touch_id, farm_address_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    notes = CASE WHEN EXCLUDED.status = 'none' THEN EXCLUDED.notes ELSE COALESCE(EXCLUDED.notes, public.farm_touch_addresses.notes) END,
    occurred_at = EXCLUDED.occurred_at,
    campaign_address_id = COALESCE(EXCLUDED.campaign_address_id, public.farm_touch_addresses.campaign_address_id),
    updated_at = now();

  SELECT COUNT(*)
  INTO v_visit_count
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_address_id = v_farm_address_id
    AND public.outcome_counts_as_visit(fta.status);

  SELECT
    fta.occurred_at,
    fta.farm_touch_id,
    fta.status
  INTO v_latest_visit
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_address_id = v_farm_address_id

  ORDER BY fta.occurred_at DESC, fta.updated_at DESC
  LIMIT 1;

  SELECT max(occurred_at) INTO v_last_visit_at FROM public.farm_touch_addresses
    WHERE farm_address_id = v_farm_address_id AND public.outcome_counts_as_visit(status);

  UPDATE public.farm_addresses
  SET
    visited_count = COALESCE(v_visit_count, 0),
    last_visited_at = CASE
      WHEN v_visit_count > 0 THEN v_last_visit_at
      ELSE NULL
    END,
    last_touch_id = CASE
      WHEN v_latest_visit.farm_touch_id IS NOT NULL THEN v_latest_visit.farm_touch_id
      ELSE NULL
    END,
    last_outcome_status = CASE
      WHEN v_latest_visit.status IS NOT NULL THEN v_latest_visit.status
      ELSE NULL
    END
  WHERE id = v_farm_address_id;

  SELECT COUNT(*)
  INTO v_touch_homes_reached
  FROM public.farm_touch_addresses fta
  WHERE fta.farm_touch_id = p_farm_touch_id
    AND public.outcome_counts_as_visit(fta.status);

  UPDATE public.farm_touches
  SET
    homes_reached = v_touch_homes_reached,
    updated_at = now()
  WHERE id = p_farm_touch_id;

  RETURN jsonb_build_object(
    'farm_id', p_farm_id,
    'farm_touch_id', p_farm_touch_id,
    'farm_address_id', v_farm_address_id,
    'status', v_status,
    'visited_count', v_visit_count,
    'homes_reached', v_touch_homes_reached,
    'last_touch_id', CASE
      WHEN v_latest_visit.farm_touch_id IS NOT NULL THEN v_latest_visit.farm_touch_id
      ELSE NULL
    END,
    'last_outcome_status', CASE
      WHEN v_latest_visit.status IS NOT NULL THEN v_latest_visit.status
      ELSE NULL
    END
  );
END;
$$;

-- Old queued farm writes remain supported, with timestamp conflict protection.
REVOKE ALL ON FUNCTION public.apply_farm_address_outcome(uuid,uuid,uuid,uuid,text,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.record_farm_address_outcome(
  p_farm_id uuid,p_farm_touch_id uuid,p_farm_address_id uuid DEFAULT NULL,
  p_campaign_address_id uuid DEFAULT NULL,p_status text DEFAULT 'delivered',
  p_notes text DEFAULT NULL,p_occurred_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.apply_farm_address_outcome(p_farm_id,p_farm_touch_id,p_farm_address_id,
    p_campaign_address_id,p_status,p_notes,p_occurred_at,false)
$$;

-- Receipts bind retries to their original farm/touch as well as their campaign edit.
CREATE TABLE public.field_outcome_receipts (
  actor_id uuid NOT NULL, mutation_id text NOT NULL, request_hash text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, mutation_id)
);
ALTER TABLE public.field_outcome_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_outcome_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.v3_record_field_outcome(
  p_campaign_id uuid, p_campaign_address_ids uuid[], p_status text,
  p_notes text DEFAULT NULL, p_occurred_at timestamptz DEFAULT now(),
  p_session_id uuid DEFAULT NULL, p_session_target_id text DEFAULT NULL,
  p_session_event_type text DEFAULT NULL, p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL, p_client_mutation_id text DEFAULT NULL,
  p_base_revisions jsonb DEFAULT '{}'::jsonb, p_origin_platform text DEFAULT 'web',
  p_client_version text DEFAULT NULL, p_client_build integer DEFAULT NULL,
  p_override_reason text DEFAULT NULL, p_farm_id uuid DEFAULT NULL,
  p_farm_touch_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_ids uuid[]; v_id uuid; v_hash text;
  v_receipt public.field_outcome_receipts%ROWTYPE; v_result jsonb; v_child jsonb;
  v_revision bigint; v_farm uuid; v_touch uuid; v_session_campaign uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF nullif(trim(p_client_mutation_id),'') IS NULL THEN RAISE EXCEPTION 'CLIENT_MUTATION_ID_REQUIRED'; END IF;
  IF NOT public.can_view_campaign(p_campaign_id) THEN RAISE EXCEPTION 'Campaign access denied' USING ERRCODE='42501'; END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
    SELECT DISTINCT id FROM unnest(p_campaign_address_ids) AS input(id) WHERE id IS NOT NULL
  ) ids;
  IF coalesce(cardinality(v_ids),0)=0 THEN RAISE EXCEPTION 'CAMPAIGN_ADDRESS_IDS_REQUIRED'; END IF;
  IF (p_farm_id IS NULL) <> (p_farm_touch_id IS NULL) THEN RAISE EXCEPTION 'FARM_CONTEXT_REQUIRED'; END IF;
  IF p_occurred_at IS NULL THEN RAISE EXCEPTION 'Outcome timestamp required'; END IF;
  v_hash := md5(jsonb_build_object('campaign',p_campaign_id,'addresses',v_ids,'status',p_status,
    'notes',coalesce(p_notes,''),'occurred',p_occurred_at,'session',p_session_id,'target',p_session_target_id,
    'event',p_session_event_type,'lat',p_lat,'lon',p_lon,'revisions',p_base_revisions,
    'reason',coalesce(p_override_reason,''),'farm',p_farm_id,'touch',p_farm_touch_id)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_client_mutation_id,0));
  SELECT * INTO v_receipt FROM public.field_outcome_receipts
    WHERE actor_id=v_actor AND mutation_id=p_client_mutation_id;
  IF FOUND THEN
    IF v_receipt.request_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    RETURN v_receipt.result || jsonb_build_object('replayed',true);
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.farm_id,s.farm_touch_id,s.campaign_id INTO v_farm,v_touch,v_session_campaign
    FROM public.sessions s WHERE s.id=p_session_id AND s.user_id=v_actor;
    IF NOT FOUND OR v_session_campaign IS DISTINCT FROM p_campaign_id THEN RAISE EXCEPTION 'SESSION_ACCESS_DENIED'; END IF;
    IF v_farm IS DISTINCT FROM p_farm_id OR v_touch IS DISTINCT FROM p_farm_touch_id THEN
      RAISE EXCEPTION 'SESSION_FARM_CONTEXT_MISMATCH';
    END IF;
  END IF;
  IF p_farm_id IS NOT NULL THEN
    -- Stable lock order for simultaneous touch and aggregate edits.
    PERFORM 1 FROM public.farms f WHERE f.id=p_farm_id AND f.linked_campaign_id=p_campaign_id
      AND (f.owner_id=v_actor OR EXISTS(SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id=f.workspace_id AND wm.user_id=v_actor)) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Farm access or linked campaign mismatch' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.farm_touches WHERE id=p_farm_touch_id AND farm_id=p_farm_id
      AND (campaign_id IS NULL OR campaign_id=p_campaign_id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FARM_TOUCH_MISMATCH'; END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
      IF (SELECT count(*) FROM public.farm_addresses fa JOIN public.campaign_addresses ca ON ca.id=fa.campaign_address_id
          WHERE fa.farm_id=p_farm_id AND ca.id=v_id AND ca.campaign_id=p_campaign_id AND ca.deleted_at IS NULL) <> 1 THEN
        RAISE EXCEPTION 'FARM_ADDRESS_LINK_REQUIRED: resolve the farm home link before syncing';
      END IF;
    END LOOP;
  END IF;

  -- Single-address dispatch retains the original receipt key for queued pre-upgrade edits.
  IF cardinality(v_ids)=1 THEN
    v_child := public.v2_record_campaign_address_outcome(
      p_campaign_id,v_ids[1],p_status,p_notes,p_occurred_at,p_session_id,p_session_target_id,
      p_session_event_type,p_lat,p_lon,p_client_mutation_id,
      coalesce((p_base_revisions->>v_ids[1]::text)::bigint,0),p_origin_platform,p_client_version,
      p_client_build,p_override_reason,false);
    IF NOT coalesce((v_child->>'applied')::boolean,false) THEN RETURN v_child; END IF;
    v_result := jsonb_build_object('applied',true,'replayed',coalesce((v_child->>'replayed')::boolean,false),
      'canonical_state',jsonb_build_array(v_child),'error_code',NULL);
  ELSE
    v_result := public.v2_record_campaign_target_outcome(
      p_campaign_id,v_ids,p_status,p_notes,p_occurred_at,p_session_id,p_session_target_id,
      p_session_event_type,p_lat,p_lon,p_client_mutation_id,p_base_revisions,p_origin_platform,
      p_client_version,p_client_build,p_override_reason,false);
    IF NOT coalesce((v_result->>'applied')::boolean,false) THEN RETURN v_result; END IF;
  END IF;

  IF p_farm_id IS NOT NULL THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(v_result->'canonical_state') LOOP
      v_id := (v_child->'canonical_state'->>'campaign_address_id')::uuid;
      v_revision := (v_child->>'revision')::bigint;
      -- A pre-upgrade partial replay cannot restore obsolete farm state.
      IF NOT EXISTS(SELECT 1 FROM public.address_statuses WHERE campaign_address_id=v_id AND revision=v_revision) THEN
        RAISE EXCEPTION 'FARM_OUTCOME_CONFLICT: campaign state changed after the original save';
      END IF;
      PERFORM public.apply_farm_address_outcome(p_farm_id,p_farm_touch_id,NULL,v_id,p_status,p_notes,p_occurred_at,true);
    END LOOP;
  END IF;
  INSERT INTO public.field_outcome_receipts(actor_id,mutation_id,request_hash,result)
    VALUES(v_actor,p_client_mutation_id,v_hash,v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.v3_record_field_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v3_record_field_outcome(uuid,uuid[],text,text,timestamptz,uuid,text,text,double precision,double precision,text,jsonb,text,text,integer,text,uuid,uuid) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';

-- Report homes using the same outcome rules as the writer, not legacy roof statuses.
CREATE OR REPLACE FUNCTION public.rpc_get_campaign_stats(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_addresses integer; v_visited integer; v_contacted integer; v_scanned integer;
  v_buildings integer; v_contacts integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_campaign(p_campaign_id) THEN
    RAISE EXCEPTION 'Campaign access denied' USING ERRCODE='42501';
  END IF;
  SELECT count(*),
    count(*) FILTER(WHERE CASE WHEN ast.status IS NOT NULL THEN public.outcome_counts_as_visit(ast.status) ELSE coalesce(ca.visited,false) END),
    count(*) FILTER(WHERE ast.status IN ('talked','appointment','future_seller','hot_lead')),
    count(*) FILTER(WHERE coalesce(ca.scans,0)>0)
  INTO v_addresses,v_visited,v_contacted,v_scanned
  FROM public.campaign_addresses ca LEFT JOIN public.address_statuses ast ON ast.campaign_address_id=ca.id
  WHERE ca.campaign_id=p_campaign_id AND ca.deleted_at IS NULL;
  SELECT count(*) INTO v_buildings FROM public.buildings WHERE campaign_id=p_campaign_id;
  SELECT count(*) INTO v_contacts FROM public.contacts WHERE campaign_id=p_campaign_id;
  RETURN jsonb_build_object('addresses',v_addresses,'buildings',v_buildings,'visited',v_visited,
    'contacted',v_contacted,'contacts',v_contacts,'scanned',v_scanned,
    'scan_rate',CASE WHEN v_addresses>0 THEN round(v_scanned::numeric/v_addresses*100,1) ELSE 0 END,
    'progress_pct',CASE WHEN v_addresses>0 THEN round(v_visited::numeric/v_addresses*100,1) ELSE 0 END);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_get_campaign_stats(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_stats(uuid) TO authenticated,service_role;
