-- Snap point(s) to nearest Overture pedestrian walkway (sidewalk, footway, crosswalk).
-- Used so route waypoints target the sidewalk instead of the building centroid.
-- Requires overture_transportation populated with class from Overture (sidewalk, footway, crosswalk).

-- Single point: returns one row (lon, lat) or no row if no walkway in radius.
CREATE OR REPLACE FUNCTION public.snap_point_to_walkway(
  p_lon double precision,
  p_lat double precision,
  p_radius_m double precision DEFAULT 50
)
RETURNS TABLE(lon double precision, lat double precision)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ST_X(closest)::double precision AS lon,
    ST_Y(closest)::double precision AS lat
  FROM (
    SELECT ST_ClosestPoint(
      t.geom,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
    ) AS closest
    FROM public.overture_transportation t
    WHERE t.class IN ('sidewalk', 'footway', 'crosswalk')
      AND ST_DWithin(
        t.geom::geography,
        ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
        p_radius_m
      )
    ORDER BY ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
    LIMIT 1
  ) sub;
$$;

COMMENT ON FUNCTION public.snap_point_to_walkway IS 'Snap a single point to the nearest pedestrian walkway (sidewalk/footway/crosswalk) within radius_m. Returns empty if no walkway in range.';

-- Batch: p_points is jsonb array of { "lon": number, "lat": number }.
-- Returns jsonb array of { "lon": number, "lat": number } in same order; uses original point when no snap found.
CREATE OR REPLACE FUNCTION public.snap_points_to_walkways(
  p_points jsonb,
  p_radius_m double precision DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pt jsonb;
  i int;
  out_arr jsonb := '[]'::jsonb;
  p_geom geography;
  snapped_lon double precision;
  snapped_lat double precision;
BEGIN
  IF p_points IS NULL OR jsonb_array_length(p_points) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR i IN 0 .. (jsonb_array_length(p_points) - 1) LOOP
    pt := p_points->i;
    p_geom := ST_SetSRID(
      ST_MakePoint((pt->>'lon')::double precision, (pt->>'lat')::double precision),
      4326
    )::geography;

    SELECT ST_X(closest), ST_Y(closest)
    INTO snapped_lon, snapped_lat
    FROM (
      SELECT ST_ClosestPoint(t.geom, p_geom::geometry) AS closest
      FROM public.overture_transportation t
      WHERE t.class IN ('sidewalk', 'footway', 'crosswalk')
        AND ST_DWithin(t.geom::geography, p_geom, p_radius_m)
      ORDER BY ST_Distance(t.geom::geography, p_geom)
      LIMIT 1
    ) sub;

    IF snapped_lon IS NOT NULL AND snapped_lat IS NOT NULL THEN
      out_arr := out_arr || jsonb_build_object('lon', snapped_lon, 'lat', snapped_lat);
    ELSE
      out_arr := out_arr || jsonb_build_object('lon', (pt->>'lon')::double precision, 'lat', (pt->>'lat')::double precision);
    END IF;
  END LOOP;

  RETURN out_arr;
END;
$$;

COMMENT ON FUNCTION public.snap_points_to_walkways IS 'Snap multiple points to nearest pedestrian walkways. Input: jsonb array of {lon, lat}. Output: same-order array; original point used when no walkway in radius.';
