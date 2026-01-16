-- RPC Function to find nearest transportation segment
-- Used by BuildingService for vector-based orientation

CREATE OR REPLACE FUNCTION public.find_nearest_transportation(
  p_lon double precision,
  p_lat double precision,
  p_radius double precision DEFAULT 100
)
RETURNS TABLE (
  gers_id text,
  geom geometry,
  class text,
  distance double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.gers_id,
    t.geom,
    t.class,
    ST_Distance(
      t.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
    ) as distance
  FROM public.overture_transportation t
  WHERE ST_DWithin(
    t.geom::geography,
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
    p_radius
  )
  ORDER BY distance
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_nearest_transportation IS 'Find the nearest transportation segment to a point for house orientation';


