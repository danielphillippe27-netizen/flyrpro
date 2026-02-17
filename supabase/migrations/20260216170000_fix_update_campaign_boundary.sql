-- Fix update_campaign_boundary: resolve ambiguous column references
-- The issue is "RETURNING * INTO v_row" - when we reference v_row.campaign_polygon_snapped,
-- it conflicts with the output parameter name. Use explicit RETURNING with table alias.

DROP FUNCTION IF EXISTS public.update_campaign_boundary(uuid, jsonb, jsonb, boolean);

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
  v_territory_boundary geometry;
  v_raw jsonb;
  v_snapped jsonb;
  v_is_snapped boolean;
BEGIN
  -- Parse boundary
  v_boundary_geom := ST_GeomFromGeoJSON(p_boundary_geojson::text)::geometry(Polygon, 4326);

  -- Update and return specific columns (using table alias to avoid ambiguity)
  UPDATE public.campaigns AS c
  SET
    territory_boundary = v_boundary_geom,
    campaign_polygon_raw = p_raw_geojson,
    campaign_polygon_snapped = CASE WHEN p_is_snapped THEN p_boundary_geojson ELSE c.campaign_polygon_snapped END,
    is_snapped = p_is_snapped
  WHERE c.id = p_campaign_id
  RETURNING 
    c.territory_boundary,
    c.campaign_polygon_raw,
    c.campaign_polygon_snapped,
    c.is_snapped
  INTO 
    v_territory_boundary,
    v_raw,
    v_snapped,
    v_is_snapped;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Return values
  territory_boundary_geojson := ST_AsGeoJSON(v_territory_boundary)::jsonb;
  campaign_polygon_raw := v_raw;
  campaign_polygon_snapped := v_snapped;
  is_snapped := v_is_snapped;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.update_campaign_boundary(uuid, jsonb, jsonb, boolean) IS
'Update campaign boundary and raw/snapped polygons in a transaction. Returns updated row with territory_boundary as GeoJSON. FIXED: Used explicit table alias (c.) in RETURNING clause to avoid ambiguous column references.';

GRANT EXECUTE ON FUNCTION public.update_campaign_boundary(uuid, jsonb, jsonb, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
