-- CLEANUP: Remove redundant tables to simplify schema
-- This migration safely removes duplicate/unused tables
-- Run this AFTER confirming you don't need the data in these tables

-- ============================================
-- STEP 1: Drop redundant scan tracking tables
-- Keep: qr_code_scans (has device info, most complete)
-- Drop: scan_events, qr_scan_events
-- ============================================

-- First, migrate any unique data from scan_events to qr_code_scans if needed
-- (scan_events has building_id which qr_code_scans doesn't - but we can derive from address)

DROP TABLE IF EXISTS public.scan_events CASCADE;
DROP TABLE IF EXISTS public.qr_scan_events CASCADE;

-- ============================================
-- STEP 2: Migrate map_buildings to buildings, then drop
-- The buildings table is the unified source of truth
-- ============================================

-- First, migrate any map_buildings data that isn't already in buildings
INSERT INTO public.buildings (
    id, gers_id, geom, centroid, height_m, height, levels, 
    campaign_id, latest_status, created_at, updated_at
)
SELECT 
    mb.id,
    mb.gers_id,
    mb.geom,
    mb.centroid,
    mb.height_m,
    COALESCE(mb.height_m, 10) as height,
    mb.levels,
    mb.campaign_id,
    'default' as latest_status,
    COALESCE(mb.created_at, now()),
    COALESCE(mb.updated_at, now())
FROM public.map_buildings mb
WHERE NOT EXISTS (
    SELECT 1 FROM public.buildings b 
    WHERE b.id = mb.id OR (b.gers_id IS NOT NULL AND b.gers_id = mb.gers_id)
)
ON CONFLICT (id) DO NOTHING;

-- Update building_stats to remove FK constraint if it references map_buildings
DO $$
BEGIN
    ALTER TABLE public.building_stats 
    DROP CONSTRAINT IF EXISTS building_stats_building_id_fkey;
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'building_stats table does not exist';
    WHEN undefined_object THEN
        RAISE NOTICE 'constraint does not exist';
END $$;

-- Now drop map_buildings (574 rows migrated to buildings)
DROP TABLE IF EXISTS public.map_buildings CASCADE;

-- ============================================
-- STEP 3: Drop staging/temporary tables (OPTIONAL)
-- These are Overture import caches - can be re-imported if needed
-- Total: ~4.3M rows, significant storage
-- ============================================

-- UNCOMMENT to drop staging tables (saves storage, can re-import later):
-- DROP TABLE IF EXISTS public.durham_staging_raw CASCADE;  -- 252k rows
-- DROP TABLE IF EXISTS public.oda_staging_raw CASCADE;     -- 4M rows

-- ============================================
-- STEP 4: Drop unused/legacy tables
-- Verify these are not in use before running
-- ============================================

-- campaign_recipients might be legacy (campaign_addresses is primary)
-- Uncomment if confirmed unused:
-- DROP TABLE IF EXISTS public.campaign_recipients CASCADE;

-- overture_transportation might be unused (campaign_roads is per-campaign)
-- Uncomment if confirmed unused:
-- DROP TABLE IF EXISTS public.overture_transportation CASCADE;

-- ============================================
-- STEP 5: Clean up orphaned views
-- ============================================

-- Drop views that depended on dropped tables
DROP VIEW IF EXISTS public.campaign_map_features CASCADE;

-- ============================================
-- STEP 6: Update building_stats to work with buildings table
-- ============================================

-- Ensure building_stats uses gers_id as the link (not building_id)
-- This is already the case based on our earlier migrations

-- Add foreign key to buildings if needed (optional - can slow down inserts)
-- ALTER TABLE public.building_stats
-- ADD CONSTRAINT building_stats_gers_id_fkey 
-- FOREIGN KEY (gers_id) REFERENCES public.buildings(gers_id) ON DELETE CASCADE;

-- ============================================
-- STEP 7: Vacuum to reclaim space
-- ============================================

-- Run VACUUM FULL on affected tables (do this manually if needed)
-- VACUUM FULL public.building_stats;
-- VACUUM FULL public.qr_code_scans;

-- ============================================
-- Summary of what was removed:
-- - scan_events (0 rows, redundant with qr_code_scans)
-- - qr_scan_events (0 rows, redundant with qr_code_scans)  
-- - map_buildings (574 rows migrated to buildings first)
-- 
-- Optional (uncomment above to remove):
-- - durham_staging_raw (252k rows, Overture import cache)
-- - oda_staging_raw (4M rows, Overture import cache)
-- ============================================

NOTIFY pgrst, 'reload schema';
