-- Double-Bucket Sync Provisioning RPC
-- This function implements the "Full BBox Sync" strategy:
-- 1. Fetches all addresses in campaign BBox from MotherDuck
-- 2. Fetches all buildings in the same BBox
-- 3. Performs spatial matching in PostGIS (25m buffer)
-- 4. Only saves buildings that are within 25m of addresses
-- 5. Links gers_id from building to address record
-- 6. Sets latest_status = 'available' (Red) for newly provisioned buildings
-- 7. No synthetic building creation

CREATE OR REPLACE FUNCTION public.sync_bbox_data(
  p_campaign_id uuid,
  p_addresses jsonb,
  p_buildings jsonb
)
RETURNS jsonb AS $$
DECLARE
    v_addr_count int := 0;
    v_build_count int := 0;
    v_addresses_array jsonb;
    v_buildings_array jsonb;
BEGIN
    -- 1. SAFETY CHECK: Convert scalar strings back to arrays if needed
    -- This prevents the "cannot extract elements from a scalar" error
    IF jsonb_typeof(p_addresses) = 'string' THEN
        v_addresses_array := (p_addresses#>>'{}')::jsonb;
    ELSE
        v_addresses_array := p_addresses;
    END IF;

    IF jsonb_typeof(p_buildings) = 'string' THEN
        v_buildings_array := (p_buildings#>>'{}')::jsonb;
    ELSE
        v_buildings_array := p_buildings;
    END IF;

    -- If they're still not arrays or are empty, set to empty arrays
    IF v_addresses_array IS NULL OR jsonb_typeof(v_addresses_array) != 'array' THEN
        v_addresses_array := '[]'::jsonb;
    END IF;

    IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
        v_buildings_array := '[]'::jsonb;
    END IF;

    -- 2. CLEAR OLD DATA (Start Fresh)
    DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;
    DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;

    -- 3. INSERT ADDRESSES FIRST
    INSERT INTO public.campaign_addresses (campaign_id, gers_id, geom, house_number, street_name, postal_code, locality)
    SELECT 
        p_campaign_id,
        (a->>'gers_id'),
        ST_SetSRID(ST_GeomFromGeoJSON(a->>'geometry'), 4326),
        NULLIF(a->>'house_number', ''),
        NULLIF(a->>'street_name', ''),
        NULLIF(a->>'postal_code', ''),
        NULLIF(a->>'locality', '')
    FROM jsonb_array_elements(v_addresses_array) AS a
    WHERE a->>'geometry' IS NOT NULL;

    GET DIAGNOSTICS v_addr_count = ROW_COUNT;

    -- 4. INSERT MATCHED BUILDINGS (The Filter)
    -- We only save buildings if they are near (25m) one of the addresses we just saved
    INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
    SELECT DISTINCT ON (b->>'gers_id')
        (b->>'gers_id'),
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
        ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
        COALESCE((b->>'height')::numeric, 8),
        p_campaign_id,
        ca.id,
        'available' -- Makes them Red
    FROM jsonb_array_elements(v_buildings_array) AS b
    JOIN public.campaign_addresses ca ON ST_DWithin(
        ca.geom::geography, 
        ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)::geography, 
        25
    )
    WHERE ca.campaign_id = p_campaign_id
      AND b->>'geometry' IS NOT NULL
      AND b->>'gers_id' IS NOT NULL
    ORDER BY (b->>'gers_id'), ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) DESC;

    GET DIAGNOSTICS v_build_count = ROW_COUNT;

    -- 5. FINAL LINK: Stamp the building GERS ID onto the address
    UPDATE public.campaign_addresses ca
    SET gers_id = b.gers_id
    FROM public.buildings b
    WHERE ca.id = b.address_id 
      AND ca.campaign_id = p_campaign_id
      AND b.campaign_id = p_campaign_id;

    RETURN jsonb_build_object(
        'addresses_saved', v_addr_count,
        'buildings_matched', v_build_count
    );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.sync_bbox_data(uuid, jsonb, jsonb) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION public.sync_bbox_data IS 
'Double-Bucket Sync provisioning: Accepts addresses and buildings arrays from MotherDuck. Deletes old data, inserts addresses first, then inserts buildings only if within 25m of addresses using ST_DWithin. Links gers_id from building to address. Sets latest_status=''available'' (Red) for newly provisioned buildings. No synthetic building creation.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
