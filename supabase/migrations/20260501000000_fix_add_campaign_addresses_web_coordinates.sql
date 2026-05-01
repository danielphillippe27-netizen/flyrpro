-- Keep web provisioning and iOS bulk address creation compatible.
-- Older deployments of add_campaign_addresses only read top-level lat/lon;
-- web provisioning now sends those, but this RPC also preserves structured fields
-- and accepts GeoJSON/coordinate payloads for newer callers.

CREATE OR REPLACE FUNCTION public.add_campaign_addresses(
    p_campaign_id UUID,
    p_addresses JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        gers_id,
        seq,
        visited,
        coordinate,
        geom,
        created_at
    )
    SELECT
        p_campaign_id,
        NULLIF(addr->>'formatted', ''),
        NULLIF(addr->>'formatted', ''),
        NULLIF(addr->>'house_number', ''),
        NULLIF(addr->>'street_name', ''),
        NULLIF(COALESCE(addr->>'locality', addr->>'city'), ''),
        NULLIF(UPPER(TRIM(COALESCE(addr->>'region', addr->>'state', ''))), ''),
        NULLIF(addr->>'postal_code', ''),
        COALESCE(NULLIF(addr->>'source', ''), 'lambda'),
        NULLIF(addr->>'gers_id', ''),
        COALESCE((addr->>'seq')::int, (addr->>'sequence')::int, 0),
        COALESCE((addr->>'visited')::boolean, false),
        COALESCE(
            addr->'coordinate',
            jsonb_build_object(
                'lat', COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}')::double precision,
                'lon', COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}')::double precision
            )
        ),
        CASE
            WHEN addr ? 'geom' AND addr->>'geom' IS NOT NULL AND addr->>'geom' <> ''
                THEN ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geom'), 4326)::geometry(Point, 4326)
            ELSE ST_SetSRID(
                ST_MakePoint(
                    COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}')::double precision,
                    COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}')::double precision
                ),
                4326
            )::geometry(Point, 4326)
        END,
        NOW()
    FROM jsonb_array_elements(p_addresses) AS addr
    WHERE COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}') IS NOT NULL
      AND COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}') IS NOT NULL
    ON CONFLICT (campaign_id, gers_id)
    DO UPDATE SET
        formatted = COALESCE(EXCLUDED.formatted, public.campaign_addresses.formatted),
        address = COALESCE(EXCLUDED.address, public.campaign_addresses.address),
        house_number = COALESCE(EXCLUDED.house_number, public.campaign_addresses.house_number),
        street_name = COALESCE(EXCLUDED.street_name, public.campaign_addresses.street_name),
        locality = COALESCE(EXCLUDED.locality, public.campaign_addresses.locality),
        region = COALESCE(EXCLUDED.region, public.campaign_addresses.region),
        postal_code = COALESCE(EXCLUDED.postal_code, public.campaign_addresses.postal_code),
        source = COALESCE(EXCLUDED.source, public.campaign_addresses.source),
        coordinate = COALESCE(EXCLUDED.coordinate, public.campaign_addresses.coordinate),
        geom = COALESCE(EXCLUDED.geom, public.campaign_addresses.geom);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_campaign_addresses(UUID, JSONB) TO authenticated, service_role;

COMMENT ON FUNCTION public.add_campaign_addresses(UUID, JSONB) IS
'Bulk inserts campaign addresses from web or iOS payloads. Accepts top-level lat/lon, coordinate JSON, and GeoJSON geom while preserving structured address fields.';

NOTIFY pgrst, 'reload schema';
