-- Pure Spatial Building Matching RPC
-- Removes attribute matching and uses only spatial relationships:
-- 1. Point-in-Polygon (ST_Intersects) - Best match
-- 2. Closest Neighbor within 50m - Fallback
-- This solves the "Sprucewood Cres" problem without relying on unreliable building-address attributes

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
    INSERT INTO public.campaign_addresses (campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom)
    SELECT 
        p_campaign_id, 
        addr->>'gers_id', 
        addr->>'house_number', 
        addr->>'street_name', 
        addr->>'postal_code',
        trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', '))),
        ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
    FROM jsonb_array_elements(v_addresses_array) AS addr
    WHERE addr->>'geometry' IS NOT NULL;

    GET DIAGNOSTICS v_addr_count = ROW_COUNT;

    -- 4. MATCH BUILDINGS TO ADDRESSES (Pure Spatial: Point-in-Polygon → Closest Neighbor within 50m)
    WITH building_input AS (
        SELECT 
            (b->>'gers_id') as g_id,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
            COALESCE((b->>'height')::numeric, 8) as g_height
        FROM jsonb_array_elements(v_buildings_array) AS b
        WHERE b->>'geometry' IS NOT NULL
          AND b->>'gers_id' IS NOT NULL
    ),
    matched_buildings AS (
        INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
        SELECT DISTINCT ON (bi.g_id) -- Ensure we don't insert the same building twice
            bi.g_id, 
            bi.g_geom, 
            ST_Centroid(bi.g_geom), 
            bi.g_height, 
            p_campaign_id, 
            ia.id, 
            'available'
        FROM (SELECT id, geom FROM public.campaign_addresses WHERE campaign_id = p_campaign_id) ia
        CROSS JOIN LATERAL (
            SELECT * FROM building_input b
            WHERE ST_DWithin(ia.geom::geography, b.g_geom::geography, 50)
            ORDER BY 
                ST_Intersects(b.g_geom, ia.geom) DESC, -- Prefer buildings containing the point
                ia.geom <-> b.g_geom ASC                -- Then closest building
            LIMIT 1
        ) bi
        ON CONFLICT (gers_id) DO UPDATE SET latest_status = 'available'
        RETURNING gers_id
    )
    SELECT count(*) INTO v_build_count FROM matched_buildings;

    -- 6. FINAL LINK: Stamp the building GERS ID onto the address
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
'Pure Spatial Building Matching: Uses only spatial relationships. Priority 1: Point-in-Polygon (ST_Intersects). Priority 2: Closest Neighbor within 50m. Uses CROSS JOIN LATERAL with DISTINCT ON to prevent duplicate buildings. Sets latest_status=''available'' (Red) for newly provisioned buildings. Solves "Sprucewood Cres" problem by using 50m buffer in fetch and 50m fallback in matching.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
