-- Fill-Extrusion Map Buildings Schema
-- This migration creates tables and functions for fill-extrusion based building visualization
-- Additive migration - coexists with existing buildings table and GLB 3D model system

-- 1. Enable PostGIS if not already active
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Buildings Table (The physical footprints for fill-extrusion)
CREATE TABLE IF NOT EXISTS public.map_buildings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL DEFAULT 'overture',
    source_id text, -- Overture GERS ID or other source identifier
    geom geometry(Polygon, 4326) NOT NULL,
    centroid geometry(Point, 4326) GENERATED ALWAYS AS (st_centroid(geom)) STORED,
    height_m numeric DEFAULT 6,
    levels int DEFAULT 2,
    -- Townhome logic
    is_townhome_row boolean DEFAULT false,
    units_count int DEFAULT 0,
    divider_lines geometry(MultiLineString, 4326), -- Generated via function later
    unit_points geometry(MultiPoint, 4326), -- Generated via function later
    -- Optional link to campaign_addresses for scan tracking
    address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Spatial indexes for performance
CREATE INDEX IF NOT EXISTS idx_map_buildings_geom ON public.map_buildings USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_map_buildings_centroid ON public.map_buildings USING GIST(centroid);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_map_buildings_source_id ON public.map_buildings(source_id);
CREATE INDEX IF NOT EXISTS idx_map_buildings_address_id ON public.map_buildings(address_id);
CREATE INDEX IF NOT EXISTS idx_map_buildings_campaign_id ON public.map_buildings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_map_buildings_is_townhome ON public.map_buildings(is_townhome_row);

