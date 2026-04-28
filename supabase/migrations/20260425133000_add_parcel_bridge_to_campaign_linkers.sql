-- Add parcel-aware matching to the campaign linker RPCs used by provisioning and repair paths.

CREATE OR REPLACE FUNCTION public.link_campaign_addresses_gold(
    p_campaign_id UUID,
    p_polygon_geojson JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_campaign_poly geometry;
BEGIN
    v_campaign_poly := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);
    v_campaign_poly := ST_Buffer(v_campaign_poly::geography, 100)::geometry;

    -- 1. Exact containment inside municipal Gold buildings.
    UPDATE campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND b.geom && v_campaign_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    -- 2. Parcel bridge: address and building share the same parcel.
    UPDATE campaign_addresses ca
    SET building_id = sub.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM (
        SELECT DISTINCT ON (ca2.id)
            ca2.id AS address_id,
            b.id AS building_id
        FROM campaign_addresses ca2
        JOIN campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca2.geom)
        JOIN ref_buildings_gold b
          ON b.geom && p.geom
         AND ST_Covers(
             p.geom,
             COALESCE(b.centroid, ST_PointOnSurface(b.geom))
         )
        WHERE ca2.campaign_id = p_campaign_id
          AND ca2.building_id IS NULL
          AND ca2.geom IS NOT NULL
        ORDER BY ca2.id, ST_Area(b.geom) DESC
    ) sub
    WHERE ca.id = sub.address_id;

    -- 3. Proximity fallback.
    UPDATE campaign_addresses ca
    SET building_id = sub.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (sub.dist / 60.0))
    FROM (
        SELECT
            ca2.id AS address_id,
            nearest.id AS building_id,
            nearest.dist
        FROM campaign_addresses ca2
        CROSS JOIN LATERAL (
            SELECT b.id,
                   ST_Distance(ca2.geom::geography, b.geom::geography) AS dist
            FROM ref_buildings_gold b
            WHERE b.geom && v_campaign_poly
              AND b.geom && ST_Expand(ca2.geom, 0.0003)
              AND ST_DWithin(b.geom::geography, ca2.geom::geography, 30)
            ORDER BY b.geom <-> ca2.geom
            LIMIT 1
        ) nearest
        WHERE ca2.campaign_id = p_campaign_id
          AND ca2.building_id IS NULL
          AND ca2.geom IS NOT NULL
    ) sub
    WHERE ca.id = sub.address_id;
END;
$$;

COMMENT ON FUNCTION public.link_campaign_addresses_gold(UUID, JSONB) IS
'Fast Gold linker with parcel bridge: exact containment, shared parcel matching, then proximity fallback.';

