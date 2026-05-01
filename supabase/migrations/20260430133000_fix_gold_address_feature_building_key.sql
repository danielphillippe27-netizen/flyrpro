-- iOS reads address-to-building ownership from rpc_get_campaign_addresses.
-- Gold linking writes campaign_addresses.building_id, while older address
-- feature reads only emitted building_gers_id. Prefer the authoritative
-- campaign_addresses.building_id when present.

UPDATE public.campaign_addresses
SET building_gers_id = building_id::text
WHERE building_id IS NOT NULL
  AND (building_gers_id IS NULL OR building_gers_id <> building_id::text);

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_addresses(
    p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', a.id,
            'geometry', ST_AsGeoJSON(a.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', a.id,
                'gers_id', a.gers_id,
                'building_gers_id', COALESCE(a.building_id::text, a.building_gers_id),
                'house_number', a.house_number,
                'street_name', a.street_name,
                'postal_code', a.postal_code,
                'locality', a.locality,
                'formatted', a.formatted,
                'source', a.source
            )
        ) AS feature
        FROM public.campaign_addresses a
        WHERE a.campaign_id = p_campaign_id
    ) features;

    RETURN COALESCE(result, '{"type":"FeatureCollection","features":[]}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_addresses(uuid) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.rpc_get_campaign_addresses(uuid) IS
'Returns GeoJSON FeatureCollection of all campaign addresses. For Gold campaigns, building_gers_id is derived from campaign_addresses.building_id so iOS uses the authoritative building assignment.';

NOTIFY pgrst, 'reload schema';
