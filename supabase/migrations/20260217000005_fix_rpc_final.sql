-- ============================================================================
-- FIX: Update RPC functions for Gold Standard
-- ============================================================================

-- 1. Fix get_gold_buildings_in_polygon to return GeoJSON
DROP FUNCTION IF EXISTS get_gold_buildings_in_polygon(TEXT);

CREATE OR REPLACE FUNCTION get_gold_buildings_in_polygon(
    p_polygon_geojson TEXT
)
RETURNS TABLE (
    id UUID,
    source_id TEXT,
    external_id TEXT,
    area_sqm FLOAT,
    geom_geojson TEXT,
    centroid_geojson TEXT,
    building_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_polygon GEOMETRY;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    RETURN QUERY
    SELECT 
        b.id,
        b.source_id,
        b.external_id,
        b.area_sqm,
        ST_AsGeoJSON(b.geom)::TEXT AS geom_geojson,
        ST_AsGeoJSON(b.centroid)::TEXT AS centroid_geojson,
        b.building_type
    FROM ref_buildings_gold b
    WHERE ST_Intersects(b.geom, v_polygon)
    ORDER BY b.area_sqm DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gold_buildings_in_polygon TO authenticated, service_role;

-- 2. Fix update_campaign_boundary
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
  v_boundary_geom := ST_GeomFromGeoJSON(p_boundary_geojson::text)::geometry(Polygon, 4326);

  UPDATE public.campaigns AS c
  SET
    territory_boundary = v_boundary_geom,
    campaign_polygon_raw = p_raw_geojson,
    campaign_polygon_snapped = CASE 
      WHEN p_is_snapped THEN p_boundary_geojson 
      ELSE c.campaign_polygon_snapped 
    END,
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

  territory_boundary_geojson := ST_AsGeoJSON(v_territory_boundary)::jsonb;
  campaign_polygon_raw := v_raw;
  campaign_polygon_snapped := v_snapped;
  is_snapped := v_is_snapped;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_campaign_boundary TO authenticated, service_role;

-- Verify
SELECT 'Functions updated successfully' as status;
