-- Paid fallback applies only to campaigns with zero initial saved addresses.
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS address_resolution_permanent_allowed boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.claim_campaign_address_enrichment(p_limit integer DEFAULT 24)
RETURNS SETOF public.campaign_addresses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_campaign uuid;
BEGIN
  UPDATE campaign_addresses SET address_resolution_status = 'unresolved', address_resolution_lease = NULL,
    address_resolution_error = 'Address lookup did not finish after three attempts', address_resolution_bundle_pending = true
  WHERE address_resolution_permanent_allowed IS TRUE AND address_resolution_status = 'pending' AND address_resolution_attempts >= 3 AND address_resolution_next_at <= now();
  SELECT campaign_id INTO v_campaign FROM campaign_addresses
  WHERE address_resolution_permanent_allowed IS TRUE AND address_resolution_status = 'pending' AND address_resolution_next_at <= now()
    AND geometry_target_geom IS NOT NULL AND deleted_at IS NULL
  ORDER BY address_resolution_next_at, id LIMIT 1;
  IF v_campaign IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH batch AS (
    SELECT id FROM campaign_addresses
    WHERE address_resolution_permanent_allowed IS TRUE AND campaign_id = v_campaign AND address_resolution_status = 'pending'
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

CREATE OR REPLACE FUNCTION public.guard_campaign_geometry_metadata()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.address_resolution_permanent_allowed OR NEW.geometry_target_kind IS NOT NULL OR NEW.geometry_target_id IS NOT NULL
      OR NEW.geometry_target_geom IS NOT NULL OR NEW.address_resolution_status IS NOT NULL
      OR NEW.address_resolution_lease IS NOT NULL OR NEW.address_resolution_attempts <> 0
      OR NEW.address_resolution_error IS NOT NULL OR NEW.address_resolution_bundle_pending THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Geometry enrichment metadata is managed by the backend';
    END IF;
  ELSIF ROW(NEW.address_resolution_permanent_allowed,NEW.geometry_target_kind,NEW.geometry_target_id,NEW.geometry_target_geom,NEW.address_resolution_status,
      NEW.address_resolution_attempts,NEW.address_resolution_next_at,NEW.address_resolution_lease,
      NEW.address_resolution_error,NEW.address_resolution_bundle_pending)
    IS DISTINCT FROM ROW(OLD.address_resolution_permanent_allowed,OLD.geometry_target_kind,OLD.geometry_target_id,OLD.geometry_target_geom,OLD.address_resolution_status,
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

NOTIFY pgrst, 'reload schema';
