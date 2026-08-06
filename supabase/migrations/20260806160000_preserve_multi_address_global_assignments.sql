-- Apply global reverse-geocode assignments per address. A building may own
-- multiple civic addresses; assigning one address must never evict its sibling
-- links. The public wrapper installed by 20260730214500 continues to call this
-- core and then synchronizes address_orphans.

CREATE OR REPLACE FUNCTION public.apply_global_reverse_assignment_core(
  p_campaign_id uuid,
  p_run_id uuid,
  p_assignments jsonb,
  p_algorithm_version text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_count integer;
  v_affected_address_ids uuid[];
  v_before_state jsonb;
  v_active_links_before integer;
  v_active_links_after integer;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));

  SELECT count(*) INTO v_active_links_before
  FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND coalesce(link_state, 'active') = 'active';

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.global_reverse_assignments (
    decision_id uuid PRIMARY KEY,
    address_id uuid NOT NULL UNIQUE,
    building_id text NOT NULL,
    score double precision NOT NULL,
    evidence_codes text[] NOT NULL,
    source_longitude double precision NOT NULL,
    source_latitude double precision NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.global_reverse_assignments;

  INSERT INTO pg_temp.global_reverse_assignments (
    decision_id,
    address_id,
    building_id,
    score,
    evidence_codes,
    source_longitude,
    source_latitude
  )
  SELECT
    (item->>'decision_id')::uuid,
    (item->>'address_id')::uuid,
    item->>'building_id',
    (item->>'score')::double precision,
    ARRAY(
      SELECT jsonb_array_elements_text(coalesce(item->'evidence_codes', '[]'::jsonb))
    ),
    (item->>'source_longitude')::double precision,
    (item->>'source_latitude')::double precision
  FROM jsonb_array_elements(p_assignments) AS item;

  SELECT count(*) INTO v_assignment_count
  FROM pg_temp.global_reverse_assignments;
  IF v_assignment_count <> jsonb_array_length(p_assignments) THEN
    RAISE EXCEPTION 'Global assignment contains duplicate or invalid rows';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.global_reverse_assignments
    WHERE source_longitude NOT BETWEEN -180 AND 180
       OR source_latitude NOT BETWEEN -90 AND 90
  ) THEN
    RAISE EXCEPTION 'Global assignment contains invalid source coordinates';
  END IF;

  IF (
    SELECT count(*)
    FROM public.map_reconciliation_decisions decision
    JOIN pg_temp.global_reverse_assignments assignment
      ON assignment.decision_id = decision.id
    WHERE decision.run_id = p_run_id
      AND decision.campaign_id = p_campaign_id
      AND decision.status = 'proposed'
      AND decision.action IN ('link_address', 'reassign_address')
      AND decision.address_id = assignment.address_id
      AND decision.building_id = assignment.building_id
      AND coalesce((decision.proposed_state->>'global_assignment')::boolean, false)
      AND coalesce((decision.proposed_state->>'move_source')::boolean, false)
  ) <> v_assignment_count THEN
    RAISE EXCEPTION 'Global assignment decisions are stale or inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.campaign_addresses address
    JOIN pg_temp.global_reverse_assignments assignment
      ON assignment.address_id = address.id
    WHERE address.campaign_id = p_campaign_id
      AND (
        address.visited IS TRUE OR
        coalesce(address.match_source, '') ~* 'manual|field_'
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.building_address_links link
    WHERE link.campaign_id = p_campaign_id
      AND (
        link.address_id IN (
          SELECT address_id FROM pg_temp.global_reverse_assignments
        ) OR
        link.building_id IN (
          SELECT building_id FROM pg_temp.global_reverse_assignments
        )
      )
      AND (
        coalesce(link.match_type, '') ~* 'manual' OR
        link.user_confirmed IS TRUE OR
        link.locked IS TRUE
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.building_touches touch
    WHERE touch.campaign_id = p_campaign_id
      AND (
        touch.address_id IN (
          SELECT address_id FROM pg_temp.global_reverse_assignments
        ) OR
        touch.building_id IN (
          SELECT building_id FROM pg_temp.global_reverse_assignments
        )
      )
  ) THEN
    RAISE EXCEPTION 'Global assignment intersects protected field history';
  END IF;

  -- Only assigned addresses are mutable. Never include every existing address
  -- on a target building: those are valid sibling links, not collateral rows.
  SELECT array_agg(address_id)
  INTO v_affected_address_ids
  FROM pg_temp.global_reverse_assignments;

  SELECT jsonb_build_object(
    'links', coalesce((
      SELECT jsonb_agg(to_jsonb(link))
      FROM public.building_address_links link
      WHERE link.campaign_id = p_campaign_id
        AND link.address_id = ANY(v_affected_address_ids)
    ), '[]'::jsonb),
    'addresses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', address.id,
        'building_id', address.building_id,
        'building_gers_id', address.building_gers_id,
        'match_source', address.match_source,
        'confidence', address.confidence,
        'original_longitude', CASE
          WHEN address.geom IS NULL THEN NULL
          ELSE ST_X(address.geom)
        END,
        'original_latitude', CASE
          WHEN address.geom IS NULL THEN NULL
          ELSE ST_Y(address.geom)
        END,
        'coordinate', address.coordinate
      ))
      FROM public.campaign_addresses address
      WHERE address.campaign_id = p_campaign_id
        AND address.id = ANY(v_affected_address_ids)
    ), '[]'::jsonb),
    'orphans', coalesce((
      SELECT jsonb_agg(to_jsonb(orphan))
      FROM public.address_orphans orphan
      WHERE orphan.campaign_id = p_campaign_id
        AND orphan.address_id = ANY(v_affected_address_ids)
    ), '[]'::jsonb)
  ) INTO v_before_state;

  INSERT INTO public.map_reconciliation_global_batches (
    run_id,
    campaign_id,
    algorithm_version,
    before_state,
    assignments
  ) VALUES (
    p_run_id,
    p_campaign_id,
    p_algorithm_version,
    v_before_state,
    p_assignments
  )
  ON CONFLICT (run_id) DO NOTHING;

  DELETE FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND address_id = ANY(v_affected_address_ids);

  UPDATE public.campaign_addresses
  SET
    building_id = NULL,
    building_gers_id = NULL,
    match_source = NULL,
    confidence = NULL,
    updated_at = now()
  WHERE campaign_id = p_campaign_id
    AND id = ANY(v_affected_address_ids);

  INSERT INTO public.building_address_links (
    campaign_id,
    address_id,
    building_id,
    match_type,
    confidence,
    distance_meters,
    reconciliation_decision_id,
    evidence_codes,
    link_state,
    reconciliation_version
  )
  SELECT
    p_campaign_id,
    assignment.address_id,
    assignment.building_id,
    'reconciliation',
    assignment.score,
    0,
    assignment.decision_id,
    assignment.evidence_codes,
    'active',
    p_algorithm_version
  FROM pg_temp.global_reverse_assignments assignment;

  UPDATE public.campaign_addresses address
  SET
    geom = ST_SetSRID(
      ST_MakePoint(assignment.source_longitude, assignment.source_latitude),
      4326
    ),
    coordinate = jsonb_build_object(
      'longitude', assignment.source_longitude,
      'latitude', assignment.source_latitude,
      'lon', assignment.source_longitude,
      'lat', assignment.source_latitude
    ),
    building_id = CASE
      WHEN assignment.building_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN assignment.building_id::uuid
      ELSE NULL
    END,
    building_gers_id = assignment.building_id,
    match_source = 'reconciliation_reverse_geocode',
    confidence = assignment.score,
    updated_at = now()
  FROM pg_temp.global_reverse_assignments assignment
  WHERE address.campaign_id = p_campaign_id
    AND address.id = assignment.address_id;

  DELETE FROM public.address_orphans
  WHERE campaign_id = p_campaign_id
    AND address_id IN (
      SELECT address_id FROM pg_temp.global_reverse_assignments
    );

  UPDATE public.map_reconciliation_decisions decision
  SET
    status = 'applied',
    applied_at = now()
  FROM pg_temp.global_reverse_assignments assignment
  WHERE decision.id = assignment.decision_id;

  SELECT count(*) INTO v_active_links_after
  FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND coalesce(link_state, 'active') = 'active';

  IF v_active_links_after < v_active_links_before THEN
    RAISE EXCEPTION
      'Global assignment would reduce active campaign links from % to %',
      v_active_links_before,
      v_active_links_after;
  END IF;

  RETURN v_assignment_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_global_reverse_assignment_core(
  uuid, uuid, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_global_reverse_assignment_core(
  uuid, uuid, jsonb, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
