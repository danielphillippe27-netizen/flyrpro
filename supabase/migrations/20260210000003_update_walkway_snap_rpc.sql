-- Update walkway snapping RPCs with expanded Tier 1 classes and prioritization
-- 
-- Changes from previous version:
-- - Tier 1 walk network expanded from ('sidewalk', 'footway', 'crosswalk') to 
--   ('footway', 'path', 'pedestrian', 'steps') to match Overture schema correctly
-- - Sidewalk/crosswalk are now matched as class='footway' with subclass IN ('sidewalk', 'crosswalk')
-- - Prioritization: sidewalk/crosswalk segments are preferred over generic footway/path
-- - Added optional p_use_road_fallback parameter for Tier 2 (residential/service roads)

-- Drop existing functions to recreate with new signature
DROP FUNCTION IF EXISTS public.snap_point_to_walkway(double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.snap_points_to_walkways(jsonb, double precision);

-- Single point: returns one row (lon, lat) or no row if no walkway in radius.
-- 
-- Tier 1 (walk network): class IN ('footway', 'path', 'pedestrian', 'steps')
-- Tier 2 (optional fallback): class IN ('residential', 'service') - only if p_use_road_fallback = true
-- 
-- Prioritization within Tier 1: sidewalk/crosswalk subclasses preferred, then by distance
CREATE OR REPLACE FUNCTION public.snap_point_to_walkway(
  p_lon double precision,
  p_lat double precision,
  p_radius_m double precision DEFAULT 50,
  p_use_road_fallback boolean DEFAULT false
)
RETURNS TABLE(lon double precision, lat double precision)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  point_geography geography;
  result_row RECORD;
BEGIN
  -- Convert input point to geography for distance calculations
  point_geography := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;
  
  -- Tier 1: Walk network - expanded classes with subclass prioritization
  SELECT 
    ST_X(closest)::double precision AS result_lon,
    ST_Y(closest)::double precision AS result_lat
  INTO result_row
  FROM (
    SELECT ST_ClosestPoint(t.geom, point_geography::geometry) AS closest
    FROM public.overture_transportation t
    WHERE t.class IN ('footway', 'path', 'pedestrian', 'steps')
      AND ST_DWithin(t.geom::geography, point_geography, p_radius_m)
    -- Prioritize sidewalk/crosswalk over generic footway/path, then by distance
    ORDER BY 
      (CASE WHEN t.subclass IN ('sidewalk', 'crosswalk') THEN 0 ELSE 1 END),
      ST_Distance(t.geom::geography, point_geography)
    LIMIT 1
  ) sub;
  
  -- Return Tier 1 result if found
  IF result_row.result_lon IS NOT NULL AND result_row.result_lat IS NOT NULL THEN
    lon := result_row.result_lon;
    lat := result_row.result_lat;
    RETURN NEXT;
    RETURN;
  END IF;
  
  -- Tier 2: Optional fallback to road centerlines
  IF p_use_road_fallback THEN
    SELECT 
      ST_X(closest)::double precision AS result_lon,
      ST_Y(closest)::double precision AS result_lat
    INTO result_row
    FROM (
      SELECT ST_ClosestPoint(t.geom, point_geography::geometry) AS closest
      FROM public.overture_transportation t
      WHERE t.class IN ('residential', 'service')
        AND ST_DWithin(t.geom::geography, point_geography, p_radius_m)
      ORDER BY ST_Distance(t.geom::geography, point_geography)
      LIMIT 1
    ) sub;
    
    IF result_row.result_lon IS NOT NULL AND result_row.result_lat IS NOT NULL THEN
      lon := result_row.result_lon;
      lat := result_row.result_lat;
      RETURN NEXT;
    END IF;
  END IF;
  
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.snap_point_to_walkway IS 
'Snap a single point to the nearest pedestrian walkway within radius_m. Tier 1: footway, path, pedestrian, steps (prioritizes sidewalk/crosswalk subclass). Optional Tier 2 fallback: residential/service roads when p_use_road_fallback=true. Returns empty if no walkway in range.';

-- Batch: p_points is jsonb array of { "lon": number, "lat": number }.
-- Returns jsonb array of { "lon": number, "lat": number } in same order; uses original point when no snap found.
CREATE OR REPLACE FUNCTION public.snap_points_to_walkways(
  p_points jsonb,
  p_radius_m double precision DEFAULT 50,
  p_use_road_fallback boolean DEFAULT false
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
  point_geography geography;
  snapped_lon double precision;
  snapped_lat double precision;
  result_found boolean;
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

    result_found := false;
    
    -- Tier 1: Walk network with prioritization
    SELECT ST_X(closest), ST_Y(closest)
    INTO snapped_lon, snapped_lat
    FROM (
      SELECT ST_ClosestPoint(t.geom, p_geom::geometry) AS closest
      FROM public.overture_transportation t
      WHERE t.class IN ('footway', 'path', 'pedestrian', 'steps')
        AND ST_DWithin(t.geom::geography, p_geom, p_radius_m)
      ORDER BY 
        (CASE WHEN t.subclass IN ('sidewalk', 'crosswalk') THEN 0 ELSE 1 END),
        ST_Distance(t.geom::geography, p_geom)
      LIMIT 1
    ) sub;

    IF snapped_lon IS NOT NULL AND snapped_lat IS NOT NULL THEN
      result_found := true;
    ELSIF p_use_road_fallback THEN
      -- Tier 2: Fallback to road centerlines
      SELECT ST_X(closest), ST_Y(closest)
      INTO snapped_lon, snapped_lat
      FROM (
        SELECT ST_ClosestPoint(t.geom, p_geom::geometry) AS closest
        FROM public.overture_transportation t
        WHERE t.class IN ('residential', 'service')
          AND ST_DWithin(t.geom::geography, p_geom, p_radius_m)
        ORDER BY ST_Distance(t.geom::geography, p_geom)
        LIMIT 1
      ) sub;
      
      IF snapped_lon IS NOT NULL AND snapped_lat IS NOT NULL THEN
        result_found := true;
      END IF;
    END IF;

    IF result_found THEN
      out_arr := out_arr || jsonb_build_object('lon', snapped_lon, 'lat', snapped_lat);
    ELSE
      -- Use original point when no snap found
      out_arr := out_arr || jsonb_build_object('lon', (pt->>'lon')::double precision, 'lat', (pt->>'lat')::double precision);
    END IF;
    
    -- Reset for next iteration
    snapped_lon := NULL;
    snapped_lat := NULL;
  END LOOP;

  RETURN out_arr;
END;
$$;

COMMENT ON FUNCTION public.snap_points_to_walkways IS 
'Snap multiple points to nearest pedestrian walkways. Input: jsonb array of {lon, lat}. Output: same-order array; original point used when no walkway in radius. Tier 1: footway, path, pedestrian, steps (prioritizes sidewalk/crosswalk subclass). Optional Tier 2: residential/service roads when p_use_road_fallback=true.';
