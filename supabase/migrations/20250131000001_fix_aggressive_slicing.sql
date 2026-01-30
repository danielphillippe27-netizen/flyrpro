-- Fix Aggressive Voronoi Slicing: Only slice buildings where ALL addresses are INSIDE footprint
-- 
-- Problem: The Voronoi slicer applies to ANY building with count(*) > 1 links.
-- This incorrectly slices detached houses when multiple addresses are matched
-- via NEAREST (addresses outside the footprint).
--
-- Fix: Only slice buildings where ALL linked addresses are INSIDE the footprint
-- (matched via ST_Covers). If ANY address is OUTSIDE (NEAREST match), skip slicing.

CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
  v_orphan_count INTEGER;
  v_skipped_slicing INTEGER := 0;
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
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT DISTINCT ON (ca.id)
    p_campaign_id, ca.id, b.id, 'NEAREST', 0.7, ST_Distance(ca.geom::geography, b.centroid::geography)
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT bld.id, bld.centroid FROM public.buildings bld
    WHERE bld.campaign_id = p_campaign_id 
    AND ST_DWithin(ca.geom::geography, bld.centroid::geography, 25)
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

  -- PASS 3: Update statuses (NO PURGE - keep orphans for toggle)
  UPDATE public.buildings SET latest_status = 'available' 
  WHERE campaign_id = p_campaign_id
  AND id IN (SELECT building_id FROM public.building_address_links WHERE campaign_id = p_campaign_id);

  -- Count orphans for reporting
  SELECT count(*) INTO v_orphan_count 
  FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id
  AND NOT EXISTS (
    SELECT 1 FROM public.building_address_links l 
    WHERE l.building_id = b.id AND l.campaign_id = p_campaign_id
  );

  -- PASS 4: THE SMART SLICER (Only slice TRULY multi-unit buildings)
  -- Key change: Only slice if ALL linked addresses are INSIDE the building footprint
  -- This prevents slicing detached homes where NEAREST matches created false multi-links
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;

  WITH multi_unit_buildings AS (
    -- Buildings with more than 1 address link
    SELECT l.building_id, count(*) as unit_count
    FROM public.building_address_links l
    WHERE l.campaign_id = p_campaign_id
    GROUP BY l.building_id
    HAVING count(*) > 1
  ),
  -- THE FIX: Filter to only buildings where ALL addresses are INSIDE the footprint
  truly_multi_unit AS (
    SELECT m.building_id, m.unit_count
    FROM multi_unit_buildings m
    JOIN public.buildings b ON m.building_id = b.id
    WHERE NOT EXISTS (
      -- Exclude if ANY linked address is OUTSIDE the building footprint
      -- (i.e., was matched via NEAREST, not COVERS)
      SELECT 1 FROM public.building_address_links l
      JOIN public.campaign_addresses ca ON l.address_id = ca.id
      WHERE l.building_id = m.building_id
      AND l.campaign_id = p_campaign_id
      AND NOT ST_Covers(b.geom, ca.geom)  -- Address point is OUTSIDE footprint
    )
  ),
  building_points AS (
    SELECT 
      m.building_id,
      b.geom::geometry as building_geom,
      ca.id as address_id,
      ca.geom::geometry as address_geom
    FROM truly_multi_unit m  -- Use filtered list instead of multi_unit_buildings
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

  -- Count how many multi-unit buildings were skipped (detached homes)
  -- Must re-query since CTE is out of scope after the INSERT statement
  SELECT count(*) INTO v_skipped_slicing
  FROM (
    SELECT l.building_id
    FROM public.building_address_links l
    WHERE l.campaign_id = p_campaign_id
    GROUP BY l.building_id
    HAVING count(*) > 1
  ) multi_unit
  WHERE EXISTS (
    -- Has at least one address OUTSIDE the building footprint (NEAREST match)
    SELECT 1 FROM public.building_address_links l2
    JOIN public.campaign_addresses ca ON l2.address_id = ca.id
    JOIN public.buildings b ON l2.building_id = b.id
    WHERE l2.building_id = multi_unit.building_id
    AND l2.campaign_id = p_campaign_id
    AND NOT ST_Covers(b.geom, ca.geom)
  );

  SELECT count(*) INTO v_link_count FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  RETURN jsonb_build_object(
    'links_created', v_link_count,
    'slices_created', v_slice_count,
    'orphan_buildings', v_orphan_count,
    'detached_homes_not_sliced', v_skipped_slicing
  );
END;
$$;

COMMENT ON FUNCTION public.link_campaign_data(uuid) IS
'Smart linker with STREET NAME LOCK and NO PURGE: PASS 1 ST_Covers, PASS 2 nearest within 25m, PASS 3 update statuses (keep orphans), PASS 4 Voronoi slicer ONLY for truly multi-unit buildings (all addresses inside footprint). Detached homes with NEAREST matches are NOT sliced.';

GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
