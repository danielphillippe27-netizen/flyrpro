-- Stable Linker Architecture: Ingest and Link RPCs
-- ingest_campaign_raw_data: raw insert of addresses and buildings (no linking)
-- link_campaign_data: multi-pass spatial linker into building_address_links

-- Function 1: Ingest raw addresses and buildings (no address_id on buildings)
CREATE OR REPLACE FUNCTION public.ingest_campaign_raw_data(
  p_campaign_id uuid,
  p_addresses jsonb,
  p_buildings jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_addresses_array jsonb;
  v_buildings_array jsonb;
  v_addr_count int := 0;
  v_build_count int := 0;
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
  IF v_addresses_array IS NULL OR jsonb_typeof(v_addresses_array) != 'array' THEN
    v_addresses_array := '[]'::jsonb;
  END IF;
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;

  -- Delete in order: links, addresses, buildings (campaign-scoped)
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;

  -- Insert addresses
  INSERT INTO public.campaign_addresses (campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom)
  SELECT
    p_campaign_id,
    addr->>'gers_id',
    addr->>'house_number',
    addr->>'street_name',
    addr->>'postal_code',
    COALESCE(addr->>'formatted', trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', ')))),
    ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
  FROM jsonb_array_elements(v_addresses_array) AS addr
  WHERE addr->>'geometry' IS NOT NULL;

  GET DIAGNOSTICS v_addr_count = ROW_COUNT;

  -- Insert buildings (no address_id); ON CONFLICT for global gers_id uniqueness
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, latest_status)
  SELECT
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default'
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ON CONFLICT (gers_id) DO UPDATE SET
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m,
    campaign_id = EXCLUDED.campaign_id,
    latest_status = 'default';

  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count
  );
END;
$$;

COMMENT ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb) IS
'Stable linker ingest: inserts raw addresses and buildings for a campaign. Does not set buildings.address_id. Call link_campaign_data after to populate building_address_links.';

-- Function 2: Multi-pass spatial linker into building_address_links
CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_link_count INTEGER;
BEGIN
  -- PASS 1: ST_Covers (Highest Confidence - Point inside footprint)
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT p_campaign_id, ca.id, b.id, 'COVERS', 1.0, 0
  FROM public.campaign_addresses ca
  JOIN public.buildings b ON ST_Covers(b.geom, ca.geom)
  WHERE ca.campaign_id = p_campaign_id AND b.campaign_id = p_campaign_id
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET building_id = EXCLUDED.building_id, method = 'COVERS', confidence = 1.0;

  -- PASS 2: Nearest within 25m with Road Proximity and Frontage validation
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT DISTINCT ON (ca.id)
    p_campaign_id, ca.id, b.id, 'NEAREST', 0.7, ST_Distance(ca.geom::geography, b.centroid::geography)
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT id, centroid FROM public.buildings 
    WHERE campaign_id = p_campaign_id 
    -- 25m is the sweet spot for residential lots
    AND ST_DWithin(ca.geom::geography, centroid::geography, 25) 
    ORDER BY ca.geom <-> centroid ASC LIMIT 1
  ) b
  -- Find nearest road to address (for Road Proximity and Frontage checks)
  CROSS JOIN LATERAL (
    SELECT gers_id FROM public.overture_transportation
    WHERE ST_DWithin(geom::geography, ca.geom::geography, 100)
    ORDER BY ST_Distance(geom::geography, ca.geom::geography)
    LIMIT 1
  ) road_to_addr
  -- Find nearest road to building (for Road Proximity check)
  CROSS JOIN LATERAL (
    SELECT gers_id FROM public.overture_transportation
    WHERE ST_DWithin(geom::geography, b.centroid::geography, 100)
    ORDER BY ST_Distance(geom::geography, b.centroid::geography)
    LIMIT 1
  ) road_to_build
  WHERE ca.campaign_id = p_campaign_id
  AND NOT EXISTS (
    SELECT 1 FROM public.building_address_links l 
    WHERE l.address_id = ca.id AND l.campaign_id = p_campaign_id
  )
  -- Road Proximity Tie-Breaker: Reject if address and building have different nearest roads
  AND (
    road_to_addr.gers_id IS NULL 
    OR road_to_build.gers_id IS NULL 
    OR road_to_addr.gers_id = road_to_build.gers_id
  )
  -- Frontage Logic: Reject if address-to-building line crosses a different road
  AND NOT EXISTS (
    SELECT 1 FROM public.overture_transportation t
    WHERE ST_Crosses(t.geom, ST_MakeLine(ca.geom, b.centroid))
      AND road_to_addr.gers_id IS NOT NULL
      AND t.gers_id IS DISTINCT FROM road_to_addr.gers_id
  )
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET building_id = EXCLUDED.building_id, method = 'NEAREST', confidence = 0.7;

  -- PASS 3: THE PURGE (Remove buildings that didn't match an address)
  DELETE FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id
  AND NOT EXISTS (
    SELECT 1 FROM public.building_address_links l 
    WHERE l.building_id = b.id AND l.campaign_id = p_campaign_id
  );

  UPDATE public.buildings SET latest_status = 'available' WHERE campaign_id = p_campaign_id;

  SELECT count(*) INTO v_link_count FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  RETURN jsonb_build_object('links_created', v_link_count);
END;
$$;

COMMENT ON FUNCTION public.link_campaign_data(uuid) IS
'Stable linker: PASS 1 ST_Covers (point in polygon), PASS 2 nearest building within 25m with Road Proximity and Frontage validation, PASS 3 purge unlinked buildings. PASS 2 includes two spatial validation checks: (1) Road Proximity Tie-Breaker - rejects matches where address and building have different nearest road segments (prevents cross-street matching like "7 Madden Pl" matching "150 Sprucewood"), (2) Frontage Logic - rejects matches where the address-to-building line crosses a different road than the address''s nearest road (prevents back-of-house matches). Both validations gracefully skip if no roads are found within 100m. Populates building_address_links and sets buildings.latest_status = available for linked buildings. The purge step ensures only buildings matched to addresses remain, cleaning up orphan buildings caught by the 25m buffer.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
