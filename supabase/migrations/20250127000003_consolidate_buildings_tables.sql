-- Table Consolidation: Merge buildings and map_buildings into single source of truth
-- This eliminates duplicate geometry storage and simplifies the data model
-- 
-- IMPORTANT: Run this migration AFTER UUID migration (Phase 1) is complete
-- The buildings table should have gers_id as uuid type before consolidation

-- Step 1: Add columns from map_buildings to buildings table (if they don't exist)
-- These columns are specific to map visualization (fill-extrusion)

-- Add map-specific columns to buildings table
ALTER TABLE public.buildings 
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'overture',
  ADD COLUMN IF NOT EXISTS height_m numeric,
  ADD COLUMN IF NOT EXISTS levels int,
  ADD COLUMN IF NOT EXISTS is_townhome_row boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS divider_lines geometry(MultiLineString, 4326),
  ADD COLUMN IF NOT EXISTS unit_points geometry(MultiPoint, 4326);

-- Note: address_id and campaign_id may already exist in buildings table
-- If not, they will be added (but check existing schema first)

-- Step 2: Migrate data from map_buildings to buildings
-- Match by source_id (map_buildings) = gers_id (buildings)
-- Use COALESCE to preserve existing values in buildings table

UPDATE public.buildings b
SET 
  -- Map-specific fields (only update if NULL in buildings)
  height_m = COALESCE(b.height_m, mb.height_m),
  levels = COALESCE(b.levels, mb.levels),
  is_townhome_row = COALESCE(b.is_townhome_row, mb.is_townhome_row),
  units_count = COALESCE(b.units_count, mb.units_count),
  divider_lines = COALESCE(b.divider_lines, mb.divider_lines),
  unit_points = COALESCE(b.unit_points, mb.unit_points),
  address_id = COALESCE(b.address_id, mb.address_id),
  campaign_id = COALESCE(b.campaign_id, mb.campaign_id),
  -- Preserve height from buildings if exists, otherwise use height_m from map_buildings
  height = COALESCE(b.height, mb.height_m),
  updated_at = now()
FROM public.map_buildings mb
WHERE b.gers_id = mb.source_id
  OR (b.gers_id_uuid IS NOT NULL AND mb.source_id_uuid IS NOT NULL AND b.gers_id_uuid = mb.source_id_uuid);

-- Step 3: Insert buildings from map_buildings that don't exist in buildings table
INSERT INTO public.buildings (
  gers_id,
  gers_id_uuid,  -- Support shadow column during UUID migration
  geom,
  centroid,
  latest_status,
  is_hidden,
  source,
  height,
  height_m,
  levels,
  is_townhome_row,
  units_count,
  divider_lines,
  unit_points,
  address_id,
  campaign_id,
  created_at,
  updated_at
)
SELECT 
  mb.source_id as gers_id,
  mb.source_id_uuid as gers_id_uuid,
  mb.geom::geometry(MultiPolygon, 4326) as geom,  -- Convert Polygon to MultiPolygon
  mb.centroid,
  'default' as latest_status,
  false as is_hidden,
  COALESCE(mb.source, 'overture') as source,
  mb.height_m as height,
  mb.height_m,
  mb.levels,
  mb.is_townhome_row,
  mb.units_count,
  mb.divider_lines,
  mb.unit_points,
  mb.address_id,
  mb.campaign_id,
  mb.created_at,
  mb.updated_at
FROM public.map_buildings mb
WHERE NOT EXISTS (
  SELECT 1 FROM public.buildings b 
  WHERE b.gers_id = mb.source_id 
     OR (b.gers_id_uuid IS NOT NULL AND mb.source_id_uuid IS NOT NULL AND b.gers_id_uuid = mb.source_id_uuid)
);

-- Step 4: Update foreign key references in dependent tables
-- building_stats references map_buildings.id, need to update to buildings.id

-- First, check if building_stats exists and update references
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'building_stats') THEN
    -- Update building_stats to reference buildings instead of map_buildings
    -- Match by source_id (map_buildings) = gers_id (buildings)
    UPDATE public.building_stats bs
    SET building_id = b.id
    FROM public.map_buildings mb
    INNER JOIN public.buildings b ON b.gers_id = mb.source_id
      OR (b.gers_id_uuid IS NOT NULL AND mb.source_id_uuid IS NOT NULL AND b.gers_id_uuid = mb.source_id_uuid)
    WHERE bs.building_id = mb.id;
    
    -- Drop old foreign key and recreate pointing to buildings
    ALTER TABLE public.building_stats
      DROP CONSTRAINT IF EXISTS building_stats_building_id_fkey;
    
    ALTER TABLE public.building_stats
      ADD CONSTRAINT building_stats_building_id_fkey
      FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update scan_events similarly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_events') THEN
    UPDATE public.scan_events se
    SET building_id = b.id
    FROM public.map_buildings mb
    INNER JOIN public.buildings b ON b.gers_id = mb.source_id
      OR (b.gers_id_uuid IS NOT NULL AND mb.source_id_uuid IS NOT NULL AND b.gers_id_uuid = mb.source_id_uuid)
    WHERE se.building_id = mb.id;
    
    ALTER TABLE public.scan_events
      DROP CONSTRAINT IF EXISTS scan_events_building_id_fkey;
    
    ALTER TABLE public.scan_events
      ADD CONSTRAINT scan_events_building_id_fkey
      FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Step 5: Create indexes on new columns
CREATE INDEX IF NOT EXISTS idx_buildings_height_m ON public.buildings(height_m);
CREATE INDEX IF NOT EXISTS idx_buildings_levels ON public.buildings(levels);
CREATE INDEX IF NOT EXISTS idx_buildings_is_townhome ON public.buildings(is_townhome_row);
CREATE INDEX IF NOT EXISTS idx_buildings_address_id ON public.buildings(address_id) WHERE address_id IS NOT NULL;

-- Step 6: Add comments
COMMENT ON COLUMN public.buildings.height_m IS 'Building height in meters (for fill-extrusion visualization). Synced from map_buildings.';
COMMENT ON COLUMN public.buildings.levels IS 'Number of floors/levels. Calculated from height_m.';
COMMENT ON COLUMN public.buildings.is_townhome_row IS 'Whether this building is a townhome row (multiple units).';
COMMENT ON COLUMN public.buildings.units_count IS 'Estimated number of units in townhome row.';
COMMENT ON COLUMN public.buildings.divider_lines IS 'Generated divider lines for townhome units (MultiLineString).';
COMMENT ON COLUMN public.buildings.unit_points IS 'Generated unit points for townhome units (MultiPoint).';

-- Note: map_buildings table will be dropped in a separate migration after validation
-- This allows for rollback if needed
