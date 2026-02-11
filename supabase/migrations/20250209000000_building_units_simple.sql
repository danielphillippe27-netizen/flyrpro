-- Simplified Building Units Schema

DROP TABLE IF EXISTS building_split_errors CASCADE;
DROP TABLE IF EXISTS building_units CASCADE;

CREATE TABLE building_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_building_id TEXT NOT NULL,
    address_id UUID REFERENCES campaign_addresses(id) ON DELETE SET NULL,
    unit_number TEXT NOT NULL,
    unit_geometry jsonb NOT NULL,
    parent_building_area FLOAT,
    split_method TEXT DEFAULT 'obb_linear',
    validation_status TEXT DEFAULT 'passed',
    parent_type TEXT DEFAULT 'townhouse',
    unit_status TEXT DEFAULT 'not_visited',
    visited_at TIMESTAMPTZ,
    visited_by UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_units_campaign ON building_units(campaign_id);
CREATE INDEX idx_units_building ON building_units(parent_building_id);

CREATE TABLE building_split_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    building_id TEXT NOT NULL,
    building_geometry jsonb,
    error_type TEXT NOT NULL,
    error_message TEXT,
    suggested_action TEXT,
    error_status TEXT DEFAULT 'pending',
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_split_errors_campaign ON building_split_errors(campaign_id);
