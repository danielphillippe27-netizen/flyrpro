-- Add missing columns to building_address_links for StableLinker

ALTER TABLE building_address_links 
ADD COLUMN IF NOT EXISTS match_type TEXT,
ADD COLUMN IF NOT EXISTS confidence FLOAT,
ADD COLUMN IF NOT EXISTS distance_meters FLOAT,
ADD COLUMN IF NOT EXISTS street_match_score FLOAT,
ADD COLUMN IF NOT EXISTS building_area_sqm FLOAT,
ADD COLUMN IF NOT EXISTS is_multi_unit BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS unit_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ DEFAULT now();

-- Add missing columns to address_orphans
ALTER TABLE address_orphans
ADD COLUMN IF NOT EXISTS nearest_building_id TEXT,
ADD COLUMN IF NOT EXISTS nearest_distance FLOAT,
ADD COLUMN IF NOT EXISTS nearest_building_street TEXT,
ADD COLUMN IF NOT EXISTS address_street TEXT,
ADD COLUMN IF NOT EXISTS street_match_score FLOAT,
ADD COLUMN IF NOT EXISTS suggested_buildings JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS assigned_building_id TEXT,
ADD COLUMN IF NOT EXISTS assigned_by UUID,
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
