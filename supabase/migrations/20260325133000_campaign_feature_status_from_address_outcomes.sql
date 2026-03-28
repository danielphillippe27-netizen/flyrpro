-- Canonicalize campaign feature status around persisted house outcomes.
-- Prefer address_statuses-derived status from campaign_addresses,
-- with campaign_addresses.visited only as a compatibility fallback.

CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    result         JSONB;
    v_gold_count   BIGINT;
    v_silver_count BIGINT;
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

    SELECT COUNT(DISTINCT ca.building_id) INTO v_gold_count
    FROM public.campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NOT NULL;

    IF v_gold_count > 0 THEN
        IF v_has_campaign_address_fk THEN
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
            ) INTO result
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', g.building_id,
                    'geometry', ST_AsGeoJSON(g.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id',             g.building_id,
                        'feature_id',     g.building_id,
                        'building_id',    g.building_id,
                        'gers_id',        g.building_id,
                        'address_id',     CASE WHEN g.addr_count = 1 THEN g.first_addr_id ELSE NULL END,
                        'address_text',   g.first_formatted,
                        'house_number',   g.first_house_number,
                        'street_name',    g.first_street_name,
                        'address_count',  g.addr_count,
                        'height',         COALESCE(g.height_m, 10),
                        'height_m',       COALESCE(g.height_m, 10),
                        'min_height',     0,
                        'feature_status', 'matched',
                        'feature_type',   'matched_house',
                        'match_method',   g.match_source,
                        'confidence',     g.confidence,
                        'status',         g.status,
                        'scans_total',    g.scans_total,
                        'qr_scanned',     g.scans_total > 0,
                        'source',         'gold'
                    )
                ) AS feature
                FROM (
                    SELECT
                        b.id AS building_id,
                        b.geom,
                        b.height_m,
                        COUNT(*) AS addr_count,
                        (array_agg(ca.id ORDER BY ca.house_number NULLS LAST))[1] AS first_addr_id,
                        (array_agg(ca.formatted ORDER BY ca.house_number NULLS LAST))[1] AS first_formatted,
                        (array_agg(ca.house_number ORDER BY ca.house_number NULLS LAST))[1] AS first_house_number,
                        (array_agg(ca.street_name ORDER BY ca.house_number NULLS LAST))[1] AS first_street_name,
                        (array_agg(COALESCE(ca.match_source, 'gold_exact')
                                   ORDER BY ca.house_number NULLS LAST))[1] AS match_source,
                        MAX(COALESCE(ca.confidence, 1.0)) AS confidence,
                        CASE
                            WHEN bool_or(COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead')) THEN 'hot'
                            WHEN bool_or(COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead'))
                              OR bool_or(COALESCE(ca.visited, false)) THEN 'visited'
                            ELSE 'not_visited'
                        END AS status,
                        SUM(COALESCE(ca.scans, 0))::int AS scans_total
                    FROM public.campaign_addresses ca
                    LEFT JOIN public.address_statuses ast ON ast.campaign_address_id = ca.id
                    JOIN public.ref_buildings_gold b ON b.id = ca.building_id
                    WHERE ca.campaign_id = p_campaign_id
                      AND ca.building_id IS NOT NULL
                    GROUP BY b.id, b.geom, b.height_m
                ) g
            ) f;
        ELSE
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
            ) INTO result
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', g.building_id,
                    'geometry', ST_AsGeoJSON(g.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id',             g.building_id,
                        'feature_id',     g.building_id,
                        'building_id',    g.building_id,
                        'gers_id',        g.building_id,
                        'address_id',     CASE WHEN g.addr_count = 1 THEN g.first_addr_id ELSE NULL END,
                        'address_text',   g.first_formatted,
                        'house_number',   g.first_house_number,
                        'street_name',    g.first_street_name,
                        'address_count',  g.addr_count,
                        'height',         COALESCE(g.height_m, 10),
                        'height_m',       COALESCE(g.height_m, 10),
                        'min_height',     0,
                        'feature_status', 'matched',
                        'feature_type',   'matched_house',
                        'match_method',   g.match_source,
                        'confidence',     g.confidence,
                        'status',         g.status,
                        'scans_total',    g.scans_total,
                        'qr_scanned',     g.scans_total > 0,
                        'source',         'gold'
                    )
                ) AS feature
                FROM (
                    SELECT
                        b.id AS building_id,
                        b.geom,
                        b.height_m,
                        COUNT(*) AS addr_count,
                        (array_agg(ca.id ORDER BY ca.house_number NULLS LAST))[1] AS first_addr_id,
                        (array_agg(ca.formatted ORDER BY ca.house_number NULLS LAST))[1] AS first_formatted,
                        (array_agg(ca.house_number ORDER BY ca.house_number NULLS LAST))[1] AS first_house_number,
                        (array_agg(ca.street_name ORDER BY ca.house_number NULLS LAST))[1] AS first_street_name,
                        (array_agg(COALESCE(ca.match_source, 'gold_exact')
                                   ORDER BY ca.house_number NULLS LAST))[1] AS match_source,
                        MAX(COALESCE(ca.confidence, 1.0)) AS confidence,
                        CASE
                            WHEN bool_or(COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead')) THEN 'hot'
                            WHEN bool_or(COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead'))
                              OR bool_or(COALESCE(ca.visited, false)) THEN 'visited'
                            ELSE 'not_visited'
                        END AS status,
                        SUM(COALESCE(ca.scans, 0))::int AS scans_total
                    FROM public.campaign_addresses ca
                    LEFT JOIN public.address_statuses ast
                      ON ast.address_id = ca.id
                     AND ast.campaign_id = ca.campaign_id
                    JOIN public.ref_buildings_gold b ON b.id = ca.building_id
                    WHERE ca.campaign_id = p_campaign_id
                      AND ca.building_id IS NOT NULL
                    GROUP BY b.id, b.geom, b.height_m
                ) g
            ) f;
        END IF;

        RETURN result;
    END IF;

    SELECT COUNT(*) INTO v_silver_count
    FROM public.building_address_links bal
    WHERE bal.campaign_id = p_campaign_id;

    IF v_silver_count > 0 THEN
        IF v_has_campaign_address_fk THEN
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
            ) INTO result
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', b.gers_id,
                    'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id', b.gers_id,
                        'feature_id', bal.address_id,
                        'building_id', b.gers_id,
                        'gers_id', b.gers_id,
                        'address_id', ca.id,
                        'address_text', ca.formatted,
                        'house_number', ca.house_number,
                        'street_name', ca.street_name,
                        'height', COALESCE(b.height, 10),
                        'height_m', COALESCE(b.height, 10),
                        'min_height', 0,
                        'feature_status', 'matched',
                        'feature_type', 'matched_house',
                        'match_method', COALESCE(bal.match_type, 'silver'),
                        'confidence', COALESCE(bal.confidence, 0.8),
                        'status', CASE
                            WHEN COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead') THEN 'hot'
                            WHEN COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                              OR COALESCE(ca.visited, false) THEN 'visited'
                            ELSE 'not_visited'
                        END,
                        'scans_total', COALESCE(ca.scans, 0),
                        'qr_scanned', COALESCE(ca.scans, 0) > 0,
                        'source', 'silver'
                    )
                ) AS feature
                FROM public.building_address_links bal
                JOIN public.buildings b ON b.gers_id = bal.building_id
                JOIN public.campaign_addresses ca ON ca.id = bal.address_id
                LEFT JOIN public.address_statuses ast ON ast.campaign_address_id = ca.id
                WHERE bal.campaign_id = p_campaign_id
            ) f;
        ELSE
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
            ) INTO result
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', b.gers_id,
                    'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id', b.gers_id,
                        'feature_id', bal.address_id,
                        'building_id', b.gers_id,
                        'gers_id', b.gers_id,
                        'address_id', ca.id,
                        'address_text', ca.formatted,
                        'house_number', ca.house_number,
                        'street_name', ca.street_name,
                        'height', COALESCE(b.height, 10),
                        'height_m', COALESCE(b.height, 10),
                        'min_height', 0,
                        'feature_status', 'matched',
                        'feature_type', 'matched_house',
                        'match_method', COALESCE(bal.match_type, 'silver'),
                        'confidence', COALESCE(bal.confidence, 0.8),
                        'status', CASE
                            WHEN COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead') THEN 'hot'
                            WHEN COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                              OR COALESCE(ca.visited, false) THEN 'visited'
                            ELSE 'not_visited'
                        END,
                        'scans_total', COALESCE(ca.scans, 0),
                        'qr_scanned', COALESCE(ca.scans, 0) > 0,
                        'source', 'silver'
                    )
                ) AS feature
                FROM public.building_address_links bal
                JOIN public.buildings b ON b.gers_id = bal.building_id
                JOIN public.campaign_addresses ca ON ca.id = bal.address_id
                LEFT JOIN public.address_statuses ast
                  ON ast.address_id = ca.id
                 AND ast.campaign_id = ca.campaign_id
                WHERE bal.campaign_id = p_campaign_id
            ) f;
        END IF;

        RETURN result;
    END IF;

    IF v_has_campaign_address_fk THEN
        SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
                jsonb_build_object(
                    'type', 'Feature',
                    'id', ca.id,
                    'geometry', ST_AsGeoJSON(ca.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id', ca.id,
                        'feature_id', ca.id,
                        'address_id', ca.id,
                        'address_text', ca.formatted,
                        'height', 10,
                        'height_m', 10,
                        'status', CASE
                            WHEN COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead') THEN 'hot'
                            WHEN COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                              OR COALESCE(ca.visited, false) THEN 'visited'
                            ELSE 'not_visited'
                        END,
                        'scans_total', COALESCE(ca.scans, 0),
                        'qr_scanned', COALESCE(ca.scans, 0) > 0,
                        'source', 'address_point'
                    )
                )
            ), '[]'::jsonb)
        ) INTO result
        FROM public.campaign_addresses ca
        LEFT JOIN public.address_statuses ast ON ast.campaign_address_id = ca.id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.geom IS NOT NULL;
    ELSE
        SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
                jsonb_build_object(
                    'type', 'Feature',
                    'id', ca.id,
                    'geometry', ST_AsGeoJSON(ca.geom)::jsonb,
                    'properties', jsonb_build_object(
                        'id', ca.id,
                        'feature_id', ca.id,
                        'address_id', ca.id,
                        'address_text', ca.formatted,
                        'height', 10,
                        'height_m', 10,
                        'status', CASE
                            WHEN COALESCE(ast.status, 'none') IN ('talked', 'appointment', 'future_seller', 'hot_lead') THEN 'hot'
                            WHEN COALESCE(ast.status, 'none') IN ('no_answer', 'delivered', 'talked', 'appointment', 'do_not_knock', 'future_seller', 'hot_lead')
                              OR COALESCE(ca.visited, false) THEN 'visited'
                            ELSE 'not_visited'
                        END,
                        'scans_total', COALESCE(ca.scans, 0),
                        'qr_scanned', COALESCE(ca.scans, 0) > 0,
                        'source', 'address_point'
                    )
                )
            ), '[]'::jsonb)
        ) INTO result
        FROM public.campaign_addresses ca
        LEFT JOIN public.address_statuses ast
          ON ast.address_id = ca.id
         AND ast.campaign_id = ca.campaign_id
        WHERE ca.campaign_id = p_campaign_id
          AND ca.geom IS NOT NULL;
    END IF;

    RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_campaign_buildings_geojson(
    p_campaign_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN public.rpc_get_campaign_full_features(p_campaign_id);
END;
$$;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(UUID)
IS 'Campaign feature GeoJSON with status derived from persisted address outcomes first, then visited fallback.';
