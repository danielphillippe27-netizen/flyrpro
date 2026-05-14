CREATE OR REPLACE FUNCTION public.rpc_get_campaign_parcels(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boundary geometry;
BEGIN
  SELECT ST_SetSRID(ST_MakeValid(c.territory_boundary), 4326)
  INTO v_boundary
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.territory_boundary IS NOT NULL;

  RETURN (
    WITH scoped AS (
      SELECT
        p.id,
        p.external_id,
        p.properties,
        CASE
          WHEN v_boundary IS NULL THEN p.geom
          ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(p.geom, v_boundary)), 3))
        END AS geom
      FROM public.campaign_parcels p
      WHERE p.campaign_id = p_campaign_id
        AND (v_boundary IS NULL OR ST_Intersects(p.geom, v_boundary))
    ),
    renderable AS (
      SELECT *
      FROM scoped
      WHERE geom IS NOT NULL
        AND NOT ST_IsEmpty(geom)
        AND ST_Area(geom::geography) > 0
    )
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geom)::jsonb,
            'properties', jsonb_build_object(
              'id', id,
              'parcel_id', COALESCE(NULLIF(external_id, ''), id::text),
              'external_id', external_id,
              'source', COALESCE(properties->>'source', 'campaign_parcels'),
              'area_sqm', ROUND(ST_Area(geom::geography)::numeric, 2)
            )
          )
          ORDER BY ST_Area(geom::geography) DESC
        ),
        '[]'::jsonb
      )
    )
    FROM renderable
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_parcels(uuid) TO authenticated, service_role;
