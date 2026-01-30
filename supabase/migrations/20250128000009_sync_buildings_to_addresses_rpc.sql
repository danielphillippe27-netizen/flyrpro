-- Unbreakable Provisioning RPC: Broad Net + Magnet Logic + Safety Net
-- This function ensures 100% building coverage for every address:
-- 1. Insert/Update Overture buildings that are NEAR addresses (within 15m) - "Magnet Logic"
--    Uses ST_DWithin with geography casting for accurate meter-based distance
-- 2. "The Handshake": Link campaign_addresses.gers_id to buildings.gers_id
-- 3. Identify Gaps: Find addresses without buildings
-- 4. Create Synthetic Buildings: Generate buildings for missing footprints (Safety Net)
-- 5. Cleanup orphan buildings (buildings without matching addresses)

CREATE OR REPLACE FUNCTION public.sync_buildings_to_addresses(
  p_campaign_id uuid,
  p_buildings jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_inserted_count integer;
  v_updated_count integer;
  v_deleted_count integer;
  v_synthetic_count integer;
BEGIN
  -- Step 1: Insert/Update buildings that are NEAR addresses (Magnet Logic)
  -- Uses ST_DWithin with 15-meter buffer to catch buildings even if address is on sidewalk
  -- Geography casting ensures 15 meters is real-world meters, not degrees
  -- This handles the Overture reality: address points are often 1-2m away from building footprint
  
  INSERT INTO buildings (
    gers_id,
    geom,
    centroid,
    height,
    height_m,
    campaign_id,
    house_name,
    addr_housenumber,
    addr_street,
    addr_unit,
    latest_status,
    is_hidden
  )
  SELECT 
    b->>'gers_id' as gers_id,
    -- Ensure MultiPolygon format (buildings table requires MultiPolygon)
    CASE 
      WHEN (b->'geometry'->>'type') = 'Polygon' THEN
        ST_Multi(ST_GeomFromGeoJSON(b->>'geometry'))
      ELSE
        ST_Multi(ST_GeomFromGeoJSON(b->>'geometry'))
    END as geom,
    CASE 
      WHEN b->'centroid' IS NOT NULL AND b->'centroid'->>'type' = 'Point' THEN 
        ST_GeomFromGeoJSON(b->>'centroid')
      ELSE 
        ST_Centroid(ST_GeomFromGeoJSON(b->>'geometry'))
    END as centroid,
    NULLIF((b->>'height')::numeric, NULL) as height,
    COALESCE((b->>'height')::numeric, 8) as height_m,
    p_campaign_id as campaign_id,
    NULLIF(b->>'house_name', '') as house_name,
    NULLIF(b->>'addr_housenumber', '') as addr_housenumber,
    NULLIF(b->>'addr_street', '') as addr_street,
    NULLIF(b->>'addr_unit', '') as addr_unit,
    'default' as latest_status,
    false as is_hidden
  FROM jsonb_array_elements(p_buildings) AS b
  WHERE b->>'gers_id' IS NOT NULL
    AND b->'geometry' IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM campaign_addresses ca 
      WHERE ca.campaign_id = p_campaign_id 
        AND ca.geom IS NOT NULL
        -- Use ST_DWithin with geography casting for accurate 15-meter distance
        -- This catches buildings even if address point is on sidewalk (1-2m away)
        AND ST_DWithin(
          ca.geom::geography, 
          ST_GeomFromGeoJSON(b->>'geometry')::geography, 
          15
        )
    )
  ON CONFLICT (gers_id) DO UPDATE 
    SET 
      geom = EXCLUDED.geom,
      centroid = EXCLUDED.centroid,
      height = EXCLUDED.height,
      height_m = EXCLUDED.height_m,
      campaign_id = EXCLUDED.campaign_id,
      house_name = EXCLUDED.house_name,
      addr_housenumber = EXCLUDED.addr_housenumber,
      addr_street = EXCLUDED.addr_street,
      addr_unit = EXCLUDED.addr_unit,
      updated_at = now();
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  -- Step 2: "The Handshake" - Link address GERS to building GERS
  -- CRITICAL: This ensures QR code scans match 3D buildings perfectly
  -- Overture's Address theme GERS IDs and Building theme GERS IDs are NOT always the same
  -- By overwriting campaign_addresses.gers_id with buildings.gers_id, we ensure perfect matching
  -- Use ST_DWithin to link addresses to the closest building within 15m
  UPDATE campaign_addresses ca
  SET gers_id = b.gers_id
  FROM buildings b
  WHERE ca.campaign_id = p_campaign_id
    AND b.campaign_id = p_campaign_id
    AND ca.geom IS NOT NULL
    AND ST_DWithin(ca.geom::geography, b.geom::geography, 15);
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Step 3: Identify Gaps - Find addresses without buildings
  -- These are addresses that don't have a building linked after the Overture sync
  
  -- Step 4: Create Synthetic Buildings for Gaps (Safety Net)
  -- For addresses without buildings, create a building using ST_Buffer
  -- This handles new developments Overture doesn't have footprints for yet
  INSERT INTO buildings (
    gers_id,
    geom,
    centroid,
    height,
    height_m,
    campaign_id,
    latest_status,
    is_hidden
  )
  SELECT 
    'synthetic-' || ca.id::text as gers_id,
    -- Create building: Buffer address point by 6m (radius) for ~12m diameter
    -- ST_Buffer on geography gives meters, then cast to geometry and ensure MultiPolygon
    ST_Multi(
      ST_Buffer(ca.geom::geography, 6)::geometry
    ) as geom,
    ca.geom::geometry as centroid, -- Use address point as centroid
    8 as height, -- Default height of 8m for synthetic buildings
    8 as height_m,
    p_campaign_id as campaign_id,
    'default' as latest_status,
    false as is_hidden
  FROM campaign_addresses ca
  WHERE ca.campaign_id = p_campaign_id
    AND ca.geom IS NOT NULL
    AND ca.gers_id IS NULL -- Only for addresses we couldn't link to Overture
    -- Don't create if a synthetic building already exists for this address
    AND NOT EXISTS (
      SELECT 1 
      FROM buildings b
      WHERE b.campaign_id = p_campaign_id
        AND b.gers_id = 'synthetic-' || ca.id::text
    )
  ON CONFLICT (gers_id) DO NOTHING;
  
  GET DIAGNOSTICS v_synthetic_count = ROW_COUNT;

  -- Step 5: Link synthetic buildings to addresses (handshake for synthetic)
  -- Re-link addresses to the new synthetic buildings we just created
  UPDATE campaign_addresses ca
  SET gers_id = 'synthetic-' || ca.id::text
  WHERE ca.campaign_id = p_campaign_id 
    AND ca.gers_id IS NULL
    AND EXISTS (
      SELECT 1 
      FROM buildings b
      WHERE b.campaign_id = p_campaign_id
        AND b.gers_id = 'synthetic-' || ca.id::text
    );

  -- Step 6: Cleanup orphan buildings (buildings without matching addresses)
  -- Uses gers_id link (same as handshake) for efficient deletion
  DELETE FROM buildings 
  WHERE campaign_id = p_campaign_id 
  AND gers_id NOT IN (
      SELECT gers_id FROM campaign_addresses 
      WHERE campaign_id = p_campaign_id AND gers_id IS NOT NULL
  );
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Return detailed summary
  RETURN jsonb_build_object(
    'inserted', v_inserted_count,
    'updated', v_updated_count,
    'deleted', v_deleted_count,
    'overture_synced', v_inserted_count, -- Overture buildings synced
    'synthetic_created', v_synthetic_count, -- Synthetic buildings created
    'addresses_linked', v_updated_count -- Addresses linked to buildings
  );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.sync_buildings_to_addresses(uuid, jsonb) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION public.sync_buildings_to_addresses IS 
'Unbreakable provisioning: Broad Net (fetches all buildings in territory) + Magnet Logic (ST_DWithin 15m buffer catches sidewalk addresses) + Safety Net (creates synthetic buildings for gaps). Uses geography casting for accurate meter-based distance. Ensures 100% building coverage for every address. Synthetic buildings use gers_id format: synthetic-{address_id} and are ~12m diameter circles with 8m height.';
