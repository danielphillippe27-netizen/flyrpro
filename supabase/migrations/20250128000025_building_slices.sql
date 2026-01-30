-- Voronoi Building Slicer: Table and PASS 4 Logic
-- Creates building_slices table for multi-unit buildings and adds PASS 4 to link_campaign_data

-- 1. Create building_slices table
CREATE TABLE IF NOT EXISTS public.building_slices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    address_id UUID NOT NULL REFERENCES public.campaign_addresses(id) ON DELETE CASCADE,
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_slices_campaign ON public.building_slices(campaign_id);
CREATE INDEX IF NOT EXISTS idx_slices_building ON public.building_slices(building_id);
CREATE INDEX IF NOT EXISTS idx_slices_address ON public.building_slices(address_id);
CREATE INDEX IF NOT EXISTS idx_slices_geom ON public.building_slices USING GIST(geom);

-- Composite index for common join pattern
CREATE INDEX IF NOT EXISTS idx_slices_campaign_building_address ON public.building_slices(campaign_id, building_id, address_id);

COMMENT ON TABLE public.building_slices IS 'Voronoi slices for multi-unit buildings. One row per (campaign, address, building) representing the portion of the building footprint assigned to that address via Voronoi partitioning. Created during link_campaign_data PASS 4 for buildings with 2+ addresses.';

-- 2. RLS Policies (matching pattern from buildings/campaign_addresses)
ALTER TABLE public.building_slices ENABLE ROW LEVEL SECURITY;

-- View policy: Users can view slices for their campaigns
DROP POLICY IF EXISTS "Users can view building_slices for their campaigns" ON public.building_slices;
CREATE POLICY "Users can view building_slices for their campaigns"
ON public.building_slices FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.campaigns c
        WHERE c.id = building_slices.campaign_id
        AND c.owner_id = auth.uid()
    )
    OR building_slices.campaign_id IS NULL -- Allow viewing slices without campaign (for migration period)
);

-- Insert policy: Service role and authenticated users can insert (via RPC)
DROP POLICY IF EXISTS "Service role can insert building_slices" ON public.building_slices;
CREATE POLICY "Service role can insert building_slices"
ON public.building_slices FOR INSERT
WITH CHECK (auth.role() = 'service_role' OR auth.uid() IS NOT NULL);

-- Delete policy: Service role can delete (via RPC during re-provisioning)
DROP POLICY IF EXISTS "Service role can delete building_slices" ON public.building_slices;
CREATE POLICY "Service role can delete building_slices"
ON public.building_slices FOR DELETE
USING (auth.role() = 'service_role' OR auth.uid() IS NOT NULL);

-- 3. Update ingest_campaign_raw_data to delete slices
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

  -- Delete in order: slices, links, addresses, buildings (campaign-scoped)
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
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
'Stable linker ingest: inserts raw addresses and buildings for a campaign. Deletes existing slices, links, addresses, and buildings for the campaign. Does not set buildings.address_id. Call link_campaign_data after to populate building_address_links and building_slices.';

-- 4. Add PASS 4: THE SLICER to link_campaign_data
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

  -- PASS 4: THE SLICER (Voronoi partitioning for multi-unit buildings)
  -- Clear existing slices for this campaign (idempotent re-linking)
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;

  -- Generate Voronoi slices for buildings with 2+ addresses
  WITH multi_unit_buildings AS (
    -- Find buildings with 2 or more addresses
    SELECT building_id, count(*) as unit_count
    FROM public.building_address_links
    WHERE campaign_id = p_campaign_id
    GROUP BY building_id
    HAVING count(*) > 1
  ),
  building_points AS (
    -- Collect all address points per building
    SELECT 
      m.building_id,
      b.geom as building_geom,
      ca.id as address_id,
      ca.geom as address_geom
    FROM multi_unit_buildings m
    JOIN public.buildings b ON m.building_id = b.id
    JOIN public.building_address_links l ON l.building_id = b.id AND l.campaign_id = p_campaign_id
    JOIN public.campaign_addresses ca ON l.address_id = ca.id
  ),
  voronoi_per_building AS (
    -- Generate Voronoi diagram per building (one row per building with collection of cells)
    SELECT 
      building_id,
      building_geom,
      (ST_Dump(ST_VoronoiPolygons(ST_Collect(address_geom), 0.0, building_geom))).geom as cell_geom
    FROM building_points
    GROUP BY building_id, building_geom
  ),
  matched_slices AS (
    -- Match each Voronoi cell to its address point using ST_Contains
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
'Stable linker: PASS 1 ST_Covers (point in polygon), PASS 2 nearest building within 25m with Road Proximity and Frontage validation, PASS 3 purge unlinked buildings, PASS 4 Voronoi slicer for multi-unit buildings. PASS 4 generates building_slices for buildings with 2+ addresses using Voronoi partitioning: creates Voronoi cells from address points, intersects with building footprint, and stores one slice per address. Populates building_address_links and building_slices, sets buildings.latest_status = available for linked buildings.';

GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
