-- ============================================================================
-- GOLD TIER DATA TABLES - Municipal Authoritative Data
-- ============================================================================
-- Stores high-quality municipal data from Esri ArcGIS servers
-- 
-- Pipeline:
--   ArcGIS Server → S3 (raw GeoJSON) → Supabase PostGIS (clean)
--
-- Sources:
--   - Durham Region Address Points (rooftop precision)
--   - Durham Region Building Footprints (verified outlines)
-- ============================================================================

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 1. REF_ADDRESSES_GOLD - Municipal Address Points
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_addresses_gold (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source tracking
    source_id TEXT NOT NULL,  -- e.g., 'durham_addresses', 'york_addresses'
    source_file TEXT,         -- S3 key reference
    source_url TEXT,          -- ArcGIS service URL
    source_date DATE,         -- Data publication date
    
    -- Address components
    street_number TEXT NOT NULL,
    street_number_normalized INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN street_number ~ '^[0-9]+$' THEN street_number::INTEGER
            WHEN street_number ~ '^[0-9]+' THEN (regexp_match(street_number, '^[0-9]+'))[1]::INTEGER
            ELSE NULL
        END
    ) STORED,
    street_name TEXT NOT NULL,
    street_name_normalized TEXT GENERATED ALWAYS AS (
        lower(regexp_replace(street_name, '[^a-zA-Z0-9]', '', 'g'))
    ) STORED,
    unit TEXT,                -- Apartment/suite number
    city TEXT NOT NULL,
    zip TEXT,                 -- Postal code
    zip_normalized TEXT GENERATED ALWAYS AS (
        upper(regexp_replace(zip, '[^A-Z0-9]', '', 'gi'))
    ) STORED,
    province TEXT DEFAULT 'ON',
    country TEXT DEFAULT 'CA',
    
    -- Geometry - precise rooftop/entrance point
    geom GEOMETRY(Point, 4326) NOT NULL,
    
    -- Metadata
    address_type TEXT,        -- 'residential', 'commercial', etc.
    precision TEXT DEFAULT 'rooftop',  -- 'rooftop', 'entrance', 'driveway'
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_geom 
    ON ref_addresses_gold USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_street 
    ON ref_addresses_gold(street_name);

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_zip 
    ON ref_addresses_gold(zip);

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_source 
    ON ref_addresses_gold(source_id);

-- Composite index for address matching
CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_lookup 
    ON ref_addresses_gold(street_number, street_name, city);

-- Normalized columns for consistent matching
CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_street_norm 
    ON ref_addresses_gold(street_name_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_lookup_norm 
    ON ref_addresses_gold(street_number_normalized, street_name_normalized, city);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ref_addr_gold_updated_at
    BEFORE UPDATE ON ref_addresses_gold
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE ref_addresses_gold IS 
'High-quality municipal address points from authoritative sources (ArcGIS). 
Updated monthly via GitHub Actions pipeline.';

-- ============================================================================
-- 2. REF_BUILDINGS_GOLD - Municipal Building Footprints
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_buildings_gold (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source tracking
    source_id TEXT NOT NULL,  -- e.g., 'durham_buildings', 'york_buildings'
    source_file TEXT,         -- S3 key reference
    source_url TEXT,          -- ArcGIS service URL
    source_date DATE,         -- Data publication date
    
    -- External IDs
    external_id TEXT,         -- Municipality's building ID (e.g., 'B12345')
    parcel_id TEXT,           -- Link to parcel/tax lot if available
    
    -- Geometry - verified building footprint
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    centroid GEOMETRY(Point, 4326),  -- Pre-calculated centroid
    
    -- Physical attributes
    area_sqm FLOAT,           -- Calculated from geometry
    height_m FLOAT,           -- Building height if available
    floors INTEGER,           -- Number of floors if available
    year_built INTEGER,       -- Construction year if available
    
    -- Building classification
    building_type TEXT,       -- 'residential', 'commercial', 'industrial', etc.
    subtype TEXT,             -- 'single_family', 'townhouse', 'apartment', etc.
    
    -- Address linkage (denormalized for performance)
    primary_address TEXT,
    primary_street_number TEXT,
    primary_street_name TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial indexes
CREATE INDEX IF NOT EXISTS idx_ref_bldg_gold_geom 
    ON ref_buildings_gold USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_ref_bldg_gold_centroid 
    ON ref_buildings_gold USING GIST(centroid);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_ref_bldg_gold_source 
    ON ref_buildings_gold(source_id);

CREATE INDEX IF NOT EXISTS idx_ref_bldg_gold_external_id 
    ON ref_buildings_gold(external_id) 
    WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ref_bldg_gold_type 
    ON ref_buildings_gold(building_type, subtype) 
    WHERE building_type IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER update_ref_bldg_gold_updated_at
    BEFORE UPDATE ON ref_buildings_gold
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE ref_buildings_gold IS 
'High-quality municipal building footprints from authoritative sources.
Filtered to exclude small outbuildings (< 35 sqm) and noise.
Updated monthly via GitHub Actions pipeline.';

-- ============================================================================
-- 3. SYNC LOG - Track data freshness
-- ============================================================================

CREATE TABLE IF NOT EXISTS gold_data_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,  -- 'address' | 'building'
    s3_bucket TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    
    -- Sync stats
    records_fetched INTEGER DEFAULT 0,
    records_filtered INTEGER DEFAULT 0,  -- Buildings < 35sqm, etc.
    records_inserted INTEGER DEFAULT 0,
    records_deleted INTEGER DEFAULT 0,
    
    -- Timing
    sync_started_at TIMESTAMPTZ DEFAULT NOW(),
    sync_completed_at TIMESTAMPTZ,
    sync_duration_ms INTEGER,
    
    -- Status
    sync_status TEXT DEFAULT 'running',  -- 'running' | 'success' | 'partial' | 'failed'
    error_message TEXT,
    
    -- Metadata
    arcgis_url TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_gold_sync_log_source 
    ON gold_data_sync_log(source_id, sync_completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_gold_sync_log_status 
    ON gold_data_sync_log(sync_status, sync_started_at DESC);

COMMENT ON TABLE gold_data_sync_log IS 
'Audit log for Gold tier data pipeline. Tracks fetch from ArcGIS and load to Supabase.';

-- ============================================================================
-- 4. STATS VIEW - Data coverage overview
-- ============================================================================

CREATE OR REPLACE VIEW v_gold_data_stats AS
SELECT 
    'addresses' as data_type,
    source_id,
    COUNT(*) as record_count,
    COUNT(DISTINCT city) as cities,
    COUNT(DISTINCT zip) as zip_codes,
    ST_Extent(geom::box2d) as bbox,
    MAX(source_date) as latest_source_date,
    MAX(updated_at) as last_sync_date
FROM ref_addresses_gold
GROUP BY source_id

UNION ALL

SELECT 
    'buildings' as data_type,
    source_id,
    COUNT(*) as record_count,
    NULL as cities,
    NULL as zip_codes,
    ST_Extent(geom::box2d) as bbox,
    MAX(source_date) as latest_source_date,
    MAX(updated_at) as last_sync_date
FROM ref_buildings_gold
GROUP BY source_id;

COMMENT ON VIEW v_gold_data_stats IS 
'Overview of Gold tier data coverage by source.';
