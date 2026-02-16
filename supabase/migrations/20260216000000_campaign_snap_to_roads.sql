-- Snap to Roads: campaign polygon raw/snapped storage and road-boundary RPCs
-- Enables snapping campaign boundaries to Overture road centerlines.

-- 1. Campaigns table: raw polygon, snapped polygon, and is_snapped flag
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS campaign_polygon_raw jsonb,
  ADD COLUMN IF NOT EXISTS campaign_polygon_snapped jsonb,
  ADD COLUMN IF NOT EXISTS is_snapped boolean DEFAULT false;

COMMENT ON COLUMN public.campaigns.campaign_polygon_raw IS 'Original user-drawn polygon as GeoJSON (before snap to roads)';
COMMENT ON COLUMN public.campaigns.campaign_polygon_snapped IS 'Snapped-to-roads polygon as GeoJSON';
COMMENT ON COLUMN public.campaigns.is_snapped IS 'True when territory_boundary has been snapped to road centerlines';

-- 2. get_roads_in_bbox: return Overture road segments intersecting bbox + 100m buffer
--    Filter to drivable/block-forming roads only (exclude footway, cycleway, etc.)
CREATE OR REPLACE FUNCTION public.get_roads_in_bbox(
  min_lon double precision,
  min_lat double precision,
  max_lon double precision,
  max_lat double precision
)
RETURNS TABLE (
  gers_id text,
  geojson jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  bbox_geom geometry(Polygon, 4326);
  bbox_geog geography;
  buffered geography;
BEGIN
  -- Bbox as polygon (closed ring)
  bbox_geom := ST_SetSRID(
    ST_MakePolygon(ST_GeomFromText(
      'LINESTRING(' || min_lon || ' ' || min_lat || ',' ||
      max_lon || ' ' || min_lat || ',' ||
      max_lon || ' ' || max_lat || ',' ||
      min_lon || ' ' || max_lat || ',' ||
      min_lon || ' ' || min_lat || ')'
    )),
    4326
  );
  bbox_geog := bbox_geom::geography;
  buffered := ST_Buffer(bbox_geog, 100);

  RETURN QUERY
  SELECT
    t.gers_id,
    ST_AsGeoJSON(t.geom)::jsonb AS geojson
  FROM public.overture_transportation t
  WHERE ST_Intersects(t.geom::geography, buffered)
    AND (t.class IS NULL OR t.class NOT IN ('footway', 'cycleway', 'track', 'bridleway', 'path'));
END;
$$;

COMMENT ON FUNCTION public.get_roads_in_bbox(double precision, double precision, double precision, double precision) IS
'Return Overture road segments (LineString as GeoJSON) intersecting bbox + 100m buffer. Excludes footway, cycleway, track, bridleway, path for block-aligned snapping.';

-- 3. update_campaign_boundary: single RPC to write boundary + raw/snapped (transaction, return updated row as GeoJSON)
CREATE OR REPLACE FUNCTION public.update_campaign_boundary(
  p_campaign_id uuid,
  p_boundary_geojson jsonb,
  p_raw_geojson jsonb,
  p_is_snapped boolean
)
RETURNS TABLE (
  territory_boundary_geojson jsonb,
  campaign_polygon_raw jsonb,
  campaign_polygon_snapped jsonb,
  is_snapped boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_boundary_geom geometry(Polygon, 4326);
  v_row public.campaigns%ROWTYPE;
BEGIN
  -- Parse boundary and update in one transaction
  v_boundary_geom := ST_GeomFromGeoJSON(p_boundary_geojson::text)::geometry(Polygon, 4326);

  UPDATE public.campaigns
  SET
    territory_boundary = v_boundary_geom,
    campaign_polygon_raw = p_raw_geojson,
    campaign_polygon_snapped = CASE WHEN p_is_snapped THEN p_boundary_geojson ELSE campaign_polygon_snapped END,
    is_snapped = p_is_snapped
  WHERE id = p_campaign_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Return updated row with geometry as GeoJSON so UI and DB stay in sync
  territory_boundary_geojson := ST_AsGeoJSON(v_row.territory_boundary)::jsonb;
  campaign_polygon_raw := v_row.campaign_polygon_raw;
  campaign_polygon_snapped := v_row.campaign_polygon_snapped;
  is_snapped := v_row.is_snapped;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.update_campaign_boundary(uuid, jsonb, jsonb, boolean) IS
'Update campaign boundary and raw/snapped polygons in a transaction. Returns updated row with territory_boundary as GeoJSON. Use this instead of direct geometry updates from the JS client.';
