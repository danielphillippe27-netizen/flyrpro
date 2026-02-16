-- Fix snap to roads RPC: Add better error handling and JSON parameter support
-- Also ensure get_roads_in_bbox handles edge cases properly

-- 1. Fix get_roads_in_bbox to be more robust with parameter handling
CREATE OR REPLACE FUNCTION public.get_roads_in_bbox(
  min_lon double precision,
  min_lat double precision,
  max_lon double precision,
  max_lat double precision
)
RETURNS TABLE (
  gers_id text,
  geojson jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER  -- Run as owner to bypass RLS issues
AS $$
DECLARE
  bbox_geom geometry(Polygon, 4326);
  bbox_geog geography;
  buffered geography;
BEGIN
  -- Validate inputs
  IF min_lon IS NULL OR min_lat IS NULL OR max_lon IS NULL OR max_lat IS NULL THEN
    RAISE EXCEPTION 'All bbox parameters are required';
  END IF;
  
  IF min_lon >= max_lon OR min_lat >= max_lat THEN
    RAISE EXCEPTION 'Invalid bbox: min must be less than max (got lon: % to %, lat: % to %)', 
      min_lon, max_lon, min_lat, max_lat;
  END IF;

  -- Bbox as polygon (closed ring)
  BEGIN
    bbox_geom := ST_SetSRID(
      ST_MakePolygon(ST_GeomFromText(
        'LINESTRING(' || 
        min_lon || ' ' || min_lat || ',' ||
        max_lon || ' ' || min_lat || ',' ||
        max_lon || ' ' || max_lat || ',' ||
        min_lon || ' ' || max_lat || ',' ||
        min_lon || ' ' || min_lat || ')'
      )),
      4326
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create bbox geometry: %', SQLERRM;
  END;
  
  bbox_geog := bbox_geom::geography;
  buffered := ST_Buffer(bbox_geog, 100);

  RETURN QUERY
  SELECT
    t.gers_id,
    ST_AsGeoJSON(t.geom)::jsonb AS geojson
  FROM public.overture_transportation t
  WHERE ST_Intersects(t.geom::geography, buffered)
    AND (t.class IS NULL OR t.class NOT IN ('footway', 'cycleway', 'track', 'bridleway', 'path'));
    
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'get_roads_in_bbox error: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.get_roads_in_bbox(double precision, double precision, double precision, double precision) IS
'Return Overture road segments (LineString as GeoJSON) intersecting bbox + 100m buffer. Excludes footway, cycleway, track, bridleway, path for block-aligned snapping. SECURITY DEFINER to bypass RLS.';

-- Grant execute to authenticated and service roles
GRANT EXECUTE ON FUNCTION public.get_roads_in_bbox(double precision, double precision, double precision, double precision) 
TO authenticated, service_role;

-- 2. Also fix update_campaign_boundary to be more robust
CREATE OR REPLACE FUNCTION public.update_campaign_boundary(
  p_campaign_id uuid,
  p_boundary_geojson jsonb,
  p_raw_geojson jsonb,
  p_is_snapped boolean
)
RETURNS TABLE (
  territory_boundary_geojson jsonb,
  campaign_polygon_raw jsonb,
  campaign_polygon_snapped jsonb,
  is_snapped boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boundary_geom geometry(Polygon, 4326);
  v_row public.campaigns%ROWTYPE;
BEGIN
  -- Validate inputs
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Campaign ID is required';
  END IF;
  
  IF p_boundary_geojson IS NULL THEN
    RAISE EXCEPTION 'Boundary GeoJSON is required';
  END IF;

  -- Parse boundary and update in one transaction
  BEGIN
    v_boundary_geom := ST_GeomFromGeoJSON(p_boundary_geojson::text)::geometry(Polygon, 4326);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid boundary GeoJSON: %', SQLERRM;
  END;

  UPDATE public.campaigns
  SET
    territory_boundary = v_boundary_geom,
    campaign_polygon_raw = p_raw_geojson,
    campaign_polygon_snapped = CASE WHEN p_is_snapped THEN p_boundary_geojson ELSE campaign_polygon_snapped END,
    is_snapped = p_is_snapped
  WHERE id = p_campaign_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign % not found', p_campaign_id;
  END IF;

  -- Return updated row with geometry as GeoJSON so UI and DB stay in sync
  territory_boundary_geojson := ST_AsGeoJSON(v_row.territory_boundary)::jsonb;
  campaign_polygon_raw := v_row.campaign_polygon_raw;
  campaign_polygon_snapped := v_row.campaign_polygon_snapped;
  is_snapped := v_row.is_snapped;
  RETURN NEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'update_campaign_boundary error: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.update_campaign_boundary(uuid, jsonb, jsonb, boolean) IS
'Update campaign boundary and raw/snapped polygons in a transaction. Returns updated row with territory_boundary as GeoJSON. Use this instead of direct geometry updates from the JS client.';

GRANT EXECUTE ON FUNCTION public.update_campaign_boundary(uuid, jsonb, jsonb, boolean) 
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
