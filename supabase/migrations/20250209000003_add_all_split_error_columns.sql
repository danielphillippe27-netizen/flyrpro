-- Add missing columns one at a time
ALTER TABLE building_split_errors 
ADD COLUMN IF NOT EXISTS building_geometry jsonb,
ADD COLUMN IF NOT EXISTS building_area FLOAT,
ADD COLUMN IF NOT EXISTS address_count INTEGER,
ADD COLUMN IF NOT EXISTS address_ids uuid[],
ADD COLUMN IF NOT EXISTS original_building_geojson jsonb,
ADD COLUMN IF NOT EXISTS address_positions jsonb,
ADD COLUMN IF NOT EXISTS suggested_action TEXT,
ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
ADD COLUMN IF NOT EXISTS resolution_method TEXT,
ADD COLUMN IF NOT EXISTS created_unit_ids UUID[];
