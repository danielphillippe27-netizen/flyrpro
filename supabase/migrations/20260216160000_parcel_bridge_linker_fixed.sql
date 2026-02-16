-- Parcel Bridge: Optional Middle Step for Superior Accuracy
-- FIXED VERSION - Handles existing objects

-- 1. Create campaign_parcels table (idempotent)
CREATE TABLE IF NOT EXISTS public.campaign_parcels (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
    external_id text,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    properties jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Spatial and foreign key indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_campaign_parcels_geom ON public.campaign_parcels USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_campaign_parcels_cmp ON public.campaign_parcels(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_parcels_external ON public.campaign_parcels(external_id);

-- Comments
COMMENT ON TABLE public.campaign_parcels IS 
'Parcel boundaries for campaign area. Used as "hard container" to link addresses to buildings when they share the same parcel.';

-- Enable RLS (idempotent)
ALTER TABLE public.campaign_parcels ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts, then recreate
DROP POLICY IF EXISTS "Users can view their campaign parcels" ON public.campaign_parcels;
DROP POLICY IF EXISTS "Service role can manage all parcels" ON public.campaign_parcels;

-- RLS Policy: Users can only see parcels for campaigns they own
CREATE POLICY "Users can view their campaign parcels"
    ON public.campaign_parcels FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            WHERE c.id = campaign_parcels.campaign_id
            AND c.owner_id = auth.uid()
        )
    );

-- Service role can manage all parcels
CREATE POLICY "Service role can manage all parcels"
    ON public.campaign_parcels FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Update link_campaign_data with Pass 2: PARCEL MATCH
CREATE OR REPLACE FUNCTION public.link_campaign_data(p_campaign_id uuid) 
RETURNS jsonb 
LANGUAGE plpgsql 
AS $$
DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
  v_covers_count INTEGER;
  v_parcel_count INTEGER;
  v_nearest_count INTEGER;
BEGIN
  -- ========================================================================
  -- PASS 1: ST_Covers (Highest Confidence - Point inside footprint)
  -- ========================================================================
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

  GET DIAGNOSTICS v_covers_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 2: PARCEL MATCH (The Golden Key for Accuracy)
  -- ========================================================================
  INSERT INTO public.building_address_links (
    campaign_id, 
    address_id, 
    building_id, 
    method, 
    confidence, 
    distance_m
  )
  SELECT DISTINCT ON (ca.id)
    ca.campaign_id,
    ca.id AS address_id,
    b.id AS building_id,
    'PARCEL' AS method,
    0.95 AS confidence,
    ROUND(ST_Distance(ca.geom::geography, b.geom::geography)::numeric, 2) AS distance_m
  FROM public.campaign_addresses ca
  JOIN public.campaign_parcels p 
    ON p.campaign_id = ca.campaign_id 
    AND ST_Covers(p.geom, ca.geom)
  JOIN public.buildings b 
    ON b.campaign_id = ca.campaign_id 
    AND ST_Covers(p.geom, b.centroid)
  WHERE 
    ca.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links existing 
      WHERE existing.address_id = ca.id 
        AND existing.campaign_id = p_campaign_id
    )
  ORDER BY 
    ca.id, 
    ST_Area(b.geom) DESC;

  GET DIAGNOSTICS v_parcel_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 3: Weighted Nearest Neighbor (Fallback)
  -- ========================================================================
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
    CASE 
      WHEN best_match.names_match AND best_match.dist < 20 THEN 0.9 
      WHEN best_match.names_match THEN 0.7 
      ELSE 0.4 
    END AS confidence,
    ROUND(best_match.dist::numeric, 2) AS distance_m
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT 
      b.id,
      ST_Distance(ca.geom::geography, b.geom::geography) AS dist,
      LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) AS names_match
    FROM public.buildings b
    WHERE b.campaign_id = p_campaign_id
      AND ST_DWithin(ca.geom::geography, b.geom::geography, 80)
    ORDER BY 
      (
        ST_Distance(ca.geom::geography, b.geom::geography) + 
        CASE 
          WHEN LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) 
               OR NULLIF(TRIM(ca.street_name), '') IS NULL 
          THEN 0 
          ELSE 50 
        END
      ) ASC
    LIMIT 1
  ) best_match
  WHERE ca.campaign_id = p_campaign_id
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

  GET DIAGNOSTICS v_nearest_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 4: THE PURGE
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
  -- PASS 5: THE SLICER
  -- ========================================================================
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
    'covers_count', v_covers_count,
    'parcel_count', v_parcel_count,
    'nearest_count', v_nearest_count,
    'slices_created', v_slice_count,
    'method', 'parcel_bridge_weighted_nearest'
  );
END;
$$;

-- 3. Update ingest_campaign_raw_data with optional parcels
CREATE OR REPLACE FUNCTION public.ingest_campaign_raw_data(
  p_campaign_id UUID,
  p_addresses JSONB,
  p_buildings JSONB,
  p_roads JSONB DEFAULT '[]',
  p_parcels JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_addresses_array JSONB;
  v_buildings_array JSONB;
  v_roads_array JSONB;
  v_parcels_array JSONB;
  v_addr_count INTEGER := 0;
  v_build_count INTEGER := 0;
  v_roads_count INTEGER := 0;
  v_parcels_count INTEGER := 0;
BEGIN
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
  IF p_parcels IS NOT NULL THEN
    IF jsonb_typeof(p_parcels) = 'string' THEN
      v_parcels_array := (p_parcels#>>'{}')::jsonb;
    ELSE
      v_parcels_array := p_parcels;
    END IF;
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
  IF v_parcels_array IS NULL OR jsonb_typeof(v_parcels_array) != 'array' THEN
    v_parcels_array := '[]'::jsonb;
  END IF;

  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_parcels WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

  INSERT INTO public.campaign_roads (campaign_id, gers_id, geom)
  SELECT DISTINCT ON (r->>'gers_id')
    p_campaign_id,
    r->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326))
  FROM jsonb_array_elements(v_roads_array) AS r
  WHERE r->>'geometry' IS NOT NULL
  ORDER BY r->>'gers_id';
  GET DIAGNOSTICS v_roads_count = ROW_COUNT;

  INSERT INTO public.campaign_parcels (campaign_id, external_id, geom, properties)
  SELECT DISTINCT ON (p->>'PARCELID')
    p_campaign_id,
    p->>'PARCELID',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(p->>'geometry'), 4326)),
    p - 'geometry'
  FROM jsonb_array_elements(v_parcels_array) AS p
  WHERE p->>'geometry' IS NOT NULL
  ORDER BY p->>'PARCELID';
  GET DIAGNOSTICS v_parcels_count = ROW_COUNT;

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

  INSERT INTO public.buildings (
    gers_id, geom, centroid, height_m, campaign_id, latest_status, addr_street
  )
  SELECT DISTINCT ON (b->>'gers_id')
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default',
    b->>'addr_street'
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ORDER BY b->>'gers_id'
  ON CONFLICT (gers_id) DO UPDATE SET
    campaign_id = p_campaign_id,
    latest_status = 'default',
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m,
    addr_street = EXCLUDED.addr_street;
  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count,
    'roads_saved', v_roads_count,
    'parcels_saved', v_parcels_count
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.ingest_campaign_raw_data(uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_data(uuid) TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_parcels TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
