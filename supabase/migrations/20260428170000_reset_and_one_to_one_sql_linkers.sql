-- Make SQL relinking actually repair existing bad links.
--
-- The shed-filter migration only affected new candidates. Existing
-- campaign_addresses.building_id and building_address_links rows remained, and
-- the proximity passes could still create stale/ambiguous address assignments.
-- This migration:
--   1. clears existing campaign links at the start of each SQL linker run
--   2. keeps the shed/outbuilding filter
--   3. ranks parcel/proximity fallback by address, so each address keeps only
--      its single best building while buildings may keep multiple addresses

CREATE OR REPLACE FUNCTION public.clear_campaign_building_links(
    p_campaign_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.building_address_links
    WHERE campaign_id = p_campaign_id;

    DELETE FROM public.building_slices
    WHERE campaign_id = p_campaign_id;

    UPDATE public.campaign_addresses
    SET building_id = NULL,
        building_gers_id = NULL,
        match_source = NULL,
        confidence = NULL
    WHERE campaign_id = p_campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_campaign_building_links(UUID) TO authenticated, service_role;

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
    PERFORM public.clear_campaign_building_links(p_campaign_id);

    v_campaign_poly := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);
    v_campaign_poly := ST_Buffer(v_campaign_poly::geography, 100)::geometry;

    -- Exact containment: address point inside a linkable municipal building.
    UPDATE public.campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM public.ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND public.is_linkable_building_footprint(b.geom, b.building_type)
      AND b.geom && v_campaign_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    -- Parcel bridge: best building for each address inside the same parcel.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            COALESCE(b.area_sqm, ST_Area(b.geom::geography)) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.ref_buildings_gold b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    -- Proximity fallback: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b
          ON b.geom && v_campaign_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (ranked.dist / 60.0))
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;
END;
$$;

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
    v_gold_exact    BIGINT := 0;
    v_gold_parcel   BIGINT := 0;
    v_gold_prox     BIGINT := 0;
    v_silver_exact  BIGINT := 0;
    v_silver_parcel BIGINT := 0;
    v_silver_prox   BIGINT := 0;
    v_poly          GEOMETRY;
BEGIN
    PERFORM public.clear_campaign_building_links(p_campaign_id);

    SELECT COALESCE(
        territory_boundary,
        ST_GeomFromGeoJSON(campaign_polygon_snapped::text)::GEOMETRY,
        ST_GeomFromGeoJSON(campaign_polygon_raw::text)::GEOMETRY
    ) INTO v_poly
    FROM public.campaigns WHERE id = p_campaign_id;

    IF v_poly IS NULL THEN
        SELECT ST_ConvexHull(ST_Collect(ca.geom)) INTO v_poly
        FROM public.campaign_addresses ca
        WHERE ca.campaign_id = p_campaign_id AND ca.geom IS NOT NULL;
    END IF;

    IF v_poly IS NULL THEN
        RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
        RETURN;
    END IF;

    v_poly := ST_Buffer(v_poly::GEOGRAPHY, 100)::GEOMETRY;

    -- Gold exact.
    UPDATE public.campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM public.ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND public.is_linkable_building_footprint(b.geom, b.building_type)
      AND b.geom && v_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    GET DIAGNOSTICS v_gold_exact = ROW_COUNT;

    -- Gold parcel: best building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            COALESCE(b.area_sqm, ST_Area(b.geom::geography)) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.ref_buildings_gold b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    GET DIAGNOSTICS v_gold_parcel = ROW_COUNT;

    -- Gold proximity: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b
          ON b.geom && v_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (ranked.dist / 60.0))
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    GET DIAGNOSTICS v_gold_prox = ROW_COUNT;

    -- Silver exact.
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        ca.id,
        b.gers_id,
        'containment_verified',
        1.0,
        0
    FROM public.campaign_addresses ca
    JOIN public.buildings b
      ON b.geom && v_poly
     AND b.geom && ca.geom
     AND public.is_linkable_building_footprint(b.geom)
     AND ST_Covers(b.geom, ca.geom)
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_exact = ROW_COUNT;

    -- Silver parcel: best building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.gers_id AS building_id,
            ST_Area(b.geom::geography) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.buildings b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        address_id,
        building_id,
        'parcel_verified',
        0.95,
        ROUND(dist::numeric, 2)
    FROM ranked
    WHERE address_rank = 1
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_parcel = ROW_COUNT;

    -- Silver proximity: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.gers_id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.buildings b
          ON b.geom && v_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        address_id,
        building_id,
        'proximity_verified',
        GREATEST(0.5, 1.0 - (dist / 60.0)),
        dist
    FROM ranked
    WHERE address_rank = 1
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

GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_gold(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_campaign_addresses_all(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.link_campaign_addresses_gold(UUID, JSONB) IS
'Gold linker with reset, shed filtering, and one-best-building-per-address parcel/proximity assignment.';

COMMENT ON FUNCTION public.link_campaign_addresses_all(UUID) IS
'Gold/Silver linker with reset, shed filtering, and one-best-building-per-address parcel/proximity assignment.';

NOTIFY pgrst, 'reload schema';
