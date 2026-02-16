-- Better Simple Linker: Weighted Nearest Neighbor with Street Penalty
-- 
-- Key improvements over Street Name Lock approach:
-- 1. Distance to footprint (not centroid) - accurate for large/L-shaped buildings
-- 2. 80m search radius (not 25m) - catches rural/suburban setbacks
-- 3. Soft penalty (+50m score) for street mismatch - handles corner lots gracefully
-- 4. Variable confidence based on match quality
--
-- Strategy: "Covers, then Weighted Nearest"

-- Update link_campaign_data with BETTER SIMPLE approach
CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) 
RETURNS jsonb 
LANGUAGE plpgsql 
AS $$
DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
BEGIN
  -- ========================================================================
  -- PASS 1: ST_Covers (Highest Confidence - Point inside footprint)
  -- ========================================================================
  -- This is perfect - if an address point is inside a building, it's a match
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT 
    p_campaign_id, 
    ca.id, 
    b.id, 
    'COVERS', 
    1.0, 
    0
  FROM public.campaign_addresses ca
  JOIN public.buildings b ON ST_Covers(b.geom, ca.geom)
  WHERE ca.campaign_id = p_campaign_id 
    AND b.campaign_id = p_campaign_id
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET building_id = EXCLUDED.building_id, method = 'COVERS', confidence = 1.0;

  -- ========================================================================
  -- PASS 2: Weighted Nearest Neighbor with Street Penalty
  -- ========================================================================
  -- The Magic: Rank by Distance + Penalty instead of hard street locks
  -- 
  -- If street names match: Score = Distance (no penalty)
  -- If street names differ: Score = Distance + 50m (virtual penalty)
  --
  -- This handles corner lots automatically:
  -- - Building on side street at 5m: Score = 5 + 50 = 55m
  -- - Building on correct street at 15m: Score = 15m
  -- - Winner: Correct street building (15 < 55)
  INSERT INTO public.building_address_links (
    campaign_id, 
    address_id, 
    building_id, 
    method, 
    confidence, 
    distance_m
  )
  SELECT 
    p_campaign_id,
    ca.id AS address_id,
    best_match.id AS building_id,
    'NEAREST' AS method,
    -- Variable confidence based on match quality
    CASE 
      -- High confidence: names match and it's close (< 20m true distance)
      WHEN best_match.names_match AND best_match.dist < 20 THEN 0.9 
      -- Medium confidence: names match but farther away
      WHEN best_match.names_match THEN 0.7 
      -- Low confidence: names mismatch (corner lot or data error scenario)
      ELSE 0.4 
    END AS confidence,
    ROUND(best_match.dist::numeric, 2) AS distance_m
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT 
      b.id,
      -- 1. Calculate TRUE distance to the polygon (footprint), not centroid
      -- This handles large warehouses, L-shaped strip malls correctly
      ST_Distance(ca.geom::geography, b.geom::geography) AS dist,
      -- 2. Check strict street name match (case-insensitive)
      LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) AS names_match
    FROM public.buildings b
    WHERE b.campaign_id = p_campaign_id
      -- Expand search radius to 80m to catch rural/suburban setbacks
      AND ST_DWithin(ca.geom::geography, b.geom::geography, 80)
    ORDER BY 
      -- 3. THE MAGIC SAUCE: Rank by Distance + Penalty
      (
        ST_Distance(ca.geom::geography, b.geom::geography) + 
        CASE 
          -- If street names match (or address has no street), no penalty
          WHEN LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) 
               OR NULLIF(TRIM(ca.street_name), '') IS NULL 
          THEN 0 
          -- If streets differ, add 50m virtual penalty
          ELSE 50 
        END
      ) ASC
    LIMIT 1
  ) best_match
  WHERE ca.campaign_id = p_campaign_id
    -- Exclude addresses already linked in Pass 1
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links existing 
      WHERE existing.address_id = ca.id 
        AND existing.campaign_id = p_campaign_id
    )
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET 
    building_id = EXCLUDED.building_id, 
    method = 'NEAREST', 
    confidence = EXCLUDED.confidence,
    distance_m = EXCLUDED.distance_m;

  -- ========================================================================
  -- PASS 3: THE PURGE (Remove buildings that didn't match any address)
  -- ========================================================================
  DELETE FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links l 
      WHERE l.building_id = b.id 
        AND l.campaign_id = p_campaign_id
    );

  UPDATE public.buildings 
  SET latest_status = 'available' 
  WHERE campaign_id = p_campaign_id;

  -- ========================================================================
  -- PASS 4: THE SLICER (Voronoi partitioning for multi-unit buildings)
  -- ========================================================================
  -- Note: With weighted scoring, slicing only happens for legitimate 
  -- multi-unit buildings (e.g., townhouses on the SAME street)
  DELETE FROM public.building_slices 
  WHERE campaign_id = p_campaign_id;

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

  -- Return summary
  SELECT count(*) INTO v_link_count 
  FROM public.building_address_links 
  WHERE campaign_id = p_campaign_id;
  
  RETURN jsonb_build_object(
    'links_created', v_link_count,
    'slices_created', v_slice_count,
    'method', 'better_simple_weighted_nearest'
  );
END;
$$;

COMMENT ON FUNCTION public.link_campaign_data(uuid) IS
'BETTER SIMPLE linker with Weighted Nearest Neighbor: 
PASS 1: ST_Covers (point inside footprint),
PASS 2: Weighted nearest within 80m using footprint distance (not centroid) with 50m street-mismatch penalty,
PASS 3: Purge unlinked buildings,
PASS 4: Voronoi slicer for multi-unit buildings.

Key improvements:
- Distance to footprint (accurate for large/odd buildings)
- 80m search radius (catches rural/suburban setbacks)
- Soft 50m penalty for street mismatch (handles corner lots gracefully)
- Variable confidence: 0.9 (close+match), 0.7 (match), 0.4 (mismatch)';

-- Also update ingest_campaign_raw_data to ensure buildings have addr_street from Overture
-- This ensures the street matching in link_campaign_data works properly
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
  -- Normalize scalar string to array
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

  -- 1. Wipe links and slices for this campaign
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

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

  -- 4. Ingest Buildings with addr_street from Overture for better matching
  INSERT INTO public.buildings (
    gers_id, 
    geom, 
    centroid, 
    height_m, 
    campaign_id, 
    latest_status,
    addr_street  -- Store Overture street name for matching
  )
  SELECT DISTINCT ON (b->>'gers_id')
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default',
    b->>'addr_street'  -- Capture Overture address street if available
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ORDER BY b->>'gers_id'
  ON CONFLICT (gers_id) DO UPDATE SET
    campaign_id = p_campaign_id,
    latest_status = 'default',
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m,
    addr_street = EXCLUDED.addr_street;  -- Update street name on conflict

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
'Collision-proof ingest with addr_street capture for Better Simple linker. 
Stores Overture addr_street on buildings for weighted street-name matching.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
