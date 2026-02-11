-- Gold Standard: Building Units and Townhouse Splitting Schema
-- Geometric splitting with manual review fallbacks

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS building_split_errors CASCADE;
DROP TABLE IF EXISTS building_units CASCADE;

-- Building Units Table: Split townhouse geometries
CREATE TABLE building_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_building_id TEXT NOT NULL,  -- Overture GERS ID
    
    -- Unit info
    address_id UUID REFERENCES campaign_addresses(id) ON DELETE SET NULL,
    unit_number TEXT NOT NULL,  -- "1", "A", "101", "Unit 2"
    
    -- Geometry (stored as GeoJSON in JSONB for flexibility)
    unit_geometry jsonb NOT NULL,  -- GeoJSON Polygon
    -- centroid is calculated in application code (PostgreSQL generated columns require immutable expressions)
    
    -- Metadata
    parent_building_area FLOAT,
    split_method TEXT DEFAULT 'obb_linear' CHECK (split_method IN (
        'obb_linear',      -- Oriented bounding box linear split
        'weighted',        -- Address-distance weighted split
        'manual',          -- User-created split
        'apartment_placeholder'  -- Circle for apartment units
    )),
    validation_status TEXT DEFAULT 'passed' CHECK (validation_status IN (
        'passed',
        'warning',         -- Address near edge but inside
        'failed',          -- Address outside unit
        'manual_override'
    )),
    
    -- Building classification
    parent_type TEXT DEFAULT 'townhouse' CHECK (parent_type IN (
        'townhouse',
        'apartment',
        'duplex',
        'triplex',
        'small_multifamily'
    )),
    
    -- Operational status
    status TEXT DEFAULT 'not_visited' CHECK (status IN (
        'not_visited',
        'visited',
        'not_home',
        'no_answer',
        'callback_requested',
        'not_interested',
        'converted'
    )),
    visited_at TIMESTAMPTZ,
    visited_by UUID REFERENCES auth.users(id),
    
    -- Notes
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    UNIQUE(campaign_id, address_id),
    CONSTRAINT valid_geojson CHECK (
        unit_geometry->>'type' = 'Polygon' AND
        jsonb_array_length(unit_geometry->'coordinates') >= 1
    )
);

-- Indexes for building_units
CREATE INDEX idx_units_campaign ON building_units(campaign_id);
CREATE INDEX idx_units_building ON building_units(parent_building_id);
CREATE INDEX idx_units_address ON building_units(address_id);
CREATE INDEX idx_units_status ON building_units(campaign_id, status);
CREATE INDEX idx_units_type ON building_units(campaign_id, parent_type);
CREATE INDEX idx_units_validation ON building_units(campaign_id, validation_status);

-- Trigger to update updated_at for building_units
CREATE OR REPLACE FUNCTION update_building_unit_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_building_unit_updated_at
    BEFORE UPDATE ON building_units
    FOR EACH ROW
    EXECUTE FUNCTION update_building_unit_updated_at();

-- Split Errors Table: Manual review queue
CREATE TABLE building_split_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    building_id TEXT NOT NULL,
    
    -- Building info at time of error
    building_geometry jsonb,  -- GeoJSON Polygon
    building_area FLOAT,
    address_count INTEGER,
    address_ids UUID[],
    
    -- Error details
    error_type TEXT NOT NULL CHECK (error_type IN (
        'validation_failed',      -- Unit didn't contain address
        'geometry_complex',       -- L-shape or irregular polygon
        'address_mismatch',       -- Couldn't order addresses along edge
        'split_failed',           -- Shapely/geometric error
        'self_intersection',      -- Invalid polygon topology
        'insert_failed'           -- Database insert error
    )),
    error_message TEXT,
    
    -- Context for manual fix
    original_building_geojson jsonb,  -- Full geometry for debugging
    address_positions jsonb,  -- [{address_id, lon, lat, house_number}, ...]
    
    -- Suggested action
    suggested_action TEXT CHECK (suggested_action IN (
        'manual_split',
        'merge_units',
        'flag_apartment',
        'create_placeholders',
        'skip_building'
    )),
    
    -- Resolution
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',
        'in_review',
        'resolved',
        'wont_fix'
    )),
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    resolution_method TEXT,  -- How it was fixed
    
    -- Created unit IDs after resolution
    created_unit_ids UUID[],
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for split_errors
CREATE INDEX idx_split_errors_campaign ON building_split_errors(campaign_id, status);
CREATE INDEX idx_split_errors_type ON building_split_errors(campaign_id, error_type);
CREATE INDEX idx_split_errors_building ON building_split_errors(building_id);

