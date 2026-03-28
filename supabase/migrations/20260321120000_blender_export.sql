-- =============================================================================
-- Blender export: RPCs for GeoJSON bundles + blender-exports storage bucket
-- =============================================================================

-- Align with app / tiledecode roads payload (additive columns; safe if already present)
ALTER TABLE public.campaign_roads
  ADD COLUMN IF NOT EXISTS road_id TEXT,
  ADD COLUMN IF NOT EXISTS road_name TEXT,
  ADD COLUMN IF NOT EXISTS road_class TEXT;

-- -----------------------------------------------------------------------------
-- get_campaign_geometry_meta
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_campaign_geometry_meta(p_campaign_id uuid)
RETURNS TABLE (
  centroid_lng double precision,
  centroid_lat double precision,
  boundary_geojson text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ST_X(ST_Centroid(c.territory_boundary))::double precision AS centroid_lng,
    ST_Y(ST_Centroid(c.territory_boundary))::double precision AS centroid_lat,
    ST_AsGeoJSON(c.territory_boundary)::text AS boundary_geojson
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;
$$;

-- -----------------------------------------------------------------------------
-- get_blender_target_buildings
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blender_target_buildings(p_campaign_id uuid)
RETURNS TABLE (
  id uuid,
  external_id text,
  geom_geojson text,
  address text,
  street_name text,
  house_number text,
  lead_status text,
  visited boolean,
  height_m double precision,
  floors integer,
  building_type text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (b.id)
    b.id,
    b.external_id::text,
    ST_AsGeoJSON(b.geom)::text AS geom_geojson,
    ca.formatted::text AS address,
    ca.street_name::text,
    ca.house_number::text,
    -- lead_status: use literal until address_statuses FK matches repo (campaign_address_id vs address_id, etc.)
    'none'::text AS lead_status,
    ca.visited,
    b.height_m::double precision,
    b.floors::integer,
    b.building_type::text
  FROM public.campaign_addresses ca
  INNER JOIN public.ref_buildings_gold b ON ca.building_id = b.id
  WHERE ca.campaign_id = p_campaign_id
    AND ca.building_id IS NOT NULL
  ORDER BY b.id, ca.seq NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- get_blender_context_buildings
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blender_context_buildings(
  p_campaign_id uuid,
  p_padding_meters double precision DEFAULT 50,
  p_simplify_tolerance double precision DEFAULT 0.000005
)
RETURNS TABLE (
  id uuid,
  external_id text,
  geom_geojson text,
  height_m double precision,
  floors integer,
  building_type text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (b.id)
    b.id,
    b.external_id::text,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geom, p_simplify_tolerance))::text AS geom_geojson,
    b.height_m::double precision,
    b.floors::integer,
    b.building_type::text
  FROM public.ref_buildings_gold b
  INNER JOIN public.campaigns c ON c.id = p_campaign_id
  WHERE ST_Intersects(
    b.geom,
    ST_Buffer(c.territory_boundary::geography, p_padding_meters)::geometry
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id = b.id
  )
  ORDER BY b.id
  LIMIT 2000;
$$;

-- -----------------------------------------------------------------------------
-- get_blender_roads
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blender_roads(p_campaign_id uuid)
RETURNS TABLE (
  road_id text,
  road_name text,
  road_class text,
  geom_geojson text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(r.road_id::text, r.id::text)::text AS road_id,
    COALESCE(r.road_name, '')::text AS road_name,
    COALESCE(NULLIF(BTRIM(COALESCE(r.road_class::text, '')), ''), 'street')::text AS road_class,
    ST_AsGeoJSON(r.geom)::text AS geom_geojson
  FROM public.campaign_roads r
  WHERE r.campaign_id = p_campaign_id;
$$;

-- -----------------------------------------------------------------------------
-- get_blender_addresses
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blender_addresses(p_campaign_id uuid)
RETURNS TABLE (
  id uuid,
  formatted text,
  street_name text,
  house_number text,
  lead_status text,
  visited boolean,
  building_id uuid,
  seq integer,
  geom_geojson text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.id,
    a.formatted::text,
    a.street_name::text,
    a.house_number::text,
    'none'::text AS lead_status,
    a.visited,
    a.building_id,
    a.seq::integer,
    ST_AsGeoJSON(a.geom)::text AS geom_geojson
  FROM public.campaign_addresses a
  WHERE a.campaign_id = p_campaign_id
    AND a.geom IS NOT NULL
  ORDER BY a.seq ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_geometry_meta(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_blender_target_buildings(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_blender_context_buildings(uuid, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_blender_roads(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_blender_addresses(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Storage: private bucket for Blender JSON exports
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blender-exports',
  'blender-exports',
  false,
  52428800,
  ARRAY['application/json'::text, 'text/plain'::text]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Service role full access to blender-exports" ON storage.objects;

CREATE POLICY "Service role full access to blender-exports"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'blender-exports')
WITH CHECK (bucket_id = 'blender-exports');
