-- Update on_scan_event trigger to also update buildings.latest_status
-- This ensures that when a scan_event is inserted, the buildings table
-- latest_status is updated to 'interested' (which shows as Gold/Green on the map)
-- The map listens to buildings.latest_status changes via Supabase Realtime

CREATE OR REPLACE FUNCTION public.on_scan_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Update building_stats (existing logic)
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
    
    -- NEW: Update buildings.latest_status to 'interested' when scanned
    -- This triggers Realtime updates that the map is listening to
    UPDATE public.buildings
    SET latest_status = 'interested',
        updated_at = now()
    WHERE id = NEW.building_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION public.on_scan_event() IS 'Updates building_stats and buildings.latest_status when a scan_event is inserted. Sets latest_status to ''interested'' which shows as Gold/Green on the map. The map listens to buildings.latest_status changes via Supabase Realtime.';