-- Trigger for split_errors updated_at
CREATE OR REPLACE FUNCTION update_split_error_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_split_error_updated_at
    BEFORE UPDATE ON building_split_errors
    FOR EACH ROW
    EXECUTE FUNCTION update_split_error_updated_at();

-- View for townhouse detection candidates
CREATE OR REPLACE VIEW townhouse_candidates AS
SELECT 
    l.campaign_id,
    l.building_id,
    COUNT(*) as unit_count,
    ARRAY_AGG(l.address_id) as address_ids,
    AVG(l.building_area_sqm) as building_area,
    -- Simple aspect ratio estimation using max/min coords
    (MAX(ST_XMax(a.geom::geometry)) - MIN(ST_XMin(a.geom::geometry))) / 
    NULLIF(MAX(ST_YMax(a.geom::geometry)) - MIN(ST_YMin(a.geom::geometry)), 0) as aspect_ratio
FROM building_address_links l
JOIN campaign_addresses a ON l.address_id = a.id
WHERE l.is_multi_unit = true
GROUP BY l.campaign_id, l.building_id
HAVING COUNT(*) BETWEEN 2 AND 6;

-- View for campaign unit summary
CREATE OR REPLACE VIEW campaign_unit_summary AS
SELECT 
    campaign_id,
    COUNT(*) as total_units,
    COUNT(*) FILTER (WHERE parent_type = 'townhouse') as townhouse_units,
    COUNT(*) FILTER (WHERE parent_type = 'apartment') as apartment_units,
    COUNT(*) FILTER (WHERE status = 'not_visited') as not_visited,
    COUNT(*) FILTER (WHERE status = 'visited') as visited,
    COUNT(*) FILTER (WHERE validation_status = 'passed') as valid_units,
    COUNT(*) FILTER (WHERE validation_status = 'failed') as invalid_units
FROM building_units
GROUP BY campaign_id;

-- View for split error summary
CREATE OR REPLACE VIEW split_error_summary AS
SELECT 
    campaign_id,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_errors,
    COUNT(*) FILTER (WHERE status = 'in_review') as in_review,
    COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
    COUNT(*) FILTER (WHERE error_type = 'validation_failed') as validation_errors,
    COUNT(*) FILTER (WHERE error_type = 'geometry_complex') as geometry_errors,
    COUNT(*) FILTER (WHERE error_type = 'split_failed') as split_errors
FROM building_split_errors
GROUP BY campaign_id;

-- Function to get units as GeoJSON FeatureCollection
CREATE OR REPLACE FUNCTION get_campaign_units_geojson(p_campaign_id UUID)
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', jsonb_agg(
            jsonb_build_object(
                'type', 'Feature',
                'id', u.id,
                'geometry', u.unit_geometry,
                'properties', jsonb_build_object(
                    'unit_id', u.id,
                    'parent_building_id', u.parent_building_id,
                    'unit_number', u.unit_number,
                    'status', u.status,
                    'parent_type', u.parent_type,
                    'validation_status', u.validation_status,
                    'address_id', u.address_id
                )
            )
        )
    )
    INTO result
    FROM building_units u
    WHERE u.campaign_id = p_campaign_id;
    
    RETURN COALESCE(result, jsonb_build_object(
        'type', 'FeatureCollection',
        'features', jsonb_build_array()
    ));
END;
$$ LANGUAGE plpgsql;

-- Function to validate unit coverage (ensure all addresses have units)
CREATE OR REPLACE FUNCTION validate_unit_coverage(p_campaign_id UUID)
RETURNS TABLE (
    orphan_address_id UUID,
    address_formatted TEXT,
    reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.formatted,
        'No unit assigned'::TEXT as reason
    FROM campaign_addresses a
    LEFT JOIN building_units u ON a.id = u.address_id
    WHERE a.campaign_id = p_campaign_id
      AND u.id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE building_units IS 'Individual unit geometries for townhouses and multi-unit buildings';
COMMENT ON TABLE building_split_errors IS 'Queue for buildings that failed automatic geometric splitting';
COMMENT ON VIEW townhouse_candidates IS 'Buildings identified as potential townhouses (2-6 units)';
