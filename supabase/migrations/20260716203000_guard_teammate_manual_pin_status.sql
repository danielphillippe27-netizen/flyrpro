-- A manual pin is protected from house-status writes by ordinary teammates from
-- the moment it is created, even before address_statuses has its first row.
-- Pin metadata remains collaborative and continues to use revision checks.

DO $$
BEGIN
  IF to_regprocedure(
    'public.v2_record_campaign_address_outcome_creator_unchecked(uuid,uuid,text,text,timestamp with time zone,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean)'
  ) IS NULL
  AND to_regprocedure(
    'public.v2_record_campaign_address_outcome(uuid,uuid,text,text,timestamp with time zone,uuid,text,text,double precision,double precision,text,bigint,text,text,integer,text,boolean)'
  ) IS NOT NULL THEN
    ALTER FUNCTION public.v2_record_campaign_address_outcome(
      uuid, uuid, text, text, timestamptz, uuid, text, text,
      double precision, double precision, text, bigint, text, text,
      integer, text, boolean
    ) RENAME TO v2_record_campaign_address_outcome_creator_unchecked;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.v2_record_campaign_address_outcome_creator_unchecked(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  double precision, double precision, text, bigint, text, text,
  integer, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_record_campaign_address_outcome_creator_unchecked(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  double precision, double precision, text, bigint, text, text,
  integer, text, boolean
) TO service_role;

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
  v_creator uuid;
  v_match_source text;
  v_is_manager boolean := false;
  v_reason text := nullif(trim(coalesce(p_override_reason, '')), '');
  v_mutation_id text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_platform text := lower(trim(coalesce(p_origin_platform, 'web')));
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_request_hash text;
  v_replay jsonb;
  v_response jsonb;
  v_current_state jsonb;
  v_current_revision bigint := 0;
  v_event_id uuid;
  v_error_code text;
BEGIN
  -- Let the canonical implementation retain all validation for ordinary homes
  -- and pins owned by the actor.
  SELECT ca.match_source, coalesce(ca.created_by, ca.updated_by)
  INTO v_match_source, v_creator
  FROM public.campaign_addresses ca
  WHERE ca.id = p_campaign_address_id
    AND ca.campaign_id = p_campaign_id
    AND ca.deleted_at IS NULL;

  IF v_match_source IS DISTINCT FROM 'field_manual_pin'
     OR v_creator IS NULL
     OR v_creator = v_actor THEN
    RETURN public.v2_record_campaign_address_outcome_creator_unchecked(
      p_campaign_id, p_campaign_address_id, p_status, p_notes, p_occurred_at,
      p_session_id, p_session_target_id, p_session_event_type, p_lat, p_lon,
      p_client_mutation_id, p_base_revision, p_origin_platform, p_client_version,
      p_client_build, p_override_reason, p_legacy_bridge
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'AUTH_REQUIRED');
  END IF;
  IF v_mutation_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'replayed', false, 'error_code', 'CLIENT_MUTATION_ID_REQUIRED');
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
    'base_revision', CASE WHEN p_legacy_bridge THEN NULL ELSE p_base_revision END,
    'override_reason', v_reason
  )::text);

  v_replay := public.campaign_mutation_replay(v_actor, v_mutation_id, v_request_hash);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  SELECT to_jsonb(ast), ast.revision
  INTO v_current_state, v_current_revision
  FROM public.address_statuses ast
  WHERE ast.campaign_address_id = p_campaign_address_id;

  IF NOT FOUND THEN
    v_current_revision := 0;
    v_current_state := jsonb_build_object(
      'campaign_address_id', p_campaign_address_id,
      'campaign_id', p_campaign_id,
      'status', 'none',
      'revision', 0
    );
  END IF;

  v_is_manager := public.can_manage_campaign(p_campaign_id, v_actor);
  IF NOT v_is_manager THEN
    v_error_code := 'TEAMMATE_STATUS_LOCKED';
  ELSIF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 200 THEN
    v_error_code := 'OVERRIDE_REASON_REQUIRED';
  END IF;

  IF v_error_code IS NOT NULL THEN
    v_response := jsonb_build_object(
      'applied', false,
      'replayed', false,
      'error_code', v_error_code,
      'canonical_state', v_current_state,
      'revision', v_current_revision,
      'event_id', NULL
    );
    INSERT INTO public.campaign_home_events(
      campaign_id, campaign_address_id, user_id, session_id, action_type, note,
      created_at, client_mutation_id, request_hash, origin_platform,
      client_version, client_build, base_revision, result_revision,
      applied_to_current, override_reason, result_state
    ) VALUES (
      p_campaign_id, p_campaign_address_id, v_actor, p_session_id,
      'status_rejected', p_notes, now(), v_mutation_id, v_request_hash,
      v_platform, p_client_version, p_client_build, p_base_revision,
      v_current_revision, false, v_reason, v_response
    ) RETURNING id INTO v_event_id;
    v_response := jsonb_set(v_response, '{event_id}', to_jsonb(v_event_id), true);
    UPDATE public.campaign_home_events SET result_state = v_response WHERE id = v_event_id;
    PERFORM public.store_campaign_mutation_receipt(
      v_actor, v_mutation_id, p_campaign_id, 'status', v_request_hash, v_response
    );
    RETURN v_response;
  END IF;

  -- The trigger below is the bypass-proof backstop. The local setting proves
  -- this manager supplied a valid reason through the versioned RPC.
  PERFORM set_config('wolfgrid.manual_pin_override_reason', v_reason, true);
  v_response := public.v2_record_campaign_address_outcome_creator_unchecked(
    p_campaign_id, p_campaign_address_id, p_status, p_notes, p_occurred_at,
    p_session_id, p_session_target_id, p_session_event_type, p_lat, p_lon,
    p_client_mutation_id, p_base_revision, p_origin_platform, p_client_version,
    p_client_build, p_override_reason, p_legacy_bridge
  );

  IF coalesce((v_response ->> 'applied')::boolean, false) THEN
    v_event_id := nullif(v_response ->> 'event_id', '')::uuid;
    UPDATE public.campaign_home_events
    SET action_type = 'manager_override', override_reason = v_reason
    WHERE id = v_event_id;
  END IF;
  RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.v2_record_campaign_address_outcome(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  double precision, double precision, text, bigint, text, text,
  integer, text, boolean
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_teammate_manual_pin_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_creator uuid;
  v_campaign_id uuid;
  v_match_source text;
  v_reason text := nullif(current_setting('wolfgrid.manual_pin_override_reason', true), '');
BEGIN
  SELECT ca.campaign_id, ca.match_source, coalesce(ca.created_by, ca.updated_by)
  INTO v_campaign_id, v_match_source, v_creator
  FROM public.campaign_addresses ca
  WHERE ca.id = NEW.campaign_address_id;

  IF v_match_source = 'field_manual_pin'
     AND v_creator IS NOT NULL
     AND v_actor IS DISTINCT FROM v_creator THEN
    IF NOT public.can_manage_campaign(v_campaign_id, v_actor) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAMMATE_STATUS_LOCKED';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 200 THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OVERRIDE_REASON_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_teammate_manual_pin_status_trigger ON public.address_statuses;
CREATE TRIGGER guard_teammate_manual_pin_status_trigger
BEFORE INSERT OR UPDATE OF status, last_action_by ON public.address_statuses
FOR EACH ROW EXECUTE FUNCTION public.guard_teammate_manual_pin_status();

COMMENT ON FUNCTION public.v2_record_campaign_address_outcome(
  uuid, uuid, text, text, timestamptz, uuid, text, text,
  double precision, double precision, text, bigint, text, text,
  integer, text, boolean
) IS 'Revisioned status mutation with creator-level protection for teammate manual pins.';
