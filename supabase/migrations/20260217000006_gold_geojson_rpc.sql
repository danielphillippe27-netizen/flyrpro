-- ============================================================================
-- GOLD STANDARD: RPC functions that return GeoJSON strings
-- ============================================================================
-- These functions return geometry as GeoJSON strings for easy client handling
-- ============================================================================

-- 1. Get Gold addresses with GeoJSON geometry
DROP FUNCTION IF EXISTS get_gold_addresses_in_polygon_geojson(TEXT);

CREATE OR REPLACE FUNCTION get_gold_addresses_in_polygon_geojson(
    p_polygon_geojson TEXT
)
RETURNS TABLE (
    id UUID,
    source_id TEXT,
    street_number TEXT,
    street_name TEXT,
    unit TEXT,
    city TEXT,
    zip TEXT,
    province TEXT,
    country TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    geom_geojson TEXT
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
        a.id,
        a.source_id,
        a.street_number,
        a.street_name,
        a.unit,
        a.city,
        a.zip,
        a.province,
        a.country,
        ST_Y(a.geom::GEOMETRY) AS lat,
        ST_X(a.geom::GEOMETRY) AS lon,
        ST_AsGeoJSON(a.geom)::TEXT AS geom_geojson
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
    ORDER BY a.street_name, a.street_number::INTEGER NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gold_addresses_in_polygon_geojson TO authenticated, service_role;

-- 2. Get Gold buildings with GeoJSON geometry
DROP FUNCTION IF EXISTS get_gold_buildings_in_polygon_geojson(TEXT);

CREATE OR REPLACE FUNCTION get_gold_buildings_in_polygon_geojson(
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

GRANT EXECUTE ON FUNCTION get_gold_buildings_in_polygon_geojson TO authenticated, service_role;

-- Verify
SELECT 'Gold GeoJSON RPC functions created' as status;
