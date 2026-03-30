-- Add a non-overloaded Gold address RPC so PostgREST can resolve calls
-- without ambiguity when both legacy signatures exist.

CREATE OR REPLACE FUNCTION get_gold_addresses_in_polygon_geojson_filtered(
    p_polygon_geojson TEXT,
    p_province TEXT
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
    v_province TEXT;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    v_province := NULLIF(UPPER(TRIM(p_province)), '');

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
      AND (v_province IS NULL OR UPPER(a.province) = v_province)
    ORDER BY a.street_name, a.street_number_normalized NULLS LAST, a.street_number
    LIMIT 2500;
END;
$$;

GRANT EXECUTE ON FUNCTION get_gold_addresses_in_polygon_geojson_filtered(TEXT, TEXT) TO authenticated, service_role;
