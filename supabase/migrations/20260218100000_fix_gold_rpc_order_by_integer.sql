-- Fix get_gold_addresses_in_polygon_geojson: ORDER BY a.street_number::INTEGER
-- fails when street_number contains non-numeric data (e.g. "30None").
-- Use street_number_normalized for stable, indexed ordering.
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
    ORDER BY a.street_name, a.street_number_normalized NULLS LAST, a.street_number;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gold_addresses_in_polygon_geojson TO authenticated, service_role;
