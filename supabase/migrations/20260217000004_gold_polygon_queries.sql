-- ============================================================================
-- GOLD STANDARD: Query addresses and buildings within a polygon
-- ============================================================================
-- These RPC functions support the GoldAddressService
-- They query ref_addresses_gold and ref_buildings_gold for addresses/buildings
-- within a campaign's territory boundary polygon
-- ============================================================================

-- ============================================================================
-- 1. Get Gold Standard addresses within a polygon
-- ============================================================================

CREATE OR REPLACE FUNCTION get_gold_addresses_in_polygon(
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
    geom GEOMETRY
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_polygon GEOMETRY;
BEGIN
    -- Parse the GeoJSON polygon
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
        a.geom
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
    ORDER BY a.street_name, a.street_number::INTEGER NULLS LAST;
END;
$$;

COMMENT ON FUNCTION get_gold_addresses_in_polygon IS 
'Returns all Gold Standard addresses within the specified polygon.
Used for campaign address generation - queries municipal data first.';

GRANT EXECUTE ON FUNCTION get_gold_addresses_in_polygon TO authenticated, service_role;

-- ============================================================================
-- 2. Get Gold Standard buildings within a polygon
-- ============================================================================

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

COMMENT ON FUNCTION get_gold_buildings_in_polygon IS 
'Returns all Gold Standard building footprints within the specified polygon.
Used for building matching in campaigns.';

GRANT EXECUTE ON FUNCTION get_gold_buildings_in_polygon TO authenticated, service_role;

-- ============================================================================
-- 3. Check Gold coverage for an area
-- ============================================================================

CREATE OR REPLACE FUNCTION check_gold_coverage(
    p_polygon_geojson TEXT
)
RETURNS TABLE (
    has_coverage BOOLEAN,
    address_count BIGINT,
    building_count BIGINT,
    coverage_pct FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_polygon GEOMETRY;
    v_address_count BIGINT;
    v_building_count BIGINT;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    -- Count addresses
    SELECT COUNT(*) INTO v_address_count
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon);
    
    -- Count buildings
    SELECT COUNT(*) INTO v_building_count
    FROM ref_buildings_gold b
    WHERE ST_Intersects(b.geom, v_polygon);
    
    RETURN QUERY
    SELECT 
        v_address_count >= 10,  -- Threshold for "good coverage"
        v_address_count,
        v_building_count,
        CASE 
            WHEN v_address_count >= 100 THEN 100.0
            WHEN v_address_count >= 50 THEN 80.0
            WHEN v_address_count >= 20 THEN 60.0
            WHEN v_address_count >= 10 THEN 40.0
            ELSE (v_address_count::FLOAT / 10.0) * 40.0
        END;
END;
$$;

COMMENT ON FUNCTION check_gold_coverage IS 
'Checks if an area has sufficient Gold Standard data coverage.
Returns true if >= 10 addresses are available.';

GRANT EXECUTE ON FUNCTION check_gold_coverage TO authenticated, service_role;

-- ============================================================================
-- 4. Get Gold data stats for monitoring
-- ============================================================================

CREATE OR REPLACE FUNCTION v_gold_coverage_stats()
RETURNS TABLE (
    source_id TEXT,
    address_count BIGINT,
    building_count BIGINT,
    bbox GEOMETRY
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.source_id,
        COUNT(DISTINCT a.id) AS address_count,
        (SELECT COUNT(*) FROM ref_buildings_gold b WHERE b.source_id = a.source_id) AS building_count,
        ST_Extent(a.geom)::GEOMETRY AS bbox
    FROM ref_addresses_gold a
    GROUP BY a.source_id;
END;
$$;

-- Test the functions
-- SELECT * FROM get_gold_addresses_in_polygon('{"type":"Polygon","coordinates":[[[-79.0,43.9],[-78.8,43.9],[-78.8,44.0],[-79.0,44.0],[-79.0,43.9]]]}') LIMIT 5;
