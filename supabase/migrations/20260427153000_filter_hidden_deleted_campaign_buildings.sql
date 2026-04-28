-- Keep deleted/hidden building polygons out of rpc_get_campaign_full_features.
-- Building deletes can hide source-backed shapes via campaign_hidden_buildings,
-- and manual/campaign buildings may also be hidden with buildings.is_hidden.

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
    v_has_campaign_address_fk BOOLEAN;
    v_has_address_id_fk BOOLEAN;
    v_has_campaign_id_fk BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'address_statuses'
          AND column_name = 'campaign_address_id'
    ) INTO v_has_campaign_address_fk;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'address_statuses'
          AND column_name = 'address_id'
    ) INTO v_has_address_id_fk;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'address_statuses'
          AND column_name = 'campaign_id'
    ) INTO v_has_campaign_id_fk;

    IF NOT v_has_campaign_address_fk AND NOT (v_has_address_id_fk AND v_has_campaign_id_fk) THEN
        RAISE EXCEPTION 'address_statuses is missing a supported address foreign key shape';
    END IF;

    WITH latest_address_status AS (
        SELECT DISTINCT ON (status_rows.address_id)
            status_rows.address_id,
            status_rows.status
        FROM (
            SELECT
                CASE
                    WHEN v_has_campaign_address_fk
                        THEN NULLIF(to_jsonb(ast)->>'campaign_address_id', '')::uuid
                    WHEN v_has_address_id_fk AND v_has_campaign_id_fk
                        THEN NULLIF(to_jsonb(ast)->>'address_id', '')::uuid
                    ELSE NULL
                END AS address_id,
                CASE
                    WHEN v_has_campaign_address_fk
                        THEN NULL
                    WHEN v_has_address_id_fk AND v_has_campaign_id_fk
                        THEN NULLIF(to_jsonb(ast)->>'campaign_id', '')::uuid
                    ELSE NULL
                END AS campaign_id,
                ast.status,
                ast.updated_at,
                ast.created_at
            FROM public.address_statuses ast
        ) status_rows
        JOIN public.campaign_addresses ca
          ON ca.id = status_rows.address_id
         AND (
                v_has_campaign_address_fk
                OR status_rows.campaign_id = ca.campaign_id
             )
        WHERE ca.campaign_id = p_campaign_id
          AND status_rows.address_id IS NOT NULL
        ORDER BY
            status_rows.address_id,
            status_rows.updated_at DESC,
            status_rows.created_at DESC
    ),
    hidden_public_buildings AS (
        SELECT chb.public_building_id
        FROM public.campaign_hidden_buildings chb
        WHERE chb.campaign_id = p_campaign_id

        UNION

        SELECT COALESCE(b.gers_id::text, b.id::text) AS public_building_id
        FROM public.buildings b
        WHERE b.campaign_id = p_campaign_id
          AND COALESCE(b.is_hidden, false) = true
    ),
    gold_features AS (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id::text,
            'geometry', ST_AsGeoJSON(b.geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id::text,
                'building_id', b.id::text,
                'gers_id', b.id::text,
                'source', 'gold',
                'address_count', COUNT(ca.id),
                'address_id', CASE
                    WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.id ORDER BY ca.id))[1]::text
                    ELSE NULL
                END,
                'address_text', CASE
                    WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.formatted ORDER BY ca.id))[1]
                    ELSE NULL
                END,
                'house_number', CASE
                    WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.house_number ORDER BY ca.id))[1]
                    ELSE NULL
                END,
                'street_name', CASE
                    WHEN COUNT(ca.id) = 1 THEN (array_agg(ca.street_name ORDER BY ca.id))[1]
                    ELSE NULL
                END,
                'height', COALESCE(b.height_m, 10),
                'height_m', COALESCE(b.height_m, 10),
                'min_height', 0,
                'area_sqm', b.area_sqm,
                'building_type', b.building_type,
                'feature_type', 'matched_house',
                'feature_status', 'matched',
                'match_method', COALESCE((array_agg(ca.match_source ORDER BY ca.id))[1], 'gold_exact'),
                'confidence', COALESCE(MAX(ca.confidence), 1),
                'status', CASE
                    WHEN BOOL_OR(las.status IN ('talked', 'appointment', 'future_seller', 'hot_lead')) THEN 'hot'
                    WHEN BOOL_OR(las.status IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead'))
                      OR BOOL_OR(COALESCE(ca.visited, false)) THEN 'visited'
                    ELSE 'not_visited'
                END,
                'scans_today', 0,
                'scans_total', COALESCE(SUM(COALESCE(ca.scans, 0)), 0),
                'qr_scanned', COALESCE(SUM(COALESCE(ca.scans, 0)), 0) > 0
            )
        ) AS feature
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b
          ON b.id = ca.building_id
        LEFT JOIN latest_address_status las
          ON las.address_id = ca.id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NOT NULL
          AND NOT EXISTS (
                SELECT 1
                FROM hidden_public_buildings hpb
                WHERE hpb.public_building_id = b.id::text
          )
        GROUP BY b.id, b.geom, b.height_m, b.area_sqm, b.building_type
    ),
    campaign_building_address_matches AS (
        SELECT DISTINCT
            b.id AS row_building_id,
            ca.id AS address_id,
            ca.formatted,
            ca.house_number,
            ca.street_name,
            ca.visited,
            ca.scans,
            las.status AS address_status,
            COALESCE(l.match_type, CASE
                WHEN LOWER(COALESCE(to_jsonb(b)->>'source', '')) = 'manual' THEN 'manual'
                ELSE 'silver'
            END) AS match_type,
            COALESCE(l.confidence, 1) AS confidence
        FROM public.buildings b
        JOIN public.building_address_links l
          ON l.campaign_id = p_campaign_id
         AND (
                l.building_id::text = b.id::text
                OR (b.gers_id IS NOT NULL AND l.building_id::text = b.gers_id::text)
             )
        JOIN public.campaign_addresses ca
          ON ca.id = l.address_id
         AND ca.campaign_id = p_campaign_id
        LEFT JOIN latest_address_status las
          ON las.address_id = ca.id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom IS NOT NULL
          AND COALESCE(b.is_hidden, false) = false
          AND NOT EXISTS (
                SELECT 1
                FROM hidden_public_buildings hpb
                WHERE hpb.public_building_id = COALESCE(b.gers_id::text, b.id::text)
          )

        UNION

        SELECT DISTINCT
            b.id AS row_building_id,
            ca.id AS address_id,
            ca.formatted,
            ca.house_number,
            ca.street_name,
            ca.visited,
            ca.scans,
            las.status AS address_status,
            CASE
                WHEN LOWER(COALESCE(to_jsonb(b)->>'source', '')) = 'manual' THEN 'manual'
                ELSE 'silver'
            END AS match_type,
            1::numeric AS confidence
        FROM public.buildings b
        JOIN public.campaign_addresses ca
          ON ca.campaign_id = p_campaign_id
         AND ca.building_gers_id = COALESCE(b.gers_id::text, b.id::text)
        LEFT JOIN latest_address_status las
          ON las.address_id = ca.id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom IS NOT NULL
          AND COALESCE(b.is_hidden, false) = false
          AND NOT EXISTS (
                SELECT 1
                FROM hidden_public_buildings hpb
                WHERE hpb.public_building_id = COALESCE(b.gers_id::text, b.id::text)
          )
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
            COUNT(m.address_id) AS address_count,
            CASE
                WHEN COUNT(m.address_id) = 1
                    THEN (array_agg(m.address_id ORDER BY m.address_id))[1]::text
                ELSE NULL
            END AS address_id,
            CASE
                WHEN COUNT(m.address_id) = 1
                    THEN (array_agg(m.formatted ORDER BY m.address_id))[1]
                ELSE NULL
            END AS address_text,
            CASE
                WHEN COUNT(m.address_id) = 1
                    THEN (array_agg(m.house_number ORDER BY m.address_id))[1]
                ELSE NULL
            END AS house_number,
            CASE
                WHEN COUNT(m.address_id) = 1
                    THEN (array_agg(m.street_name ORDER BY m.address_id))[1]
                ELSE NULL
            END AS street_name,
            CASE
                WHEN COUNT(m.address_id) > 0
                    THEN (array_agg(m.match_type ORDER BY m.address_id))[1]
                ELSE NULL
            END AS match_method,
            CASE
                WHEN COUNT(m.address_id) > 0
                    THEN (array_agg(m.confidence ORDER BY m.address_id))[1]
                ELSE NULL
            END AS confidence,
            COALESCE(SUM(COALESCE(m.scans, 0)), 0) AS scans_total,
            BOOL_OR(m.address_status IN ('talked', 'appointment', 'future_seller', 'hot_lead')) AS has_hot_address,
            BOOL_OR(
                m.address_status IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                OR COALESCE(m.visited, false)
            ) AS has_visited_address
        FROM public.buildings b
        LEFT JOIN campaign_building_address_matches m
          ON m.row_building_id = b.id
        WHERE b.campaign_id = p_campaign_id
          AND b.geom IS NOT NULL
          AND COALESCE(b.is_hidden, false) = false
          AND NOT EXISTS (
                SELECT 1
                FROM hidden_public_buildings hpb
                WHERE hpb.public_building_id = COALESCE(b.gers_id::text, b.id::text)
          )
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
            'type', 'Feature',
            'id', public_building_id,
            'geometry', ST_AsGeoJSON(geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id', public_building_id,
                'building_id', public_building_id,
                'gers_id', public_building_id,
                'source', CASE
                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual'
                    ELSE 'silver'
                END,
                'address_count', address_count,
                'address_id', address_id,
                'address_text', address_text,
                'house_number', house_number,
                'street_name', street_name,
                'height', COALESCE(height_m, height, GREATEST(COALESCE(levels, 1), 1) * 3, 10),
                'height_m', COALESCE(height_m, height, GREATEST(COALESCE(levels, 1), 1) * 3, 10),
                'min_height', 0,
                'is_townhome', COALESCE(is_townhome_row, false),
                'units_count', GREATEST(COALESCE(units_count, address_count, 1), 1),
                'feature_type', CASE
                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual_building'
                    WHEN address_count > 0 THEN 'matched_house'
                    ELSE 'orphan'
                END,
                'feature_status', CASE
                    WHEN address_count > 0 THEN 'matched'
                    WHEN LOWER(COALESCE(source, '')) = 'manual' THEN 'manual'
                    ELSE 'unlinked'
                END,
                'match_method', match_method,
                'confidence', confidence,
                'status', CASE
                    WHEN has_hot_address THEN 'hot'
                    WHEN has_visited_address THEN 'visited'
                    WHEN COALESCE(latest_status, 'default') = 'interested' THEN 'visited'
                    ELSE 'not_visited'
                END,
                'scans_today', 0,
                'scans_total', scans_total,
                'qr_scanned', scans_total > 0
            )
        ) AS feature
        FROM campaign_building_rows
    ),
    address_point_features AS (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', ca.id::text,
            'geometry', ST_AsGeoJSON(ca.geom, 6)::jsonb,
            'properties', jsonb_build_object(
                'id', ca.id::text,
                'address_id', ca.id::text,
                'source', CASE
                    WHEN LOWER(COALESCE(ca.source, '')) = 'manual' THEN 'manual'
                    ELSE 'address_point'
                END,
                'feature_type', CASE
                    WHEN LOWER(COALESCE(ca.source, '')) = 'manual' THEN 'manual_address'
                    ELSE 'address_point'
                END,
                'feature_status', 'address_point',
                'address_text', ca.formatted,
                'house_number', ca.house_number,
                'street_name', ca.street_name,
                'height', 5,
                'height_m', 5,
                'min_height', 0,
                'status', CASE
                    WHEN las.status IN ('talked', 'appointment', 'future_seller', 'hot_lead') THEN 'hot'
                    WHEN las.status IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                      OR COALESCE(ca.visited, false) THEN 'visited'
                    ELSE 'not_visited'
                END,
                'scans_today', 0,
                'scans_total', COALESCE(ca.scans, 0),
                'qr_scanned', COALESCE(ca.scans, 0) > 0
            )
        ) AS feature
        FROM public.campaign_addresses ca
        LEFT JOIN latest_address_status las
          ON las.address_id = ca.id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.geom IS NOT NULL
          AND ca.building_id IS NULL
          AND ca.building_gers_id IS NULL
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

GRANT EXECUTE ON FUNCTION public.rpc_get_campaign_full_features(uuid) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(uuid) IS
'Returns a GeoJSON FeatureCollection for a campaign across gold, campaign-scoped, manual, and free address-point features, excluding hidden or deleted building polygons.';

NOTIFY pgrst, 'reload schema';
