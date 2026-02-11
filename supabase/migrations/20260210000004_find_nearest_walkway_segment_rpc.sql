-- RPC to find the nearest walkway segment for projection-based ordering
-- Used by BlockRoutingService for ordering addresses within a block

CREATE OR REPLACE FUNCTION public.find_nearest_walkway_segment(
  p_lon double precision,
  p_lat double precision,
  p_radius_m double precision DEFAULT 100
)
RETURNS TABLE(lon1 double precision, lat1 double precision, lon2 double precision, lat2 double precision, distance_m double precision)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    ST_X(ST_StartPoint(t.geom))::double precision as lon1,
    ST_Y(ST_StartPoint(t.geom))::double precision as lat1,
    ST_X(ST_EndPoint(t.geom))::double precision as lon2,
    ST_Y(ST_EndPoint(t.geom))::double precision as lat2,
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)::double precision as distance_m
  FROM public.overture_transportation t
  WHERE t.class IN ('footway', 'path', 'pedestrian', 'steps')
    AND ST_DWithin(
      t.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY 
    (CASE WHEN t.subclass IN ('sidewalk', 'crosswalk') THEN 0 ELSE 1 END),
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.find_nearest_walkway_segment IS 
'Find the nearest pedestrian walkway segment for projecting addresses onto. Returns segment endpoints and distance. Used for block-level address ordering.';
