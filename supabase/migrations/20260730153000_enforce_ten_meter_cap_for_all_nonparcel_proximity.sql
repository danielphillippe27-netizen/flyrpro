-- A multi-unit flag is not parcel evidence. All distance-only links must stay
-- within 10 metres; links supported by real parcel containment use the
-- parcel_verified/gold_parcel match types and are intentionally unaffected.

CREATE OR REPLACE FUNCTION public.guard_detached_proximity_link_distance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.match_type IN ('proximity_verified', 'proximity_fallback')
     AND COALESCE(NEW.distance_meters::double precision, 'Infinity'::double precision) > 10
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_detached_proximity_link_distance() IS
'Prevents every non-parcel proximity link beyond 10 m, including inferred or declared multi-address buildings. Parcel-verified links are unaffected.';
