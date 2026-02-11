-- Add missing columns for Stable Linker to building_address_links
ALTER TABLE building_address_links 
ADD COLUMN IF NOT EXISTS match_type TEXT,
ADD COLUMN IF NOT EXISTS confidence FLOAT,
ADD COLUMN IF NOT EXISTS distance_meters FLOAT,
ADD COLUMN IF NOT EXISTS street_match_score FLOAT,
ADD COLUMN IF NOT EXISTS building_area_sqm FLOAT,
ADD COLUMN IF NOT EXISTS is_multi_unit BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS unit_count INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS unit_arrangement TEXT DEFAULT 'single';

-- Add missing columns to address_orphans
ALTER TABLE address_orphans
ADD COLUMN IF NOT EXISTS nearest_building_id TEXT,
ADD COLUMN IF NOT EXISTS nearest_distance FLOAT,
ADD COLUMN IF NOT EXISTS suggested_buildings JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_links_match_type ON building_address_links(campaign_id, match_type);
CREATE INDEX IF NOT EXISTS idx_links_confidence ON building_address_links(campaign_id, confidence);
CREATE INDEX IF NOT EXISTS idx_links_multi_unit ON building_address_links(campaign_id, is_multi_unit) WHERE is_multi_unit = true;
CREATE INDEX IF NOT EXISTS idx_orphans_status ON address_orphans(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_orphans_nearest ON address_orphans(campaign_id, nearest_building_id);

COMMENT ON COLUMN building_address_links.match_type IS 'Type of spatial match: containment, point_on_surface, proximity, fallback';
COMMENT ON COLUMN building_address_links.confidence IS 'Match confidence score 0.0-1.0';
COMMENT ON COLUMN building_address_links.is_multi_unit IS 'True if building has multiple linked addresses';
