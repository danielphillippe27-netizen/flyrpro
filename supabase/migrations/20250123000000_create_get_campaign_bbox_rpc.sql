-- RPC Function: Get Campaign Bounding Box
-- Computes bbox directly in PostgreSQL using ST_Extent
-- Casts geography to geometry to support the aggregate function

CREATE OR REPLACE FUNCTION public.get_campaign_bbox(c_id uuid)
RETURNS TABLE(
  min_lon double precision,
  min_lat double precision,
  max_lon double precision,
  max_lat double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ST_XMin(ext)::float8 AS min_lon,
    ST_YMin(ext)::float8 AS min_lat,
    ST_XMax(ext)::float8 AS max_lon,
    ST_YMax(ext)::float8 AS max_lat
  FROM (
    -- FIX: Cast geography to geometry here
    SELECT ST_Extent(geom::geometry) AS ext
    FROM public.campaign_addresses
    WHERE campaign_id = c_id
      AND geom IS NOT NULL
  ) s
  WHERE ext IS NOT NULL;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_campaign_bbox(uuid) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION public.get_campaign_bbox(uuid) IS $$
Returns bounding box (min_lon, min_lat, max_lon, max_lat) for all addresses in a campaign.
Computes bbox directly in PostgreSQL using ST_Extent (casted to geometry).
Returns empty result if no valid geometries exist.
$$;
