-- Zero-Gap Discovery: Global Address Cache + Remove Linker Purge
-- 
-- Key changes:
-- 1. Create global_address_cache table to store paid Mapbox reverse geocode results forever
-- 2. Update link_campaign_data to REMOVE THE PURGE (keep orphan buildings for toggle visibility)

-- 1. Global Address Cache (save paid geocodes forever)
-- This prevents duplicate API calls and saves money on Mapbox fees
CREATE TABLE IF NOT EXISTS public.global_address_cache (
    gers_id TEXT PRIMARY KEY,           -- Building GERS ID (the orphan we reverse geocoded)
    house_number TEXT,
    street_name TEXT,
    postal_code TEXT,
    formatted_address TEXT,
    centroid GEOMETRY(POINT, 4326),     -- Store the centroid for reference
    source TEXT DEFAULT 'mapbox',       -- Track which API provided this
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add index for spatial queries (if we ever need to find cached addresses near a point)
CREATE INDEX IF NOT EXISTS idx_global_address_cache_centroid 
ON public.global_address_cache USING GIST (centroid);

-- Enable RLS but allow service_role full access
ALTER TABLE public.global_address_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to global_address_cache"
ON public.global_address_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Grant access
GRANT SELECT, INSERT, UPDATE ON public.global_address_cache TO service_role;
GRANT SELECT ON public.global_address_cache TO authenticated;

COMMENT ON TABLE public.global_address_cache IS 
'Global cache for paid reverse geocode results. Stores Mapbox responses keyed by building gers_id to avoid duplicate API calls across campaigns.';

-- 2. Update link_campaign_data to REMOVE THE PURGE
-- This allows orphan buildings (buildings without address links) to remain visible
-- The frontend can then toggle them on/off using feature_status = orphan_building
CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
  v_orphan_count INTEGER;
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

  -- PASS 3: THE PURGE IS REMOVED
  -- Previously we deleted unlinked buildings here. Now we KEEP them so the frontend
  -- can show them as "orphan_building" (grey) and the user can toggle them on/off.
  -- This enables the Discovery feature to find addresses for them via reverse geocoding.
  
  -- Update linked buildings to 'available' status
  UPDATE public.buildings SET latest_status = 'available' 
  WHERE campaign_id = p_campaign_id
  AND id IN (SELECT building_id FROM public.building_address_links WHERE campaign_id = p_campaign_id);

  -- Keep orphan buildings with 'default' status (they're still valid structures, just no address yet)
  -- Count orphans for reporting
  SELECT count(*) INTO v_orphan_count 
  FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id
  AND NOT EXISTS (
    SELECT 1 FROM public.building_address_links l 
    WHERE l.building_id = b.id AND l.campaign_id = p_campaign_id
  );

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
    'slices_created', v_slice_count,
    'orphan_buildings', v_orphan_count
  );
END;
$$;

COMMENT ON FUNCTION public.link_campaign_data(uuid) IS
'Stable linker with STREET NAME LOCK and NO PURGE: PASS 1 ST_Covers, PASS 2 nearest within 25m with Street Name Lock (prevents cross-street linking), PASS 3 removed (keeps orphan buildings for toggle), PASS 4 Voronoi slicer. Returns orphan_buildings count for Discovery phase.';

GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