-- 3. Building Stats (The dynamic scan data)
CREATE TABLE IF NOT EXISTS public.building_stats (
    building_id uuid PRIMARY KEY REFERENCES public.map_buildings(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
    status text DEFAULT 'not_visited' CHECK (status IN ('not_visited', 'visited', 'hot')),
    scans_total int DEFAULT 0,
    scans_today int DEFAULT 0,
    last_scan_at timestamptz,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_building_stats_campaign_id ON public.building_stats(campaign_id);
CREATE INDEX IF NOT EXISTS idx_building_stats_last_scan ON public.building_stats(last_scan_at);
CREATE INDEX IF NOT EXISTS idx_building_stats_status ON public.building_stats(status);

-- 4. Scan Events (The raw log)
CREATE TABLE IF NOT EXISTS public.scan_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id uuid REFERENCES public.map_buildings(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
    scanned_at timestamptz DEFAULT now() NOT NULL,
    qr_id text, -- Optional QR code identifier
    qr_code_id uuid REFERENCES public.qr_codes(id) ON DELETE SET NULL,
    address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_events_building_id ON public.scan_events(building_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_lookup ON public.scan_events(building_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_campaign_id ON public.scan_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_scanned_at ON public.scan_events(scanned_at DESC);

-- 5. Trigger Function: Update building_stats when scan_events is inserted
CREATE OR REPLACE FUNCTION public.on_scan_event()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.building_stats (
        building_id, 
        campaign_id, 
        scans_total, 
        scans_today, 
        last_scan_at, 
        status, 
        updated_at
    )
    VALUES (
        NEW.building_id, 
        NEW.campaign_id, 
        1, 
        1, 
        NEW.scanned_at, 
        'visited',
        now()
    )
    ON CONFLICT (building_id) DO UPDATE SET
        scans_total = building_stats.scans_total + 1,
        scans_today = CASE 
            WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', NEW.scanned_at)
            THEN building_stats.scans_today + 1
            ELSE 1
        END,
        last_scan_at = EXCLUDED.last_scan_at,
        status = 'visited', -- Simple logic, can be enhanced later
        updated_at = now();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_scan_update ON public.scan_events;
CREATE TRIGGER trigger_scan_update
    AFTER INSERT ON public.scan_events
    FOR EACH ROW
    EXECUTE FUNCTION public.on_scan_event();

-- 6. Trigger Function: Sync qr_code_scans to scan_events
-- This automatically creates scan_events when qr_code_scans are inserted
CREATE OR REPLACE FUNCTION public.on_qr_code_scan()
RETURNS TRIGGER AS $$
DECLARE
    v_building_id uuid;
    v_campaign_id uuid;
BEGIN
    -- Get campaign_id from qr_code or address
    SELECT 
        COALESCE(q.campaign_id, ca.campaign_id)
    INTO v_campaign_id
    FROM public.qr_codes q
    LEFT JOIN public.campaign_addresses ca ON ca.id = NEW.address_id
    WHERE q.id = NEW.qr_code_id
    LIMIT 1;
    
    -- Find associated map_building via address_id
    -- Try direct link first, then via campaign_addresses
    SELECT mb.id INTO v_building_id
    FROM public.map_buildings mb
    WHERE mb.address_id = NEW.address_id
    LIMIT 1;
    
    -- If no direct link, try to find via campaign_addresses.source_id matching map_buildings.source_id
    IF v_building_id IS NULL AND NEW.address_id IS NOT NULL THEN
        SELECT mb.id INTO v_building_id
        FROM public.map_buildings mb
        INNER JOIN public.campaign_addresses ca ON ca.id = NEW.address_id
        WHERE mb.source_id = ca.source_id
          AND mb.campaign_id = COALESCE(v_campaign_id, ca.campaign_id)
        LIMIT 1;
    END IF;
    
    -- Only create scan_event if we found a building
    IF v_building_id IS NOT NULL THEN
        INSERT INTO public.scan_events (
            building_id,
            campaign_id,
            scanned_at,
            qr_id,
            qr_code_id,
            address_id
        )
        VALUES (
            v_building_id,
            v_campaign_id,
            NEW.scanned_at,
            NULL, -- qr_id can be derived from qr_code_id if needed
            NEW.qr_code_id,
            NEW.address_id
        )
        ON CONFLICT DO NOTHING; -- Prevent duplicates
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on qr_code_scans
DROP TRIGGER IF EXISTS trigger_qr_scan_sync ON public.qr_code_scans;
CREATE TRIGGER trigger_qr_scan_sync
    AFTER INSERT ON public.qr_code_scans
    FOR EACH ROW
    EXECUTE FUNCTION public.on_qr_code_scan();

-- 7. RPC Function: Get buildings in bounding box
-- Drop old version first if it exists (without campaign_id parameter)
-- Must specify exact parameter types to drop the correct overload
DROP FUNCTION IF EXISTS public.rpc_get_buildings_in_bbox(float, float, float, float);

CREATE OR REPLACE FUNCTION public.rpc_get_buildings_in_bbox(
    min_lon float,
    min_lat float,
    max_lon float,
    max_lat float,
    p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    bbox geometry;
    result jsonb;
BEGIN
    -- Create Polygon from BBox
    bbox := st_makeenvelope(min_lon, min_lat, max_lon, max_lat, 4326);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', coalesce(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id,
            'geometry', st_asgeojson(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id,
                'height', b.height_m,
                'min_height', 0,
                'is_townhome', b.is_townhome_row,
                'units_count', b.units_count,
                'status', coalesce(s.status, 'not_visited'),
                'scans_today', coalesce(s.scans_today, 0),
                'scans_total', coalesce(s.scans_total, 0),
                'last_scan_seconds_ago', CASE 
                    WHEN s.last_scan_at IS NOT NULL 
                    THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                -- Embed secondary geometries if zoomed in (townhome lines/points)
                'unit_points', CASE 
                    WHEN b.units_count > 0 AND b.unit_points IS NOT NULL
                    THEN st_asgeojson(b.unit_points)::jsonb 
                    ELSE NULL 
                END,
                'divider_lines', CASE
                    WHEN b.is_townhome_row AND b.divider_lines IS NOT NULL
                    THEN st_asgeojson(b.divider_lines)::jsonb
                    ELSE NULL
                END
            )
        ) as feature
        FROM public.map_buildings b
        LEFT JOIN public.building_stats s ON b.id = s.building_id
        WHERE b.geom && bbox -- Spatial Index Intersect
          AND (p_campaign_id IS NULL OR b.campaign_id = p_campaign_id) -- Filter by campaign if provided
        LIMIT 1000 -- Safety cap
    ) features;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 8. Townhome Geometry Generation Function (Simplified MVP version)
-- Full OBB slicing can be moved to Edge Function later
CREATE OR REPLACE FUNCTION public.calculate_townhome_geometry(b_id uuid)
RETURNS void AS $$
DECLARE
    v_units int;
    v_geom geometry;
    v_centroid geometry;
    v_points geometry[];
    i int;
    step float;
    angle float;
BEGIN
    -- Get geometry and unit count
    SELECT geom, units_count, centroid INTO v_geom, v_units, v_centroid
    FROM public.map_buildings WHERE id = b_id;

    IF v_units < 2 OR v_geom IS NULL THEN 
        RETURN; 
    END IF;

    -- Simplified approach: Create points along the longest axis of the building
    -- For MVP, we'll create evenly spaced points along a line through the centroid
    -- In production, this would use proper OBB (Oriented Bounding Box) calculation
    
    -- Get the longest line through the polygon (simplified)
    -- This is a placeholder - full implementation would use OBB
    v_points := ARRAY[]::geometry[];
    
    -- Create unit points along the centroid (simplified for MVP)
    -- In production, calculate proper orientation and spacing
    FOR i IN 1..v_units LOOP
        step := (i::float / (v_units + 1)::float) - 0.5;
        -- Simple offset along a line (this is simplified - real version would use proper geometry)
        -- For now, just place points at centroid (will be enhanced later)
        v_points := array_append(v_points, v_centroid);
    END LOOP;
    
    -- Update building with unit points
    UPDATE public.map_buildings 
    SET unit_points = st_collect(v_points)
    WHERE id = b_id;

    -- Note: Divider lines would be calculated here in full implementation
    -- For MVP, we skip this complex geometry calculation
END;
$$ LANGUAGE plpgsql;

-- 9. RLS Policies (if needed for authenticated access)
-- Adjust based on your security requirements

-- Enable RLS on tables first
ALTER TABLE public.map_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view map_buildings
DROP POLICY IF EXISTS "Authenticated users can view map_buildings" ON public.map_buildings;
CREATE POLICY "Authenticated users can view map_buildings"
    ON public.map_buildings FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to view building_stats
DROP POLICY IF EXISTS "Authenticated users can view building_stats" ON public.building_stats;
CREATE POLICY "Authenticated users can view building_stats"
    ON public.building_stats FOR SELECT
    USING (auth.role() = 'authenticated');

-- Allow authenticated users to view scan_events
DROP POLICY IF EXISTS "Authenticated users can view scan_events" ON public.scan_events;
CREATE POLICY "Authenticated users can view scan_events"
    ON public.scan_events FOR SELECT
    USING (auth.role() = 'authenticated');

-- 10. Comments for documentation
COMMENT ON TABLE public.map_buildings IS 'Building footprints for fill-extrusion visualization. Coexists with existing buildings table.';
COMMENT ON TABLE public.building_stats IS 'Dynamic scan statistics for map_buildings. Auto-updated by triggers.';
COMMENT ON TABLE public.scan_events IS 'Raw scan event log. Links QR code scans to map_buildings.';
COMMENT ON FUNCTION public.rpc_get_buildings_in_bbox IS 'Returns GeoJSON FeatureCollection of buildings in bounding box for viewport-based fetching.';
COMMENT ON FUNCTION public.on_scan_event IS 'Trigger function that updates building_stats when scan_events are inserted.';
COMMENT ON FUNCTION public.on_qr_code_scan IS 'Trigger function that syncs qr_code_scans to scan_events for automatic building stats updates.';
