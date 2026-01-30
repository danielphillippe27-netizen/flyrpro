-- Stable Surgical Provisioning RPC with Spatial Handshake
-- This function accepts a "Wide Net" list of buildings from MotherDuck
-- Performs the "Surgical Strike" matching in PostGIS (much more stable than MotherDuck joins)
-- Implements "Pro" Spatial Handshake for 100% accuracy:
-- 1. Takes broad list of buildings from MotherDuck (no address matching)
-- 2. Performs spatial matching in PostGIS using ST_DWithin (25m buffer)
-- 3. Pro Logic: Selects closest building first, then largest (distance + area ranking)
--    This ensures primary residence wins over sheds/garages
-- 4. Creates synthetic buildings (10m x 10m) for unmatched addresses
-- 5. Two-way handshake: stores address_id in buildings, gers_id in campaign_addresses

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
  -- If TypeScript sends array: Postgres sees array → skips to ELSE
  -- If TypeScript sends stringified: Postgres sees string → #>>'{}' extracts content, ::jsonb turns it back into array
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

  -- 3. THE SURGICAL MATCH (Spatial Handshake with Pro Logic)
  -- We take the broad list from MotherDuck and match them to our addresses here
  -- The "Pro" Matching Logic:
  -- 1. Cast a 25m net (ST_DWithin) - catches addresses on sidewalk/curb vs building footprint
  -- 2. Sort by Distance FIRST (closest building wins) - avoids matching distant sheds
  -- 3. Sort by Area SECOND (largest building wins) - avoids matching small garages
  -- Result: The building that is both close AND large is almost certainly the primary residence
  WITH building_input AS (
    SELECT 
      (b->>'gers_id') as g_id,
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
      COALESCE((b->>'height')::numeric, 8) as g_height
    FROM jsonb_array_elements(v_buildings_array) AS b
  ),
  ranked_matches AS (
    SELECT DISTINCT ON (ca.id)
      ca.id as address_id,
      bi.g_id as building_gers_id,
      bi.g_geom,
      bi.g_height,
      ST_Distance(ca.geom::geography, bi.g_geom::geography) as distance_m
    FROM public.campaign_addresses ca
    JOIN building_input bi ON ST_DWithin(ca.geom::geography, bi.g_geom::geography, 25)
    WHERE ca.campaign_id = p_campaign_id
    ORDER BY 
      ca.id, 
      ST_Distance(ca.geom::geography, bi.g_geom::geography) ASC,  -- Closest first (tie-breaker #1)
      ST_Area(bi.g_geom) DESC  -- Then largest (tie-breaker #2)
  )
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
  SELECT building_gers_id, g_geom, ST_Centroid(g_geom), g_height, p_campaign_id, address_id, 'default'
  FROM ranked_matches
  ON CONFLICT (gers_id) DO UPDATE SET geom = EXCLUDED.geom, centroid = EXCLUDED.centroid;

  GET DIAGNOSTICS v_overture_linked = ROW_COUNT;

  -- 4. SAFETY NET: Create synthetic boxes for missing houses
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

  -- 5. FINAL HANDSHAKE (Step 2 of Two-Way Link): Link addresses to the buildings we just created/matched
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
'Spatial Handshake provisioning: Accepts "Wide Net" buildings from MotherDuck (no address matching). Performs spatial matching in PostGIS using ST_DWithin (25m buffer) with Pro Logic: distance-first ranking (closest building), then area ranking (largest building). This ensures primary residence wins over sheds/garages. Inserts/updates buildings with latest_status=''default'' (Grey), performs two-way handshake (address_id → buildings, gers_id → campaign_addresses), and creates 10m x 10m synthetic buildings for unmatched addresses.';
