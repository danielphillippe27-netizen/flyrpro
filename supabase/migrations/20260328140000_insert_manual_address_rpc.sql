-- RPC function to insert a manual address with proper PostGIS geometry
CREATE OR REPLACE FUNCTION public.insert_manual_address(
    p_campaign_id UUID,
    p_address TEXT,
    p_formatted TEXT,
    p_house_number TEXT DEFAULT NULL,
    p_street_name TEXT DEFAULT NULL,
    p_locality TEXT DEFAULT NULL,
    p_region TEXT DEFAULT NULL,
    p_postal_code TEXT DEFAULT NULL,
    p_source TEXT DEFAULT 'manual',
    p_building_gers_id TEXT DEFAULT NULL,
    p_geom_json TEXT DEFAULT NULL,
    p_coordinate JSONB DEFAULT NULL,
    p_visited BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id UUID,
    address TEXT,
    formatted TEXT,
    house_number TEXT,
    street_name TEXT,
    locality TEXT,
    region TEXT,
    postal_code TEXT,
    building_gers_id TEXT,
    source TEXT
) LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.campaign_addresses (
        campaign_id,
        address,
        formatted,
        house_number,
        street_name,
        locality,
        region,
        postal_code,
        source,
        building_gers_id,
        geom,
        coordinate,
        visited
    ) VALUES (
        p_campaign_id,
        p_address,
        p_formatted,
        p_house_number,
        p_street_name,
        p_locality,
        p_region,
        p_postal_code,
        p_source,
        p_building_gers_id,
        CASE 
            WHEN p_geom_json IS NOT NULL THEN ST_GeomFromGeoJSON(p_geom_json)::geometry(Point, 4326)
            ELSE NULL
        END,
        p_coordinate,
        p_visited
    )
    RETURNING campaign_addresses.id INTO v_id;
    
    RETURN QUERY
    SELECT 
        ca.id,
        ca.address,
        ca.formatted,
        ca.house_number,
        ca.street_name,
        ca.locality,
        ca.region,
        ca.postal_code,
        ca.building_gers_id,
        ca.source
    FROM public.campaign_addresses ca
    WHERE ca.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_manual_address TO authenticated, service_role;

COMMENT ON FUNCTION public.insert_manual_address IS 'Inserts a manual address with proper PostGIS geometry conversion from GeoJSON';

NOTIFY pgrst, 'reload schema';
