-- Fix Stale Buildings: DELETE campaign buildings before re-ingest
-- 
-- Problem: ingest_campaign_raw_data uses ON CONFLICT (gers_id) DO UPDATE, which
-- only updates buildings with matching gers_id. Buildings from previous runs
-- with DIFFERENT gers_id values remain as "zombies" and inflate orphan counts.
--
-- Fix: Add DELETE FROM buildings WHERE campaign_id before the INSERT.

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
  v_deleted_buildings INTEGER := 0;
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

  -- 1. Wipe ALL campaign-scoped data (including buildings now!)
  -- Order matters: delete dependent tables first
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;
  
  -- THE FIX: Delete old buildings for this campaign to prevent zombie data
  DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;
  GET DIAGNOSTICS v_deleted_buildings = ROW_COUNT;

  -- 2. Ingest Roads (with DISTINCT ON to prevent duplicate gers_id)
  INSERT INTO public.campaign_roads (campaign_id, gers_id, geom)
  SELECT DISTINCT ON (r->>'gers_id')
    p_campaign_id,
    r->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326))
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

  -- 4. Ingest Buildings (fresh INSERT since we deleted first)
  -- No need for ON CONFLICT anymore since table is clean
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
    campaign_id = p_campaign_id,
    latest_status = 'default',
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m;

  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count,
    'buildings_deleted', v_deleted_buildings,
    'roads_saved', v_roads_count
  );
END;
$$;

COMMENT ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) IS
'Clean ingest: Deletes ALL existing campaign data (including buildings) before inserting fresh data from Overture. Prevents zombie buildings from previous runs.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
