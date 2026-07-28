-- Atomic, reversible source-coordinate corrections backed by strong reverse
-- geocoding evidence. Imported provider provenance remains in `source`; the
-- corrected campaign geometry is tracked here and can be restored exactly.

ALTER TABLE public.building_address_links
  DROP CONSTRAINT IF EXISTS building_address_links_match_type_check;

ALTER TABLE public.building_address_links
  ADD CONSTRAINT building_address_links_match_type_check
  CHECK (
    match_type IN (
      'containment_verified',
      'containment_suspect',
      'containment',
      'point_on_surface',
      'parcel_verified',
      'parcel_bridge',
      'proximity_verified',
      'proximity_fallback',
      'nearest_building_15m',
      'manual',
      'orphan',
      'reconciliation'
    )
  );

CREATE TABLE IF NOT EXISTS public.campaign_address_source_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  address_id uuid NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
  building_id text NOT NULL,
  decision_id uuid NOT NULL UNIQUE
    REFERENCES public.map_reconciliation_decisions(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_accuracy text NOT NULL CHECK (provider_accuracy IN ('rooftop', 'parcel')),
  reverse_cache_key text REFERENCES public.reverse_geocode_cache(cache_key) ON DELETE SET NULL,
  algorithm_version text NOT NULL,
  original_geom geometry(Point, 4326) NOT NULL,
  original_coordinate jsonb,
  original_match_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  orphan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  orphan_coordinate geometry(Point, 4326),
  corrected_geom geometry(Point, 4326) NOT NULL,
  corrected_coordinate jsonb NOT NULL,
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'rolled_back')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz
);

