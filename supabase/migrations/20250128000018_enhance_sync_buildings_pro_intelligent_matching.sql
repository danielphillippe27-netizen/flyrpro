-- Enhance sync_buildings_pro with Intelligent Hybrid Matching
-- Implements priority scoring: Attribute Match → Point-in-Polygon → Proximity (50m)
-- This solves the "Sprucewood Cres" problem by expanding buffer to 50m and using semantic matching

CREATE OR REPLACE FUNCTION public.sync_buildings_pro(
  p_campaign_id uuid,
  p_buildings jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_overture_linked int := 0;
  v_synthetic_created int := 0;
  v_buildings_array jsonb;
BEGIN
  -- 1. SAFETY CHECK: Convert scalar string back to array if needed
  -- This prevents the "cannot extract elements from a scalar" error
  IF jsonb_typeof(p_buildings) = 'string' THEN
    -- Extract text value from jsonb string container and cast to jsonb
    v_buildings_array := (p_buildings#>>'{}')::jsonb;
  ELSE
    v_buildings_array := p_buildings;
  END IF;

  -- If it's still not an array or is empty, skip to synthetic creation
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;

  -- 2. CLEANUP
  DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;
  UPDATE public.campaign_addresses SET gers_id = NULL WHERE campaign_id = p_campaign_id;

  -- 3. PREP BUILDING INPUT (Extract address properties from JSONB)
  WITH building_input AS (
    SELECT 
      (b->>'gers_id') as g_id,
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
      COALESCE((b->>'height')::numeric, 8) as g_height,
      NULLIF(b->>'b_house_number', '') as b_house_number,
      NULLIF(b->>'b_street_name', '') as b_street_name
    FROM jsonb_array_elements(v_buildings_array) AS b
  ),
  -- 4. HYBRID MATCHING LOGIC (Priority Scoring)
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
  -- 5. PERFORM THE UPSERT
  INSERT INTO public.buildings (
    gers_id, geom, centroid, height_m, campaign_id, 
    address_id, latest_status, addr_housenumber, addr_street
  )
  SELECT 
    building_gers_id, g_geom, ST_Centroid(g_geom), g_height, p_campaign_id,
    address_id, 'available', b_house_number, b_street_name
  FROM ranked_matches
  ON CONFLICT (gers_id) DO UPDATE 
  SET 
    address_id = EXCLUDED.address_id,
    latest_status = 'available',
    campaign_id = EXCLUDED.campaign_id,
    addr_housenumber = EXCLUDED.addr_housenumber,
    addr_street = EXCLUDED.addr_street;

  GET DIAGNOSTICS v_overture_linked = ROW_COUNT;

  -- 6. SAFETY NET: Create synthetic boxes for missing houses
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
  SELECT 
    'synthetic-' || ca.id::text,
    ST_Multi(ST_Buffer(ca.geom::geography, 6)::geometry),
    ca.geom::geometry as centroid,
    8,
    p_campaign_id,
    ca.id,
    'default'
  FROM public.campaign_addresses ca
  WHERE ca.campaign_id = p_campaign_id 
    AND NOT EXISTS (SELECT 1 FROM public.buildings b WHERE b.address_id = ca.id);

  GET DIAGNOSTICS v_synthetic_created = ROW_COUNT;

  -- 7. FINAL HANDSHAKE (Step 2 of Two-Way Link): Link addresses to the buildings we just created/matched
  -- Step 1 (above, line 60): Building → Address (stores address_id in buildings table)
  -- Step 2 (here): Address → Building (stores gers_id in campaign_addresses table)
  -- This enables both workflows:
  --   - Building-First: Click house → building.address_id → show contact instantly
  --   - Address-First: Scan QR → address.gers_id → highlight building on map instantly
  UPDATE public.campaign_addresses ca
  SET gers_id = b.gers_id
  FROM public.buildings b
  WHERE b.address_id = ca.id AND ca.campaign_id = p_campaign_id;

  RETURN jsonb_build_object(
    'overture_linked', v_overture_linked,
    'synthetic_created', v_synthetic_created
  );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.sync_buildings_pro(uuid, jsonb) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION public.sync_buildings_pro IS 
'Intelligent hybrid matching: Priority 1 (Attribute match: house_number + street_name) → Priority 2 (Point-in-polygon: ST_Intersects) → Priority 3 (Proximity: closest within 50m). Uses CROSS JOIN LATERAL with match_score ordering for efficient nearest neighbor queries. Sets latest_status=''available'' (Red) for newly provisioned buildings. Solves "Sprucewood Cres" problem by expanding buffer to 50m and using semantic matching to prevent cross-matching.';
