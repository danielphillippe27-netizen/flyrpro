-- Fix building_stats: Ensure gers_id column exists for proper RPC joins
-- The RPC functions join building_stats on gers_id
-- This migration ensures gers_id is present and indexed

-- Step 1: Add gers_id column if it doesn't exist
-- (The table may already have gers_id as primary key, or it might need to be added)
DO $$
BEGIN
    -- Check if gers_id column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'building_stats' 
          AND column_name = 'gers_id'
    ) THEN
        -- Add gers_id column
        ALTER TABLE public.building_stats ADD COLUMN gers_id TEXT;
        RAISE NOTICE 'Added gers_id column to building_stats';
    ELSE
        RAISE NOTICE 'gers_id column already exists in building_stats';
    END IF;
END $$;

-- Step 2: Create index on gers_id for efficient joins (if not exists)
CREATE INDEX IF NOT EXISTS idx_building_stats_gers_id ON public.building_stats(gers_id);

-- Step 3: Backfill gers_id from buildings table (for existing records)
-- Handle both cases: building_id column exists OR gers_id is primary key
DO $$
BEGIN
    -- Check if building_id column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'building_stats' 
          AND column_name = 'building_id'
    ) THEN
        -- Backfill using building_id join
        UPDATE public.building_stats bs
        SET gers_id = b.gers_id
        FROM public.buildings b
        WHERE bs.building_id = b.id
          AND bs.gers_id IS NULL;
        RAISE NOTICE 'Backfilled gers_id using building_id join';
    ELSE
        RAISE NOTICE 'building_id column does not exist - gers_id is likely already primary key';
    END IF;
END $$;

-- Step 4: Update the on_scan_event trigger to populate gers_id
-- This trigger handles scan events and updates building_stats
CREATE OR REPLACE FUNCTION public.on_scan_event()
RETURNS TRIGGER AS $$
DECLARE
    v_gers_id TEXT;
    v_has_building_id BOOLEAN;
BEGIN
    -- Get the gers_id from the building
    SELECT b.gers_id INTO v_gers_id
    FROM public.buildings b
    WHERE b.id = NEW.building_id;

    -- Check if building_id column exists in building_stats
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'building_stats' 
          AND column_name = 'building_id'
    ) INTO v_has_building_id;

    IF v_has_building_id THEN
        -- Schema with building_id as primary key
        INSERT INTO public.building_stats (
            building_id, 
            gers_id,
            campaign_id, 
            scans_total, 
            scans_today, 
            last_scan_at, 
            status,
            updated_at
        )
        VALUES (
            NEW.building_id, 
            v_gers_id,
            NEW.campaign_id, 
            1, 
            1, 
            NEW.scanned_at, 
            'visited',
            now()
        )
        ON CONFLICT (building_id) DO UPDATE SET
            gers_id = EXCLUDED.gers_id,
            scans_total = building_stats.scans_total + 1,
            scans_today = CASE 
                WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', NEW.scanned_at)
                THEN building_stats.scans_today + 1
                ELSE 1
            END,
            last_scan_at = EXCLUDED.last_scan_at,
            status = 'visited',
            updated_at = now();
    ELSE
        -- Schema with gers_id as primary key
        INSERT INTO public.building_stats (
            gers_id,
            campaign_id, 
            scans_total, 
            scans_today, 
            last_scan_at, 
            status,
            updated_at
        )
        VALUES (
            v_gers_id,
            NEW.campaign_id, 
            1, 
            1, 
            NEW.scanned_at, 
            'visited',
            now()
        )
        ON CONFLICT (gers_id) DO UPDATE SET
            scans_total = building_stats.scans_total + 1,
            scans_today = CASE 
                WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', NEW.scanned_at)
                THEN building_stats.scans_today + 1
                ELSE 1
            END,
            last_scan_at = EXCLUDED.last_scan_at,
            status = 'visited',
            updated_at = now();
    END IF;
    
    -- Also update buildings.latest_status to 'interested' when scanned
    UPDATE public.buildings
    SET latest_status = 'interested'
    WHERE id = NEW.building_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Ensure trigger exists
DROP TRIGGER IF EXISTS trigger_on_scan_event ON public.scan_events;
CREATE TRIGGER trigger_on_scan_event
    AFTER INSERT ON public.scan_events
    FOR EACH ROW
    EXECUTE FUNCTION public.on_scan_event();

COMMENT ON FUNCTION public.on_scan_event() IS 
'Updates building_stats with gers_id and sets status to visited when a scan_event is inserted. Handles both building_id and gers_id primary key schemas. The gers_id enables proper joins in RPC functions and real-time updates via setFeatureState().';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