CREATE INDEX IF NOT EXISTS campaign_address_source_corrections_campaign_idx
  ON public.campaign_address_source_corrections(campaign_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS campaign_address_source_corrections_address_idx
  ON public.campaign_address_source_corrections(address_id, applied_at DESC);

ALTER TABLE public.campaign_address_source_corrections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apply_reverse_geocode_orphan_correction(
  p_campaign_id uuid,
  p_address_id uuid,
  p_building_id text,
  p_decision_id uuid,
  p_expected_lon double precision,
  p_expected_lat double precision,
  p_corrected_lon double precision,
  p_corrected_lat double precision,
  p_provider text,
  p_accuracy text,
  p_reverse_cache_key text,
  p_score double precision,
  p_evidence_codes text[],
  p_algorithm_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_address public.campaign_addresses%ROWTYPE;
  v_orphan public.address_orphans%ROWTYPE;
  v_expected geometry(Point, 4326);
  v_corrected geometry(Point, 4326);
  v_decision public.map_reconciliation_decisions%ROWTYPE;
BEGIN
  IF p_accuracy NOT IN ('rooftop', 'parcel') THEN
    RETURN false;
  END IF;
  IF p_corrected_lon NOT BETWEEN -180 AND 180 OR p_corrected_lat NOT BETWEEN -90 AND 90 THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_decision
  FROM public.map_reconciliation_decisions
  WHERE id = p_decision_id
    AND campaign_id = p_campaign_id
    AND address_id = p_address_id
    AND building_id = p_building_id
    AND action = 'link_address'
    AND status = 'proposed'
  FOR UPDATE;
  IF NOT FOUND OR coalesce((v_decision.proposed_state->>'move_source')::boolean, false) IS NOT true THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_address
  FROM public.campaign_addresses
  WHERE campaign_id = p_campaign_id
    AND id = p_address_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_address.geom IS NULL OR v_address.visited IS TRUE THEN
    RETURN false;
  END IF;
  IF coalesce(v_address.match_source, '') ~* 'manual|field_' THEN
    RETURN false;
  END IF;
  IF v_address.building_id IS NOT NULL OR nullif(v_address.building_gers_id, '') IS NOT NULL THEN
    RETURN false;
  END IF;

  SELECT *
  INTO v_orphan
  FROM public.address_orphans
  WHERE campaign_id = p_campaign_id
    AND address_id = p_address_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.building_address_links
    WHERE campaign_id = p_campaign_id
      AND address_id = p_address_id
      AND coalesce(link_state, 'active') = 'active'
  ) THEN
    RETURN false;
  END IF;

  v_expected := ST_SetSRID(ST_MakePoint(p_expected_lon, p_expected_lat), 4326);
  v_corrected := ST_SetSRID(ST_MakePoint(p_corrected_lon, p_corrected_lat), 4326);
  IF NOT ST_DWithin(v_address.geom::geography, v_expected::geography, 1.0) THEN
    RETURN false;
  END IF;

  INSERT INTO public.campaign_address_source_corrections (
    campaign_id,
    address_id,
    building_id,
    decision_id,
    provider,
    provider_accuracy,
    reverse_cache_key,
    algorithm_version,
    original_geom,
    original_coordinate,
    original_match_state,
    orphan_snapshot,
    orphan_coordinate,
    corrected_geom,
    corrected_coordinate
  ) VALUES (
    p_campaign_id,
    p_address_id,
    p_building_id,
    p_decision_id,
    p_provider,
    p_accuracy,
    p_reverse_cache_key,
    p_algorithm_version,
    v_address.geom,
    v_address.coordinate,
    jsonb_build_object(
      'building_id', v_address.building_id,
      'building_gers_id', v_address.building_gers_id,
      'match_source', v_address.match_source,
      'confidence', v_address.confidence
    ),
    to_jsonb(v_orphan) - 'coordinate',
    v_orphan.coordinate,
    v_corrected,
    jsonb_build_object(
      'longitude', p_corrected_lon,
      'latitude', p_corrected_lat,
      'lon', p_corrected_lon,
      'lat', p_corrected_lat
    )
  );

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
  ) VALUES (
    p_campaign_id,
    p_address_id,
    p_building_id,
    'reconciliation',
    p_score,
    0,
    p_decision_id,
    coalesce(p_evidence_codes, '{}'::text[]),
    'active',
    p_algorithm_version
  )
  ON CONFLICT (campaign_id, address_id) DO UPDATE SET
    building_id = EXCLUDED.building_id,
    match_type = EXCLUDED.match_type,
    confidence = EXCLUDED.confidence,
    distance_meters = EXCLUDED.distance_meters,
    reconciliation_decision_id = EXCLUDED.reconciliation_decision_id,
    evidence_codes = EXCLUDED.evidence_codes,
    link_state = EXCLUDED.link_state,
    reconciliation_version = EXCLUDED.reconciliation_version;

  UPDATE public.campaign_addresses
  SET
    geom = v_corrected,
    coordinate = jsonb_build_object(
      'longitude', p_corrected_lon,
      'latitude', p_corrected_lat,
      'lon', p_corrected_lon,
      'lat', p_corrected_lat
    ),
    building_id = CASE
      WHEN p_building_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN p_building_id::uuid
      ELSE NULL
    END,
    building_gers_id = p_building_id,
    match_source = 'reconciliation_reverse_geocode',
    confidence = p_score,
    updated_at = now()
  WHERE campaign_id = p_campaign_id AND id = p_address_id;

  DELETE FROM public.address_orphans
  WHERE campaign_id = p_campaign_id AND address_id = p_address_id;

  UPDATE public.map_reconciliation_decisions
  SET status = 'applied', applied_at = now()
  WHERE id = p_decision_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_reverse_geocode_orphan_correction(
  p_decision_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correction public.campaign_address_source_corrections%ROWTYPE;
  v_original jsonb;
BEGIN
  SELECT *
  INTO v_correction
  FROM public.campaign_address_source_corrections
  WHERE decision_id = p_decision_id
    AND status = 'applied'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.campaign_addresses
    WHERE campaign_id = v_correction.campaign_id
      AND id = v_correction.address_id
      AND (
        visited IS TRUE OR
        coalesce(match_source, '') ~* 'manual|field_'
      )
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.building_address_links
  WHERE campaign_id = v_correction.campaign_id
    AND address_id = v_correction.address_id
    AND reconciliation_decision_id = p_decision_id;

  v_original := v_correction.original_match_state;
  UPDATE public.campaign_addresses
  SET
    geom = v_correction.original_geom,
    coordinate = v_correction.original_coordinate,
    building_id = nullif(v_original->>'building_id', '')::uuid,
    building_gers_id = nullif(v_original->>'building_gers_id', ''),
    match_source = nullif(v_original->>'match_source', ''),
    confidence = nullif(v_original->>'confidence', '')::double precision,
    updated_at = now()
  WHERE campaign_id = v_correction.campaign_id
    AND id = v_correction.address_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.address_orphans WHERE address_id = v_correction.address_id
  ) THEN
    INSERT INTO public.address_orphans
    SELECT restored.*
    FROM jsonb_populate_record(
      NULL::public.address_orphans,
      v_correction.orphan_snapshot
    ) AS restored;
    UPDATE public.address_orphans
    SET coordinate = v_correction.orphan_coordinate
    WHERE address_id = v_correction.address_id;
  END IF;

  UPDATE public.campaign_address_source_corrections
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE id = v_correction.id;

  UPDATE public.map_reconciliation_decisions
  SET
    status = 'rolled_back',
    rolled_back_at = now(),
    reviewed_at = now()
  WHERE id = p_decision_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_reverse_geocode_orphan_correction(
  uuid, uuid, text, uuid, double precision, double precision,
  double precision, double precision, text, text, text,
  double precision, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_reverse_geocode_orphan_correction(
  uuid, uuid, text, uuid, double precision, double precision,
  double precision, double precision, text, text, text,
  double precision, text[], text
) TO service_role;

REVOKE ALL ON FUNCTION public.rollback_reverse_geocode_orphan_correction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rollback_reverse_geocode_orphan_correction(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
