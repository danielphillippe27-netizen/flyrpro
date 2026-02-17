-- ============================================================================
-- CAMPAIGN ADDRESSES: RPC to return addresses with GeoJSON geometry
-- ============================================================================
-- This function returns campaign addresses with geom as JSONB
-- to avoid parsing issues in JavaScript
-- ============================================================================

-- Get campaign addresses with GeoJSON geometry
DROP FUNCTION IF EXISTS get_campaign_addresses_geojson(UUID);

CREATE OR REPLACE FUNCTION get_campaign_addresses_geojson(
    p_campaign_id UUID
)
RETURNS TABLE (
    id UUID,
    gers_id TEXT,
    formatted TEXT,
    house_number TEXT,
    street_name TEXT,
    locality TEXT,
    region TEXT,
    postal_code TEXT,
    geom JSONB  -- GeoJSON object as JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.gers_id,
        a.formatted,
        a.house_number,
        a.street_name,
        a.locality,
        a.region,
        a.postal_code,
        ST_AsGeoJSON(a.geom)::JSONB AS geom
    FROM campaign_addresses a
    WHERE a.campaign_id = p_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_campaign_addresses_geojson(UUID) TO authenticated, service_role;

-- Verify
SELECT 'Campaign addresses GeoJSON RPC function created' as status;
