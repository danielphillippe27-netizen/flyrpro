-- Detached-neighbourhood safety guard.
--
-- The canonical application linker uses the same policy:
--   <= 10 m  automatic semantic proximity is allowed
--   10-12 m  leave unlinked for review
--   > 12 m   leave unlinked for reverse-geocode reconciliation
--
-- Parcel and containment links are intentionally unaffected. Reverse-geocode
-- reconciliation also uses its own high-confidence match type and is unaffected.

CREATE OR REPLACE FUNCTION public.guard_detached_proximity_link_distance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.match_type IN ('proximity_verified', 'proximity_fallback')
     AND COALESCE(NEW.is_multi_unit, false) = false
     AND COALESCE(NEW.distance_meters::double precision, 'Infinity'::double precision) > 10
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_detached_proximity_link_distance
  ON public.building_address_links;

CREATE TRIGGER guard_detached_proximity_link_distance
BEFORE INSERT ON public.building_address_links
FOR EACH ROW
EXECUTE FUNCTION public.guard_detached_proximity_link_distance();

CREATE OR REPLACE FUNCTION public.guard_gold_proximity_link_distance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_distance_meters double precision;
BEGIN
  IF NEW.match_source = 'gold_proximity'
     AND NEW.building_id IS NOT NULL
     AND NEW.geom IS NOT NULL
  THEN
    SELECT ST_Distance(NEW.geom::geography, building.geom::geography)
      INTO v_distance_meters
    FROM public.ref_buildings_gold building
    WHERE building.id = NEW.building_id;

    IF v_distance_meters IS NULL OR v_distance_meters > 10 THEN
      NEW.building_id := NULL;
      NEW.building_gers_id := NULL;
      NEW.match_source := NULL;
      NEW.confidence := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_gold_proximity_link_distance
  ON public.campaign_addresses;

CREATE TRIGGER guard_gold_proximity_link_distance
BEFORE UPDATE OF building_id, match_source ON public.campaign_addresses
FOR EACH ROW
EXECUTE FUNCTION public.guard_gold_proximity_link_distance();

COMMENT ON FUNCTION public.guard_detached_proximity_link_distance() IS
'Prevents new distance-only/semantic building links beyond 10 m; those addresses remain unlinked for review or reverse-geocode reconciliation.';

COMMENT ON FUNCTION public.guard_gold_proximity_link_distance() IS
'Applies the same 10 m automatic proximity ceiling to legacy Gold linker updates.';
