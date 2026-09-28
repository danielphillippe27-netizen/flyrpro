-- Geometry-backed campaign stops keep the campaign_addresses identity used by
-- visits, notes, QR codes, and assignments. Enrichment only changes civic labels.
ALTER TABLE public.campaign_addresses
  ADD COLUMN IF NOT EXISTS geometry_target_kind text CHECK (geometry_target_kind IN ('building', 'parcel')),
  ADD COLUMN IF NOT EXISTS geometry_target_id text,
  ADD COLUMN IF NOT EXISTS geometry_target_geom jsonb,
  ADD COLUMN IF NOT EXISTS address_resolution_status text CHECK (address_resolution_status IN ('pending', 'confirmed', 'unresolved')),
  ADD COLUMN IF NOT EXISTS address_resolution_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address_resolution_next_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS address_resolution_lease uuid,
  ADD COLUMN IF NOT EXISTS address_resolution_error text,
  ADD COLUMN IF NOT EXISTS address_resolution_bundle_pending boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS campaign_address_enrichment_pending
  ON public.campaign_addresses (address_resolution_next_at, campaign_id)
  WHERE address_resolution_status = 'pending';

CREATE OR REPLACE FUNCTION public.claim_campaign_address_enrichment(p_limit integer DEFAULT 24)
RETURNS SETOF public.campaign_addresses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_campaign uuid;
BEGIN
  UPDATE campaign_addresses SET address_resolution_status = 'unresolved', address_resolution_lease = NULL,
    address_resolution_error = 'Address lookup did not finish after three attempts', address_resolution_bundle_pending = true
  WHERE address_resolution_status = 'pending' AND address_resolution_attempts >= 3 AND address_resolution_next_at <= now();
  SELECT campaign_id INTO v_campaign FROM campaign_addresses
  WHERE address_resolution_status = 'pending' AND address_resolution_next_at <= now()
    AND geometry_target_geom IS NOT NULL AND deleted_at IS NULL
  ORDER BY address_resolution_next_at, id LIMIT 1;
  IF v_campaign IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH batch AS (
    SELECT id FROM campaign_addresses
    WHERE campaign_id = v_campaign AND address_resolution_status = 'pending'
      AND address_resolution_next_at <= now() AND geometry_target_geom IS NOT NULL AND deleted_at IS NULL
    ORDER BY address_resolution_next_at, id
    LIMIT greatest(1, least(p_limit, 100)) FOR UPDATE SKIP LOCKED
  )
  UPDATE campaign_addresses a SET
    address_resolution_lease = gen_random_uuid(),
    address_resolution_next_at = now() + interval '5 minutes',
    address_resolution_attempts = address_resolution_attempts + 1
  FROM batch WHERE a.id = batch.id RETURNING a.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_campaign_address_enrichment(
  p_address_id uuid, p_lease uuid, p_result jsonb DEFAULT NULL,
  p_error text DEFAULT NULL, p_retry boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE a public.campaign_addresses%ROWTYPE; v_campaign uuid; v_duplicate boolean; v_valid boolean;
BEGIN
  SELECT campaign_id INTO v_campaign FROM campaign_addresses WHERE id = p_address_id;
  IF v_campaign IS NULL THEN RETURN false; END IF;
  -- Serialize civic identity checks within a campaign, including separate workers.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_campaign::text, 191800));
  SELECT * INTO a FROM campaign_addresses WHERE id = p_address_id FOR UPDATE;
  IF a.deleted_at IS NOT NULL OR a.address_resolution_status <> 'pending' OR a.address_resolution_lease IS DISTINCT FROM p_lease OR p_lease IS NULL THEN RETURN false; END IF;
  -- A rep may visit the stop while enrichment runs. Preserve all field state.
  -- A manually edited address/locked link, however, is authoritative.
  IF a.formatted IS DISTINCT FROM 'Address pending' OR nullif(a.house_number, '') IS NOT NULL
      OR nullif(a.street_name, '') IS NOT NULL OR coalesce(a.match_source, '') ILIKE '%manual%'
      OR EXISTS (SELECT 1 FROM building_address_links l WHERE l.campaign_id = a.campaign_id AND l.address_id = a.id
        AND (l.user_confirmed IS TRUE OR l.locked IS TRUE OR l.match_type ILIKE '%manual%')) THEN
    UPDATE campaign_addresses SET address_resolution_status = 'unresolved', address_resolution_lease = NULL,
      address_resolution_bundle_pending = true, address_resolution_error = 'Manual address or link retained' WHERE id = a.id;
    RETURN false;
  END IF;
  v_valid := p_result IS NOT NULL AND p_result->>'accuracy' IN ('rooftop', 'parcel')
    AND nullif(trim(p_result->>'house_number'), '') IS NOT NULL AND nullif(trim(p_result->>'street_name'), '') IS NOT NULL
    AND (upper(coalesce(p_result->>'region', '')) = upper(coalesce(a.region, ''))
      OR (a.region IN ('NZ','GB','AU','ZA') AND upper(coalesce(p_result->>'country','')) = a.region));
  IF v_valid THEN
    v_valid := ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(a.geometry_target_geom::text), 4326),
      ST_SetSRID(ST_MakePoint((p_result->>'longitude')::double precision, (p_result->>'latitude')::double precision), 4326));
  END IF;
  IF v_valid THEN
    SELECT EXISTS (SELECT 1 FROM campaign_addresses other WHERE other.campaign_id = a.campaign_id AND other.id <> a.id
      AND lower(regexp_replace(other.house_number, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(p_result->>'house_number', '[^a-zA-Z0-9]', '', 'g'))
      AND lower(regexp_replace(other.street_name, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(p_result->>'street_name', '[^a-zA-Z0-9]', '', 'g')))
    INTO v_duplicate;
    IF NOT v_duplicate THEN
      UPDATE campaign_addresses SET
        formatted = p_result->>'formatted', address = p_result->>'formatted',
        house_number = p_result->>'house_number', street_name = p_result->>'street_name',
        locality = coalesce(nullif(p_result->>'locality', ''), locality),
        postal_code = coalesce(nullif(p_result->>'postal_code', ''), postal_code),
        address_resolution_status = 'confirmed', address_resolution_lease = NULL, address_resolution_error = NULL, address_resolution_bundle_pending = true
      WHERE id = a.id;
      RETURN true;
    END IF;
  END IF;
  UPDATE campaign_addresses SET
    address_resolution_status = CASE WHEN p_retry AND a.address_resolution_attempts < 3 THEN 'pending' ELSE 'unresolved' END,
    address_resolution_next_at = now() + interval '5 minutes', address_resolution_lease = NULL, address_resolution_bundle_pending = true,
    address_resolution_error = left(coalesce(p_error, CASE WHEN v_duplicate THEN 'Address already belongs to another stop' ELSE 'No confident address match' END), 250)
  WHERE id = a.id;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_address_enrichment(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_campaign_address_enrichment(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_address_enrichment(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_campaign_address_enrichment(uuid, uuid, jsonb, text, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Native source coverage may improve between retries. Adopt a unique civic
-- address into its existing geometry stop instead of inserting a second stop.
CREATE OR REPLACE FUNCTION public.adopt_campaign_geometry_addresses(p_campaign_id uuid, p_addresses jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE item jsonb; candidate public.campaign_addresses%ROWTYPE; ids uuid[];
  remaining jsonb := '[]'::jsonb; point geometry; same_civic boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 191800));
  FOR item IN SELECT value FROM jsonb_array_elements(p_addresses) LOOP
    IF nullif(item->>'house_number', '') IS NULL OR nullif(item->>'street_name', '') IS NULL THEN
      remaining := remaining || jsonb_build_array(item); CONTINUE;
    END IF;
    point := ST_SetSRID(ST_MakePoint((item->>'lon')::double precision, (item->>'lat')::double precision),4326);
    SELECT array_agg(id) INTO ids FROM campaign_addresses a WHERE a.campaign_id = p_campaign_id
      AND a.geometry_target_geom IS NOT NULL
      AND ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON(a.geometry_target_geom::text),4326),point);
    IF coalesce(array_length(ids,1),0) <> 1 THEN
      remaining := remaining || jsonb_build_array(item); CONTINUE;
    END IF;
    SELECT * INTO candidate FROM campaign_addresses WHERE id = ids[1] FOR UPDATE;
    IF candidate.deleted_at IS NOT NULL THEN CONTINUE; END IF;
    same_civic := lower(trim(candidate.house_number)) = lower(trim(item->>'house_number'))
      AND lower(trim(candidate.street_name)) = lower(trim(item->>'street_name'));
    IF same_civic AND (candidate.formatted = item->>'formatted' OR (
      coalesce(item->>'formatted','') !~* '(unit|suite|apt|apartment|#|^[[:space:]]*[0-9]+[/-][0-9])'
      AND (SELECT count(*) FROM jsonb_array_elements(p_addresses) incoming
        WHERE lower(trim(incoming->>'house_number'))=lower(trim(item->>'house_number'))
          AND lower(trim(incoming->>'street_name'))=lower(trim(item->>'street_name'))) = 1)) THEN CONTINUE; END IF;
    IF candidate.formatted = 'Address pending' AND nullif(candidate.house_number,'') IS NULL
      AND nullif(candidate.street_name,'') IS NULL AND coalesce(candidate.match_source,'') NOT ILIKE '%manual%'
      AND upper(coalesce(candidate.region,'')) = upper(coalesce(item->>'region',''))
      AND NOT EXISTS (SELECT 1 FROM building_address_links l WHERE l.address_id=candidate.id
        AND (l.user_confirmed IS TRUE OR l.locked IS TRUE OR l.match_type ILIKE '%manual%'))
      -- Multi-unit source groups need explicit unit reconciliation, never collapse them.
      AND (SELECT count(*) FROM jsonb_array_elements(p_addresses) incoming
        WHERE lower(trim(incoming->>'house_number'))=lower(trim(item->>'house_number'))
          AND lower(trim(incoming->>'street_name'))=lower(trim(item->>'street_name'))) = 1
    THEN
      UPDATE campaign_addresses SET formatted=item->>'formatted', address=item->>'formatted',
        house_number=item->>'house_number', street_name=item->>'street_name',
        locality=coalesce(item->>'locality',locality), postal_code=coalesce(item->>'postal_code',postal_code),
        address_resolution_status='confirmed', address_resolution_lease=NULL,
        address_resolution_error=NULL, address_resolution_bundle_pending=true
      WHERE id=candidate.id;
    ELSE
      remaining := remaining || jsonb_build_array(item);
    END IF;
  END LOOP;
  RETURN remaining;
END;
$$;
REVOKE ALL ON FUNCTION public.adopt_campaign_geometry_addresses(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_campaign_geometry_addresses(uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Preserve ordinary field edits while reserving queue/provider metadata for the
-- backend. Table-level address UPDATE grants must not let clients forge it.
CREATE OR REPLACE FUNCTION public.guard_campaign_geometry_metadata()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.geometry_target_kind IS NOT NULL OR NEW.geometry_target_id IS NOT NULL
      OR NEW.geometry_target_geom IS NOT NULL OR NEW.address_resolution_status IS NOT NULL
      OR NEW.address_resolution_lease IS NOT NULL OR NEW.address_resolution_attempts <> 0
      OR NEW.address_resolution_error IS NOT NULL OR NEW.address_resolution_bundle_pending THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Geometry enrichment metadata is managed by the backend';
    END IF;
  ELSIF ROW(NEW.geometry_target_kind,NEW.geometry_target_id,NEW.geometry_target_geom,NEW.address_resolution_status,
      NEW.address_resolution_attempts,NEW.address_resolution_next_at,NEW.address_resolution_lease,
      NEW.address_resolution_error,NEW.address_resolution_bundle_pending)
    IS DISTINCT FROM ROW(OLD.geometry_target_kind,OLD.geometry_target_id,OLD.geometry_target_geom,OLD.address_resolution_status,
      OLD.address_resolution_attempts,OLD.address_resolution_next_at,OLD.address_resolution_lease,
      OLD.address_resolution_error,OLD.address_resolution_bundle_pending) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Geometry enrichment metadata is managed by the backend';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS campaign_geometry_metadata_guard ON public.campaign_addresses;
CREATE TRIGGER campaign_geometry_metadata_guard BEFORE INSERT OR UPDATE ON public.campaign_addresses
FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_geometry_metadata();
