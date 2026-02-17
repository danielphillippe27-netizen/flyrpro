-- ============================================================================
-- GOLD STANDARD: Get Campaign Buildings as GeoJSON
-- ============================================================================
-- Returns linked Gold buildings for map display
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_campaign_buildings_geojson(UUID);

CREATE OR REPLACE FUNCTION public.get_campaign_buildings_geojson(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(
            jsonb_build_object(
                'type', 'Feature',
                'id', b.id,
                'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                'properties', jsonb_build_object(
                    'id', b.id,
                    'gers_id', b.id,
                    'external_id', b.external_id,
                    'area', b.area_sqm,
                    'height', 10,
                    'layer', 'building',
                    'source', 'gold'
                )
            )
        ), '[]'::jsonb)
    ) INTO result
    FROM ref_buildings_gold b
    INNER JOIN campaign_addresses ca ON ca.building_id = b.id
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NOT NULL;

    RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_buildings_geojson(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_campaign_buildings_geojson(UUID) IS
'Returns GeoJSON FeatureCollection of Gold buildings linked to campaign addresses.';

-- Verify
SELECT 'get_campaign_buildings_geojson RPC created' as status;
