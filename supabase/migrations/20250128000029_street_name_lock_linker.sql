-- Street Name Lock: Prevents cross-street address-to-building linking
-- Also fixes MultiLineString road ingestion from Overture
--
-- Key changes:
-- 1. ALTER campaign_roads.geom to accept GEOMETRY (allows both LineString and MultiLineString)
-- 2. Update ingest_campaign_raw_data to wrap roads in ST_Multi()
-- 3. Add Street Name Lock to link_campaign_data Pass 2

-- 1. Alter campaign_roads to accept any geometry type (LineString or MultiLineString)
ALTER TABLE public.campaign_roads 
ALTER COLUMN geom TYPE GEOMETRY(GEOMETRY, 4326) 
USING geom::GEOMETRY(GEOMETRY, 4326);

-- 2. Update ingest_campaign_raw_data to handle MultiLineString roads
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
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

  -- 2. Ingest Roads (with DISTINCT ON to prevent duplicate gers_id)
  -- FIX: Use ST_Multi to handle both LineString and MultiLineString from Overture
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

  -- 4. Ingest Buildings (ON CONFLICT for collision-proof upsert)
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
    'roads_saved', v_roads_count
  );
END;
$$;

COMMENT ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) IS
'Collision-proof ingest with MultiLineString road support: inserts raw addresses, buildings, and roads for a campaign. Uses ST_Multi for roads to handle both LineString and MultiLineString from Overture.';

-- 3. Update link_campaign_data with STREET NAME LOCK in Pass 2
CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
BEGIN
  -- PASS 1: ST_Covers (Highest Confidence - Point inside footprint)
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT p_campaign_id, ca.id, b.id, 'COVERS', 1.0, 0
  FROM public.campaign_addresses ca
  JOIN public.buildings b ON ST_Covers(b.geom, ca.geom)
  WHERE ca.campaign_id = p_campaign_id AND b.campaign_id = p_campaign_id
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET building_id = EXCLUDED.building_id, method = 'COVERS', confidence = 1.0;

  -- PASS 2: Surgical Nearest with STREET NAME LOCK
  -- Key addition: NOT EXISTS check ensures a building can only be linked to addresses on the SAME street
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT DISTINCT ON (ca.id)
    p_campaign_id, ca.id, b.id, 'NEAREST', 0.7, ST_Distance(ca.geom::geography, b.centroid::geography)
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT bld.id, bld.centroid FROM public.buildings bld
    WHERE bld.campaign_id = p_campaign_id 
    AND ST_DWithin(ca.geom::geography, bld.centroid::geography, 25)
    -- THE STREET NAME LOCK:
    -- Ensure this building isn't already linked to an address on a DIFFERENT street
    AND NOT EXISTS (
        SELECT 1 FROM public.building_address_links l
        JOIN public.campaign_addresses ca2 ON l.address_id = ca2.id
        WHERE l.building_id = bld.id 
        AND l.campaign_id = p_campaign_id
        AND lower(trim(ca2.street_name)) IS DISTINCT FROM lower(trim(ca.street_name))
    )
    ORDER BY ca.geom <-> bld.centroid ASC LIMIT 1
  ) b
  LEFT JOIN LATERAL (
    SELECT gers_id FROM public.campaign_roads r
    WHERE r.campaign_id = p_campaign_id
    AND ST_DWithin(r.geom::geography, ca.geom::geography, 100)
    ORDER BY ST_Distance(r.geom::geography, ca.geom::geography)
    LIMIT 1
  ) road_to_addr ON true
  LEFT JOIN LATERAL (
    SELECT gers_id FROM public.campaign_roads r
    WHERE r.campaign_id = p_campaign_id
    AND ST_DWithin(r.geom::geography, b.centroid::geography, 100)
    ORDER BY ST_Distance(r.geom::geography, b.centroid::geography)
    LIMIT 1
  ) road_to_build ON true
  WHERE ca.campaign_id = p_campaign_id
  AND NOT EXISTS (
    SELECT 1 FROM public.building_address_links l 
    WHERE l.address_id = ca.id AND l.campaign_id = p_campaign_id
  )
  AND (
    road_to_addr.gers_id IS NULL 
    OR road_to_build.gers_id IS NULL 
    OR road_to_addr.gers_id = road_to_build.gers_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.campaign_roads t
    WHERE t.campaign_id = p_campaign_id
    AND ST_Crosses(t.geom, ST_MakeLine(ca.geom::geometry, b.centroid::geometry))
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

  -- PASS 4: THE SLICER (Voronoi partitioning for multi-unit buildings)
  -- Note: With Street Name Lock, slicing should only happen for legitimate multi-unit buildings
  -- (e.g., townhouses sharing a footprint on the SAME street)
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;

  WITH multi_unit_buildings AS (
    SELECT building_id, count(*) as unit_count
    FROM public.building_address_links
    WHERE campaign_id = p_campaign_id
    GROUP BY building_id
    HAVING count(*) > 1
  ),
  building_points AS (
    SELECT 
      m.building_id,
      b.geom::geometry as building_geom,
      ca.id as address_id,
      ca.geom::geometry as address_geom
    FROM multi_unit_buildings m
    JOIN public.buildings b ON m.building_id = b.id
    JOIN public.building_address_links l ON l.building_id = b.id AND l.campaign_id = p_campaign_id
    JOIN public.campaign_addresses ca ON l.address_id = ca.id
  ),
  voronoi_per_building AS (
    SELECT 
      building_id,
      building_geom,
      (ST_Dump(ST_VoronoiPolygons(ST_Collect(address_geom::geometry), 0.0, building_geom))).geom as cell_geom
    FROM building_points
    GROUP BY building_id, building_geom
  ),
  matched_slices AS (
    SELECT 
      v.building_id,
      v.building_geom,
      bp.address_id,
      ST_Multi(ST_Intersection(v.building_geom, v.cell_geom)) as unit_geom
    FROM voronoi_per_building v
    JOIN building_points bp ON v.building_id = bp.building_id 
      AND ST_Contains(v.cell_geom, bp.address_geom)
  )
  INSERT INTO public.building_slices (campaign_id, address_id, building_id, geom)
  SELECT 
    p_campaign_id,
    address_id,
    building_id,
    unit_geom
  FROM matched_slices
  WHERE ST_GeometryType(unit_geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND NOT ST_IsEmpty(unit_geom);

  GET DIAGNOSTICS v_slice_count = ROW_COUNT;

  SELECT count(*) INTO v_link_count FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  RETURN jsonb_build_object(
    'links_created', v_link_count,
    'slices_created', v_slice_count
  );
END;
$$;

COMMENT ON FUNCTION public.link_campaign_data(uuid) IS
'Stable linker with STREET NAME LOCK: PASS 1 ST_Covers, PASS 2 nearest within 25m with Street Name Lock (prevents cross-street linking), PASS 3 purge unlinked buildings, PASS 4 Voronoi slicer for legitimate multi-unit buildings.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';