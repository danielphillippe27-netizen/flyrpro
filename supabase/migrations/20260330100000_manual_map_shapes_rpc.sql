-- Manual map shapes: make campaign feature RPC union Gold + campaign buildings + free address points.
-- This allows manual buildings and manual address cylinders to travel through the same canonical feature
-- stream that the iOS map already uses for rendering, tapping, linking, and address resolution.

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH latest_address_status AS (
        SELECT DISTINCT ON (ast.campaign_address_id)
            ast.campaign_address_id AS address_id,
            ast.status
        FROM public.address_statuses ast
        JOIN public.campaign_addresses ca
          ON ca.id = ast.campaign_address_id
        WHERE ca.campaign_id = p_campaign_id
        ORDER BY ast.campaign_address_id, ast.updated_at DESC, ast.created_at DESC
    ),
    gold_features AS (
        SELECT jsonb_build_object(
            'type',       'Feature',
            'id',         b.id::text,
            'geometry',   ST_AsGeoJSON(b.geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id',            b.id::text,
                'building_id',   b.id::text,
                'gers_id',       b.id::text,
                'source',        'gold',
                'address_count', COUNT(ca.id),
                'address_id',    CASE WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.id ORDER BY ca.id))[1]::text ELSE NULL END,
                'address_text',  CASE WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.formatted ORDER BY ca.id))[1] ELSE NULL END,
                'house_number',  CASE WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.house_number ORDER BY ca.id))[1] ELSE NULL END,
                'street_name',   CASE WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.street_name ORDER BY ca.id))[1] ELSE NULL END,
                'height',        COALESCE(b.height_m, 10),
                'height_m',      COALESCE(b.height_m, 10),
                'min_height',    0,
                'area_sqm',      b.area_sqm,
                'building_type', b.building_type,
                'feature_type',  'matched_house',
                'feature_status','matched',
                'status',        CASE
                                    WHEN BOOL_OR(las.status IN ('talked', 'appointment', 'hot_lead')) THEN 'hot'
                                    WHEN BOOL_OR(las.status IN ('delivered', 'do_not_knock', 'future_seller'))
                                         OR BOOL_OR(COALESCE(ca.visited, false)) THEN 'visited'
                                    ELSE 'not_visited'
                                 END,
                'scans_today',   0,
                'scans_total',   COALESCE(SUM(COALESCE(ca.scans, 0)), 0)
            )
        ) AS feature
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b ON b.id = ca.building_id
        LEFT JOIN latest_address_status las ON las.address_id = ca.id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NOT NULL
        GROUP BY b.id, b.geom, b.height_m, b.area_sqm, b.building_type
    ),
    campaign_building_rows AS (
        SELECT
            COALESCE(b.gers_id::text, b.id::text) AS public_building_id,
            b.id AS row_building_id,
            b.geom,
            to_jsonb(b)->>'source' AS source,
            b.height_m,
            b.height,
            b.levels,
            b.is_townhome_row,
            b.units_count,
            b.latest_status,
            COUNT(ca.id) FILTER (WHERE ca.id IS NOT NULL) AS address_count,
            CASE
                WHEN COUNT(ca.id) FILTER (WHERE ca.id IS NOT NULL) = 1
                    THEN (array_agg(ca.id ORDER BY ca.id))[1]::text
                ELSE NULL
            END AS address_id,
            CASE
                WHEN COUNT(ca.id) FILTER (WHERE ca.id IS NOT NULL) = 1
                    THEN (array_agg(ca.formatted ORDER BY ca.id))[1]
                ELSE NULL
            END AS address_text,
            CASE
                WHEN COUNT(ca.id) FILTER (WHERE ca.id IS NOT NULL) = 1
                    THEN (array_agg(ca.house_number ORDER BY ca.id))[1]
                ELSE NULL
            END AS house_number,
            CASE
                WHEN COUNT(ca.id) FILTER (WHERE ca.id IS NOT NULL) = 1
                    THEN (array_agg(ca.street_name ORDER BY ca.id))[1]
                ELSE NULL
            END AS street_name,
            COALESCE(SUM(COALESCE(ca.scans, 0)), 0) AS scans_total,
            BOOL_OR(las.status IN ('talked', 'appointment', 'hot_lead')) AS has_hot_address,
            BOOL_OR(
                las.status IN ('delivered', 'do_not_knock', 'future_seller')
                OR COALESCE(ca.visited, false)
            ) AS has_visited_address
        FROM public.buildings b
        LEFT JOIN public.building_address_links l
            ON l.campaign_id = p_campaign_id
           AND (
                l.building_id::text = b.id::text
                OR (b.gers_id IS NOT NULL AND l.building_id::text = b.gers_id::text)
           )
        LEFT JOIN public.campaign_addresses ca
            ON ca.id = l.address_id
           AND ca.campaign_id = p_campaign_id
        LEFT JOIN latest_address_status las
            ON las.address_id = ca.id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom IS NOT NULL
        GROUP BY
            b.id,
            b.gers_id,
            b.geom,
            to_jsonb(b)->>'source',
            b.height_m,
            b.height,
            b.levels,
            b.is_townhome_row,
            b.units_count,
            b.latest_status
    ),
    campaign_building_features AS (
        SELECT jsonb_build_object(
            'type',       'Feature',
            'id',         public_building_id,
            'geometry',   ST_AsGeoJSON(geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id',            public_building_id,
                'building_id',   public_building_id,
                'gers_id',       public_building_id,
                'source',        CASE
                                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual'
                                    ELSE 'silver'
                                 END,
                'address_count', address_count,
                'address_id',    address_id,
                'address_text',  address_text,
                'house_number',  house_number,
                'street_name',   street_name,
                'height',        COALESCE(height_m, height, GREATEST(COALESCE(levels, 1), 1) * 3, 10),
                'height_m',      COALESCE(height_m, height, GREATEST(COALESCE(levels, 1), 1) * 3, 10),
                'min_height',    0,
                'is_townhome',   COALESCE(is_townhome_row, false),
                'units_count',   GREATEST(COALESCE(units_count, address_count, 1), 1),
                'feature_type',  CASE
                                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual_building'
                                    ELSE 'matched_house'
                                 END,
                'feature_status',CASE
                                    WHEN address_count > 0 THEN 'matched'
                                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual'
                                    ELSE 'unlinked'
                                 END,
                'status',        CASE
                                    WHEN has_hot_address THEN 'hot'
                                    WHEN has_visited_address THEN 'visited'
                                    WHEN COALESCE(latest_status, 'default') = 'interested' THEN 'visited'
                                    ELSE 'not_visited'
                                 END,
                'scans_today',   0,
                'scans_total',   scans_total
            )
        ) AS feature
        FROM campaign_building_rows
    ),
    address_point_features AS (
        SELECT jsonb_build_object(
            'type',       'Feature',
            'id',         ca.id::text,
            'geometry',   ST_AsGeoJSON(ca.geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id',            ca.id::text,
                'address_id',    ca.id::text,
                'source',        CASE
                                    WHEN LOWER(COALESCE(ca.source, '')) = 'manual' THEN 'manual'
                                    ELSE 'address_point'
                                 END,
                'feature_type',  CASE
                                    WHEN LOWER(COALESCE(ca.source, '')) = 'manual' THEN 'manual_address'
                                    ELSE 'address_point'
                                 END,
                'feature_status','address_point',
                'address_text',  ca.formatted,
                'house_number',  ca.house_number,
                'street_name',   ca.street_name,
                'height',        5,
                'height_m',      5,
                'min_height',    0,
                'status',        CASE
                                    WHEN las.status IN ('talked', 'appointment', 'hot_lead') THEN 'hot'
                                    WHEN las.status IN ('delivered', 'do_not_knock', 'future_seller')
                                         OR COALESCE(ca.visited, false) THEN 'visited'
                                    ELSE 'not_visited'
                                 END,
                'scans_today',   0,
                'scans_total',   COALESCE(ca.scans, 0)
            )
        ) AS feature
        FROM public.campaign_addresses ca
        LEFT JOIN latest_address_status las ON las.address_id = ca.id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.geom IS NOT NULL
          AND ca.building_id IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.building_address_links l
              WHERE l.campaign_id = p_campaign_id
                AND l.address_id = ca.id
          )
    )
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(all_features.feature), '[]'::jsonb)
    )
    INTO v_result
    FROM (
        SELECT feature FROM gold_features
        UNION ALL
        SELECT feature FROM campaign_building_features
        UNION ALL
        SELECT feature FROM address_point_features
    ) AS all_features;

    IF v_result IS NULL THEN
        v_result := '{"type":"FeatureCollection","features":[]}'::jsonb;
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_addresses(
    p_campaign_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', a.id,
            'geometry', ST_AsGeoJSON(a.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', a.id,
                'gers_id', a.gers_id,
                'building_gers_id', a.building_gers_id,
                'house_number', a.house_number,
                'street_name', a.street_name,
                'postal_code', a.postal_code,
                'locality', a.locality,
                'formatted', a.formatted,
                'source', a.source
            )
        ) AS feature
        FROM public.campaign_addresses a
        WHERE a.campaign_id = p_campaign_id
    ) features;

    RETURN COALESCE(result, '{"type":"FeatureCollection","features":[]}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_full_features(uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_addresses(uuid) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(uuid) IS
'Returns a GeoJSON FeatureCollection for a campaign. Unions Gold buildings, campaign-scoped buildings (including manual), and free address points so all map objects come from one canonical feed.';

COMMENT ON FUNCTION public.rpc_get_campaign_addresses(uuid) IS
'Returns GeoJSON FeatureCollection of all campaign addresses, including source metadata for manual address cylinders.';

NOTIFY pgrst, 'reload schema';
