-- Collision-Proof Ingest RPC: Handles duplicate gers_id gracefully
-- Key changes:
-- 1. Buildings: Removes DELETE + INSERT, uses ON CONFLICT (upsert) only
-- 2. Addresses: Uses DISTINCT ON (gers_id) to prevent duplicate key errors
-- 3. Roads: Uses DISTINCT ON (gers_id) to prevent duplicate key errors

DROP FUNCTION IF EXISTS public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.ingest_campaign_raw_data(
  p_campaign_id UUID,
  p_addresses JSONB,
  p_buildings JSONB,
  p_roads JSONB DEFAULT '[]'
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_addresses_array JSONB;
  v_buildings_array JSONB;
  v_roads_array JSONB;
  v_addr_count INTEGER := 0;
  v_build_count INTEGER := 0;
  v_roads_count INTEGER := 0;
BEGIN
  -- Normalize scalar string to array (same pattern as sync_bbox_data)
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
  IF jsonb_typeof(p_roads) = 'string' THEN
    v_roads_array := (p_roads#>>'{}')::jsonb;
  ELSE
    v_roads_array := p_roads;
  END IF;
  IF v_addresses_array IS NULL OR jsonb_typeof(v_addresses_array) != 'array' THEN
    v_addresses_array := '[]'::jsonb;
  END IF;
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;
  IF v_roads_array IS NULL OR jsonb_typeof(v_roads_array) != 'array' THEN
    v_roads_array := '[]'::jsonb;
  END IF;

  -- 1. Wipe links and slices for this specific campaign (campaign-scoped tables only)
  -- NOTE: We do NOT delete buildings anymore - ON CONFLICT handles duplicates
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

  -- 2. Ingest Roads (with DISTINCT ON to prevent duplicate gers_id)
  INSERT INTO public.campaign_roads (campaign_id, gers_id, geom)
  SELECT DISTINCT ON (r->>'gers_id')
    p_campaign_id,
    r->>'gers_id',
    ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326)
  FROM jsonb_array_elements(v_roads_array) AS r
  WHERE r->>'geometry' IS NOT NULL
  ORDER BY r->>'gers_id';

  GET DIAGNOSTICS v_roads_count = ROW_COUNT;

  -- 3. Ingest Addresses (with DISTINCT ON to prevent duplicate gers_id)
  INSERT INTO public.campaign_addresses (campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom)
  SELECT DISTINCT ON (addr->>'gers_id')
    p_campaign_id,
    addr->>'gers_id',
    addr->>'house_number',
    addr->>'street_name',
    addr->>'postal_code',
    COALESCE(addr->>'formatted', trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', ')))),
    ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
  FROM jsonb_array_elements(v_addresses_array) AS addr
  WHERE addr->>'geometry' IS NOT NULL
  ORDER BY addr->>'gers_id';

  GET DIAGNOSTICS v_addr_count = ROW_COUNT;

  -- 4. Ingest Buildings (THE FIX: ON CONFLICT for collision-proof upsert)
  -- Buildings are global (not campaign-scoped), so we use ON CONFLICT to:
  -- - Claim existing buildings for this campaign
  -- - Update geometry if it changed
  -- - Reset status to 'default' for fresh linking
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, latest_status)
  SELECT DISTINCT ON (b->>'gers_id')
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default'
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ORDER BY b->>'gers_id'
  ON CONFLICT (gers_id) DO UPDATE SET
    campaign_id = p_campaign_id,       -- Claim it for this campaign
    latest_status = 'default',          -- Reset status for fresh linking
    geom = EXCLUDED.geom,               -- Update geometry if changed
    centroid = EXCLUDED.centroid,       -- Update centroid if changed
    height_m = EXCLUDED.height_m;       -- Update height if changed

  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count,
    'roads_saved', v_roads_count
  );
END;
$$;

COMMENT ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) IS
'Collision-proof ingest: inserts raw addresses, buildings, and roads for a campaign. Uses ON CONFLICT for buildings to handle duplicates gracefully (no more "duplicate key" crashes). Deletes only campaign-scoped data (links, slices, addresses, roads) before insert. Call link_campaign_data after to populate building_address_links and building_slices.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