CREATE OR REPLACE FUNCTION public.link_campaign_addresses_all(
    p_campaign_id UUID
)
RETURNS TABLE (
    gold_exact   BIGINT,
    gold_prox    BIGINT,
    silver_exact BIGINT,
    silver_prox  BIGINT,
    total_linked BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_gold_exact   BIGINT := 0;
    v_gold_parcel  BIGINT := 0;
    v_gold_prox    BIGINT := 0;
    v_silver_exact BIGINT := 0;
    v_silver_parcel BIGINT := 0;
    v_silver_prox  BIGINT := 0;
    v_poly         GEOMETRY;
BEGIN
    SELECT COALESCE(
        territory_boundary,
        ST_GeomFromGeoJSON(campaign_polygon_snapped::text)::GEOMETRY,
        ST_GeomFromGeoJSON(campaign_polygon_raw::text)::GEOMETRY
    ) INTO v_poly
    FROM campaigns WHERE id = p_campaign_id;

    IF v_poly IS NULL THEN
        SELECT ST_ConvexHull(ST_Collect(ca.geom)) INTO v_poly
        FROM campaign_addresses ca
        WHERE ca.campaign_id = p_campaign_id AND ca.geom IS NOT NULL;
    END IF;

    IF v_poly IS NULL THEN
        RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
        RETURN;
    END IF;

    v_poly := ST_Buffer(v_poly::GEOGRAPHY, 100)::GEOMETRY;

    -- GOLD exact
    UPDATE campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND b.geom && v_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    GET DIAGNOSTICS v_gold_exact = ROW_COUNT;

    -- GOLD parcel bridge
    UPDATE campaign_addresses ca
    SET building_id = sub.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM (
        SELECT DISTINCT ON (ca2.id)
            ca2.id AS address_id,
            b.id AS building_id
        FROM campaign_addresses ca2
        JOIN campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca2.geom)
        JOIN ref_buildings_gold b
          ON b.geom && p.geom
         AND ST_Covers(
             p.geom,
             COALESCE(b.centroid, ST_PointOnSurface(b.geom))
         )
        WHERE ca2.campaign_id = p_campaign_id
          AND ca2.building_id IS NULL
          AND ca2.geom IS NOT NULL
        ORDER BY ca2.id, ST_Area(b.geom) DESC
    ) sub
    WHERE ca.id = sub.address_id;

    GET DIAGNOSTICS v_gold_parcel = ROW_COUNT;

    -- GOLD proximity fallback
    UPDATE campaign_addresses ca
    SET building_id = sub.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (sub.dist / 60.0))
    FROM (
        SELECT
            ca2.id AS address_id,
            nearest.id AS building_id,
            nearest.dist
        FROM campaign_addresses ca2
        CROSS JOIN LATERAL (
            SELECT b.id,
                   ST_Distance(ca2.geom::geography, b.geom::geography) AS dist
            FROM ref_buildings_gold b
            WHERE b.geom && v_poly
              AND b.geom && ST_Expand(ca2.geom, 0.0003)
              AND ST_DWithin(b.geom::geography, ca2.geom::geography, 30)
            ORDER BY b.geom <-> ca2.geom
            LIMIT 1
        ) nearest
        WHERE ca2.campaign_id = p_campaign_id
          AND ca2.building_id IS NULL
          AND ca2.geom IS NOT NULL
    ) sub
    WHERE ca.id = sub.address_id;

    GET DIAGNOSTICS v_gold_prox = ROW_COUNT;

    -- SILVER exact
    INSERT INTO building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        ca.id,
        b.gers_id,
        'containment_verified',
        1.0,
        0
    FROM campaign_addresses ca
    JOIN buildings b
      ON b.geom && v_poly
     AND b.geom && ca.geom
     AND ST_Covers(b.geom, ca.geom)
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM building_address_links bal
          WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
      )
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_exact = ROW_COUNT;

    -- SILVER parcel bridge
    INSERT INTO building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT DISTINCT ON (ca.id)
        p_campaign_id,
        ca.id,
        b.gers_id,
        'parcel_verified',
        0.95,
        ROUND(ST_Distance(ca.geom::geography, b.geom::geography)::numeric, 2)
    FROM campaign_addresses ca
    JOIN campaign_parcels p
      ON p.campaign_id = p_campaign_id
     AND ST_Covers(p.geom, ca.geom)
    JOIN buildings b
      ON b.geom && p.geom
     AND ST_Covers(
         p.geom,
         COALESCE(b.centroid, ST_PointOnSurface(b.geom))
     )
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM building_address_links bal
          WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
      )
    ORDER BY ca.id, ST_Area(b.geom) DESC
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_parcel = ROW_COUNT;

    -- SILVER proximity fallback
    INSERT INTO building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        sub.address_id,
        sub.gers_id,
        'proximity_verified',
        GREATEST(0.5, 1.0 - (sub.dist / 60.0)),
        sub.dist
    FROM (
        SELECT
            ca.id AS address_id,
            nearest.gers_id,
            nearest.dist
        FROM campaign_addresses ca
        CROSS JOIN LATERAL (
            SELECT b.gers_id,
                   ST_Distance(ca.geom::geography, b.geom::geography) AS dist
            FROM buildings b
            WHERE b.geom && v_poly
              AND b.geom && ST_Expand(ca.geom, 0.0003)
              AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
            ORDER BY b.geom <-> ca.geom
            LIMIT 1
        ) nearest
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ) sub
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_prox = ROW_COUNT;

    RETURN QUERY SELECT
        v_gold_exact,
        v_gold_parcel + v_gold_prox,
        v_silver_exact,
        v_silver_parcel + v_silver_prox,
        v_gold_exact + v_gold_parcel + v_gold_prox + v_silver_exact + v_silver_parcel + v_silver_prox;
END;
$$;

COMMENT ON FUNCTION public.link_campaign_addresses_all(UUID) IS
'Links campaign addresses with exact, parcel-bridge, and proximity passes across Gold and Silver buildings.';
