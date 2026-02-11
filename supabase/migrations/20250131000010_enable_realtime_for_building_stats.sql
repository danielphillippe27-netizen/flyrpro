-- Enable Supabase Realtime for building_stats and scan_events tables
-- These tables need realtime enabled for the map to receive instant updates when QR codes are scanned

-- Step 0: Add unique constraint on gers_id for upsert support
-- The building_stats table originally had building_id as PK, but we need gers_id for map updates
CREATE UNIQUE INDEX IF NOT EXISTS idx_building_stats_gers_id_unique 
ON public.building_stats(gers_id) 
WHERE gers_id IS NOT NULL;

-- Step 1: Enable realtime on building_stats table (if not already enabled)
-- This allows the frontend to subscribe to changes via Supabase Realtime
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'building_stats'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.building_stats;
        RAISE NOTICE 'Added building_stats to supabase_realtime publication';
    ELSE
        RAISE NOTICE 'building_stats already in supabase_realtime publication';
    END IF;
END $$;

-- Step 2: Enable realtime on scan_events table (if not already enabled)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'scan_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_events;
        RAISE NOTICE 'Added scan_events to supabase_realtime publication';
    ELSE
        RAISE NOTICE 'scan_events already in supabase_realtime publication';
    END IF;
END $$;

-- Step 3: Update rpc_get_campaign_full_features to include qr_scanned property
-- This ensures initial data load marks buildings with scans as QR scanned
CREATE OR REPLACE FUNCTION public.rpc_get_campaign_full_features(
    p_campaign_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
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
            'id', COALESCE(slice.id, b.id),
            'geometry', ST_AsGeoJSON(COALESCE(slice.geom, b.geom))::jsonb,
            'properties', jsonb_build_object(
                'id', COALESCE(slice.id, b.id),
                'building_id', b.id,
                'address_id', ca.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'is_townhome', false,
                'units_count', 0,
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'feature_type', CASE
                    WHEN slice.id IS NOT NULL THEN 'unit_slice'
                    WHEN l.id IS NOT NULL THEN 'matched_house'
                    ELSE 'orphan'
                END,
                'status', COALESCE(
                    s.status,
                    CASE b.latest_status
                        WHEN 'interested' THEN 'visited'
                        WHEN 'default' THEN 'not_visited'
                        WHEN 'not_home' THEN 'not_visited'
                        WHEN 'dnc' THEN 'not_visited'
                        WHEN 'available' THEN 'not_visited'
                        ELSE 'not_visited'
                    END
                ),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                -- Add qr_scanned boolean for immediate color determination
                'qr_scanned', COALESCE(s.scans_total, 0) > 0,
                'last_scan_seconds_ago', CASE
                    WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                'unit_points', NULL,
                'divider_lines', NULL
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_slices slice ON slice.address_id = ca.id AND slice.building_id = b.id AND slice.campaign_id = b.campaign_id
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE b.campaign_id = p_campaign_id
    ) features;

    RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_campaign_full_features(uuid) IS
'Returns complete GeoJSON FeatureCollection for a campaign. Includes qr_scanned boolean (true when scans_total > 0) for map color determination. Enables "fetch once, render forever" for smooth pan/zoom.';

-- Step 4: Also update rpc_get_buildings_in_bbox to include qr_scanned
-- For exploration mode (no campaign)
CREATE OR REPLACE FUNCTION public.rpc_get_buildings_in_bbox(
    min_lon double precision,
    min_lat double precision,
    max_lon double precision,
    max_lat double precision
) RETURNS jsonb LANGUAGE plpgsql AS $$
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
            'id', b.id,
            'geometry', ST_AsGeoJSON(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'status', COALESCE(s.status, 'not_visited'),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'qr_scanned', COALESCE(s.scans_total, 0) > 0
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE ST_Intersects(
            b.geom,
            ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
        )
        LIMIT 2000
    ) features;

    RETURN result;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_buildings_in_bbox(double precision, double precision, double precision, double precision) IS
'Returns GeoJSON FeatureCollection of buildings in bounding box. Includes qr_scanned boolean for map color determination.';

-- Step 5: Create increment_building_scans RPC for atomic scan increments
-- Used as fallback when upsert fails due to conflict handling differences
CREATE OR REPLACE FUNCTION public.increment_building_scans(
    p_gers_id TEXT,
    p_campaign_id UUID DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- First try to update existing record
    UPDATE public.building_stats
    SET 
        scans_total = scans_total + 1,
        scans_today = CASE 
            WHEN date_trunc('day', last_scan_at) = date_trunc('day', now())
            THEN scans_today + 1
            ELSE 1
        END,
        last_scan_at = now(),
        status = 'visited',
        updated_at = now()
    WHERE gers_id = p_gers_id;
    
    -- If no row was updated, insert new record
    IF NOT FOUND THEN
        INSERT INTO public.building_stats (
            gers_id,
            campaign_id,
            scans_total,
            scans_today,
            last_scan_at,
            status,
            updated_at
        ) VALUES (
            p_gers_id,
            p_campaign_id,
            1,
            1,
            now(),
            'visited',
            now()
        )
        ON CONFLICT (gers_id) DO UPDATE SET
            scans_total = building_stats.scans_total + 1,
            scans_today = CASE 
                WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', now())
                THEN building_stats.scans_today + 1
                ELSE 1
            END,
            last_scan_at = now(),
            status = 'visited',
            updated_at = now();
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_building_scans(TEXT, UUID) TO authenticated, service_role, anon;

COMMENT ON FUNCTION public.increment_building_scans(TEXT, UUID) IS
'Atomically increments scan counts for a building by gers_id. Used by QR scan API to update building_stats for map color changes.';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
