-- Enhance sync_bbox_data with Intelligent Hybrid Matching
-- Implements priority scoring: Attribute Match → Point-in-Polygon → Proximity (50m)
-- This solves the "Sprucewood Cres" problem by expanding buffer to 50m and using semantic matching

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

    -- 4. PREP BUILDING INPUT (Extract address properties from JSONB)
    WITH building_input AS (
        SELECT 
            (b->>'gers_id') as g_id,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
            COALESCE((b->>'height')::numeric, 8) as g_height,
            NULLIF(b->>'b_house_number', '') as b_house_number,
            NULLIF(b->>'b_street_name', '') as b_street_name
        FROM jsonb_array_elements(v_buildings_array) AS b
        WHERE b->>'geometry' IS NOT NULL
          AND b->>'gers_id' IS NOT NULL
    ),
    -- 5. HYBRID MATCHING LOGIC (Priority Scoring)
    -- Priority 1: Attribute Match (house_number + street_name) - Hard Link
    -- Priority 2: Point-in-Polygon (ST_Intersects) - Perfect Spatial
    -- Priority 3: Proximity (closest within 50m) - Soft Link
    ranked_matches AS (
        SELECT DISTINCT ON (ca.id)
            ca.id as address_id,
            bi.g_id as building_gers_id,
            bi.g_geom,
            bi.g_height,
            bi.b_house_number,
            bi.b_street_name
        FROM public.campaign_addresses ca
        CROSS JOIN LATERAL (
            SELECT 
                bi.*,
                CASE 
                    -- Priority 1: House Number + Street Name Match (Hard Link)
                    WHEN ca.house_number = bi.b_house_number 
                         AND lower(COALESCE(ca.street_name, '')) = lower(COALESCE(bi.b_street_name, '')) 
                         AND ca.house_number IS NOT NULL 
                         AND bi.b_house_number IS NOT NULL
                    THEN 1
                    -- Priority 2: Address point falls inside building polygon (Perfect Spatial)
                    WHEN ST_Intersects(bi.g_geom, ca.geom)
                    THEN 2
                    -- Priority 3: Proximity (up to 50m) (Soft Link)
                    WHEN ST_DWithin(ca.geom::geography, bi.g_geom::geography, 50)
                    THEN 3
                    ELSE 4
                END as match_score
            FROM building_input bi
            WHERE ST_DWithin(ca.geom::geography, bi.g_geom::geography, 50)
            ORDER BY 
                match_score ASC,  -- Priority order: 1 (attribute) < 2 (intersect) < 3 (proximity)
                ca.geom <-> bi.g_geom ASC  -- Within same priority, closest wins (uses spatial index)
            LIMIT 1
        ) bi
        WHERE ca.campaign_id = p_campaign_id
    )
    -- 6. INSERT MATCHED BUILDINGS
    INSERT INTO public.buildings (
        gers_id, geom, centroid, height_m, campaign_id, 
        address_id, latest_status, addr_housenumber, addr_street
    )
    SELECT 
        building_gers_id, g_geom, ST_Centroid(g_geom), g_height, p_campaign_id,
        address_id, 'available', b_house_number, b_street_name
    FROM ranked_matches;

    GET DIAGNOSTICS v_build_count = ROW_COUNT;

    -- 7. FINAL LINK: Stamp the building GERS ID onto the address
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
'Double-Bucket Sync provisioning with intelligent hybrid matching: Priority 1 (Attribute match: house_number + street_name) → Priority 2 (Point-in-polygon: ST_Intersects) → Priority 3 (Proximity: closest within 50m). Uses CROSS JOIN LATERAL with match_score ordering for efficient nearest neighbor queries. Sets latest_status=''available'' (Red) for newly provisioned buildings. Solves "Sprucewood Cres" problem by expanding buffer to 50m and using semantic matching to prevent cross-matching.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
