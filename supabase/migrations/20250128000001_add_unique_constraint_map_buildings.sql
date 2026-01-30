-- Add unique constraint on (source_id, campaign_id) for map_buildings
-- This allows ON CONFLICT to work in Supabase upserts
-- Note: source_id alone is not unique (can have multiple buildings with same source_id across campaigns)
-- But (source_id, campaign_id) should be unique per campaign

-- Drop existing constraint if it exists
ALTER TABLE public.map_buildings
DROP CONSTRAINT IF EXISTS map_buildings_source_campaign_unique;

-- Create unique constraint on (source_id, campaign_id)
-- This allows multiple NULLs (PostgreSQL behavior)
ALTER TABLE public.map_buildings
ADD CONSTRAINT map_buildings_source_campaign_unique 
UNIQUE (source_id, campaign_id);

-- Create index for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_map_buildings_source_campaign_unique 
ON public.map_buildings(source_id, campaign_id)
WHERE source_id IS NOT NULL AND campaign_id IS NOT NULL;

COMMENT ON CONSTRAINT map_buildings_source_campaign_unique ON public.map_buildings 
IS 'Unique constraint on (source_id, campaign_id) for Supabase onConflict support. Allows multiple NULLs.';
