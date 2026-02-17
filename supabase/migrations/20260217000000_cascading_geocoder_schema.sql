-- ============================================================================
-- CASCADING GEOCODER PIPELINE - TIERED ADDRESS RESOLUTION SYSTEM
-- ============================================================================
-- This migration creates a two-tier geocoding system:
--   1. ref_addresses_gold: High-quality municipal data (small, fast)
--   2. ref_addresses_silver: Bulk interpolated data (160M+ rows, partitioned)
--
-- The resolution function prioritizes Gold data first, only falling back to
-- Silver when necessary. This provides speed + accuracy while keeping costs low.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 1. REF_ADDRESSES_GOLD - High-Quality Municipal Data
-- ============================================================================
-- Small table (typically 200k-500k rows per municipality)
-- Heavily indexed for instant lookups

CREATE TABLE IF NOT EXISTS ref_addresses_gold (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
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
    unit TEXT,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    postal_code TEXT,
    postal_code_normalized TEXT GENERATED ALWAYS AS (
        upper(regexp_replace(postal_code, '[^A-Z0-9]', '', 'gi'))
    ) STORED,
    country TEXT DEFAULT 'CA',
    
    -- Geometry (rooftop precision)
    geom GEOMETRY(Point, 4326) NOT NULL,
    
    -- Metadata
    source_file TEXT NOT NULL,           -- e.g., "durham_on.geojson"
    source_name TEXT NOT NULL,           -- e.g., "Durham Region Open Data"
    source_url TEXT,                     -- ArcGIS service URL
    source_date DATE,                    -- When data was published
    precision TEXT DEFAULT 'rooftop',    -- 'rooftop' | 'entrance' | 'driveway'
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint on address + source to prevent duplicates
    CONSTRAINT uk_ref_addresses_gold_address_source 
        UNIQUE (street_number_normalized, street_name_normalized, city, province, unit, source_name)
);

-- Create indexes for Gold table (optimized for exact match lookups)
CREATE INDEX IF NOT EXISTS idx_ref_gold_geom 
    ON ref_addresses_gold USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_ref_gold_street_name 
    ON ref_addresses_gold(street_name_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_gold_street_number 
    ON ref_addresses_gold(street_number_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_gold_city 
    ON ref_addresses_gold(city);

CREATE INDEX IF NOT EXISTS idx_ref_gold_province 
    ON ref_addresses_gold(province);

CREATE INDEX IF NOT EXISTS idx_ref_gold_postal 
    ON ref_addresses_gold(postal_code_normalized);

-- Composite index for common lookup pattern
CREATE INDEX IF NOT EXISTS idx_ref_gold_lookup 
    ON ref_addresses_gold(street_name_normalized, street_number_normalized, city, province);

-- Trigram index for fuzzy street matching (fallback)
CREATE INDEX IF NOT EXISTS idx_ref_gold_street_trgm 
    ON ref_addresses_gold USING GIN(street_name_normalized gin_trgm_ops);

-- Index on source for easy bulk operations
CREATE INDEX IF NOT EXISTS idx_ref_gold_source 
    ON ref_addresses_gold(source_name, source_file);

-- ============================================================================
-- 2. REF_ADDRESSES_SILVER - Bulk Interpolated Data (160M+ rows)
-- ============================================================================
-- Large table with partitioning for performance
-- Used only when Gold lookup fails

CREATE TABLE IF NOT EXISTS ref_addresses_silver (
    id UUID,
    
    -- Address components (same structure as Gold)
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
    unit TEXT,
    city TEXT NOT NULL,
    province TEXT NOT NULL,  -- Partition key
    postal_code TEXT,
    postal_code_normalized TEXT GENERATED ALWAYS AS (
        upper(regexp_replace(postal_code, '[^A-Z0-9]', '', 'gi'))
    ) STORED,
    country TEXT DEFAULT 'CA',
    
    -- Geometry (interpolated precision)
    geom GEOMETRY(Point, 4326) NOT NULL,
    
    -- Metadata
    source_dataset TEXT NOT NULL,        -- e.g., "openaddresses_ca"
    source_date DATE,
    precision TEXT DEFAULT 'interpolated', -- 'interpolated' | 'parcel_center'
    confidence NUMERIC(3,2),             -- 0.00 to 1.00
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Composite primary key includes partition key
    PRIMARY KEY (id, province)
) PARTITION BY LIST (province);

-- Create partitions for Canadian provinces (expand as needed)
CREATE TABLE IF NOT EXISTS ref_addresses_silver_on 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('ON');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_bc 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('BC');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_ab 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('AB');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_qc 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('QC');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_mb 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('MB');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_sk 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('SK');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_ns 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('NS');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_nb 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('NB');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_nl 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('NL');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_pe 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('PE');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_nt 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('NT');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_nu 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('NU');
CREATE TABLE IF NOT EXISTS ref_addresses_silver_yt 
    PARTITION OF ref_addresses_silver FOR VALUES IN ('YT');

-- Default partition for any other provinces/states
CREATE TABLE IF NOT EXISTS ref_addresses_silver_other 
    PARTITION OF ref_addresses_silver DEFAULT;

-- Create indexes for Silver table (optimized for large dataset)
-- BRIN index for geometry (efficient for large, naturally ordered data)
CREATE INDEX IF NOT EXISTS idx_ref_silver_geom_brin 
    ON ref_addresses_silver USING BRIN(geom);

-- B-tree indexes for exact lookups
CREATE INDEX IF NOT EXISTS idx_ref_silver_street_name 
    ON ref_addresses_silver(street_name_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_silver_street_number 
    ON ref_addresses_silver(street_number_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_silver_city 
    ON ref_addresses_silver(city);

CREATE INDEX IF NOT EXISTS idx_ref_silver_postal 
    ON ref_addresses_silver(postal_code_normalized);

-- Composite index for lookup pattern (partitioned, so province is implicit)
CREATE INDEX IF NOT EXISTS idx_ref_silver_lookup 
    ON ref_addresses_silver(street_name_normalized, street_number_normalized, city);

-- Trigram index for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_ref_silver_street_trgm 
    ON ref_addresses_silver USING GIN(street_name_normalized gin_trgm_ops);

-- ============================================================================
-- 3. ADDRESS RESOLUTION FUNCTION - The Core Geocoding Engine
-- ============================================================================
-- Two-pass resolution: Gold first, then Silver fallback
-- Returns JSON with geometry and provenance metadata

CREATE OR REPLACE FUNCTION resolve_address_point(
    p_search_num TEXT,
    p_search_street TEXT,
    p_search_city TEXT,
    p_search_province TEXT,
    p_search_postal TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_num_normalized INTEGER;
    v_street_normalized TEXT;
    v_postal_normalized TEXT;
    v_result JSONB;
    v_gold_record RECORD;
    v_silver_record RECORD;
BEGIN
    -- Normalize inputs
    v_num_normalized := CASE 
        WHEN p_search_num ~ '^[0-9]+$' THEN p_search_num::INTEGER
        WHEN p_search_num ~ '^[0-9]+' THEN (regexp_match(p_search_num, '^[0-9]+'))[1]::INTEGER
        ELSE NULL
    END;
    
    v_street_normalized := lower(regexp_replace(p_search_street, '[^a-zA-Z0-9]', '', 'g'));
    v_postal_normalized := upper(regexp_replace(COALESCE(p_search_postal, ''), '[^A-Z0-9]', '', 'gi'));
    
    -- =========================================================================
    -- PASS 1: GOLD - High-quality municipal data
    -- =========================================================================
    
    -- Try exact match first (normalized fields)
    SELECT 
        id,
        street_number,
        street_name,
        unit,
        city,
        province,
        postal_code,
        ST_X(geom) as lon,
        ST_Y(geom) as lat,
        source_name,
        precision,
        geom
    INTO v_gold_record
    FROM ref_addresses_gold
    WHERE street_number_normalized = v_num_normalized
      AND street_name_normalized = v_street_normalized
      AND city = p_search_city
      AND province = p_search_province
    ORDER BY 
        -- Prefer exact postal code match if provided
        CASE WHEN postal_code_normalized = v_postal_normalized THEN 0 ELSE 1 END,
        -- Prefer rooftop precision
        CASE WHEN precision = 'rooftop' THEN 0 ELSE 1 END,
        created_at DESC
    LIMIT 1;
    
    -- If no exact match, try trigram fuzzy match on street name
    IF v_gold_record IS NULL THEN
        SELECT 
            id,
            street_number,
            street_name,
            unit,
            city,
            province,
            postal_code,
            ST_X(geom) as lon,
            ST_Y(geom) as lat,
            source_name,
            precision,
            geom
        INTO v_gold_record
        FROM ref_addresses_gold
        WHERE street_number_normalized = v_num_normalized
          AND street_name_normalized % v_street_normalized  -- trigram similarity
          AND city = p_search_city
          AND province = p_search_province
        ORDER BY 
            similarity(street_name_normalized, v_street_normalized) DESC,
            CASE WHEN postal_code_normalized = v_postal_normalized THEN 0 ELSE 1 END
        LIMIT 1;
    END IF;
    
    -- Return Gold result if found
    IF v_gold_record IS NOT NULL THEN
        RETURN jsonb_build_object(
            'found', true,
            'source', 'gold',
            'precision', v_gold_record.precision,
            'confidence', 1.0,
            'address', jsonb_build_object(
                'street_number', v_gold_record.street_number,
                'street_name', v_gold_record.street_name,
                'unit', v_gold_record.unit,
                'city', v_gold_record.city,
                'province', v_gold_record.province,
                'postal_code', v_gold_record.postal_code
            ),
            'geometry', jsonb_build_object(
                'type', 'Point',
                'coordinates', jsonb_build_array(v_gold_record.lon, v_gold_record.lat)
            ),
            'metadata', jsonb_build_object(
                'source_name', v_gold_record.source_name,
                'matched_via', CASE 
                    WHEN v_gold_record.street_name_normalized = v_street_normalized THEN 'exact_match'
                    ELSE 'fuzzy_match'
                END
            )
        );
    END IF;
    
    -- =========================================================================
    -- PASS 2: SILVER - Bulk interpolated data (only if Gold failed)
    -- =========================================================================
    
    -- Try exact match first
    SELECT 
        id,
        street_number,
        street_name,
        unit,
        city,
        province,
        postal_code,
        ST_X(geom) as lon,
        ST_Y(geom) as lat,
        source_dataset,
        precision,
        confidence,
        geom
    INTO v_silver_record
    FROM ref_addresses_silver
    WHERE street_number_normalized = v_num_normalized
      AND street_name_normalized = v_street_normalized
      AND city = p_search_city
      AND province = p_search_province
    ORDER BY 
        confidence DESC NULLS LAST,
        CASE WHEN postal_code_normalized = v_postal_normalized THEN 0 ELSE 1 END
    LIMIT 1;
    
    -- If no exact match, try fuzzy match
    IF v_silver_record IS NULL THEN
        SELECT 
            id,
            street_number,
            street_name,
            unit,
            city,
            province,
            postal_code,
            ST_X(geom) as lon,
            ST_Y(geom) as lat,
            source_dataset,
            precision,
            confidence,
            geom
        INTO v_silver_record
        FROM ref_addresses_silver
        WHERE street_number_normalized = v_num_normalized
          AND street_name_normalized % v_street_normalized
          AND city = p_search_city
          AND province = p_search_province
        ORDER BY 
            similarity(street_name_normalized, v_street_normalized) DESC,
            confidence DESC NULLS LAST
        LIMIT 1;
    END IF;
    
    -- Return Silver result if found
    IF v_silver_record IS NOT NULL THEN
        RETURN jsonb_build_object(
            'found', true,
            'source', 'silver',
            'precision', v_silver_record.precision,
            'confidence', COALESCE(v_silver_record.confidence, 0.7),
            'address', jsonb_build_object(
                'street_number', v_silver_record.street_number,
                'street_name', v_silver_record.street_name,
                'unit', v_silver_record.unit,
                'city', v_silver_record.city,
                'province', v_silver_record.province,
                'postal_code', v_silver_record.postal_code
            ),
            'geometry', jsonb_build_object(
                'type', 'Point',
                'coordinates', jsonb_build_array(v_silver_record.lon, v_silver_record.lat)
            ),
            'metadata', jsonb_build_object(
                'source_dataset', v_silver_record.source_dataset,
                'matched_via', CASE 
                    WHEN v_silver_record.street_name_normalized = v_street_normalized THEN 'exact_match'
                    ELSE 'fuzzy_match'
                END
            )
        );
    END IF;
    
    -- =========================================================================
    -- NO MATCH FOUND
    -- =========================================================================
    RETURN jsonb_build_object(
        'found', false,
        'source', null,
        'precision', null,
        'confidence', 0,
        'address', jsonb_build_object(
            'street_number', p_search_num,
            'street_name', p_search_street,
            'city', p_search_city,
            'province', p_search_province,
            'postal_code', p_search_postal
        ),
        'geometry', null,
        'metadata', jsonb_build_object(
            'error', 'Address not found in Gold or Silver datasets'
        )
    );
END;
$$;

-- Add function comment
COMMENT ON FUNCTION resolve_address_point IS 
'Two-pass address geocoding function. Prioritizes ref_addresses_gold (municipal data),
then falls back to ref_addresses_silver (bulk interpolated data). Returns JSON with 
geometry and provenance metadata. Use pg_trgm extension for fuzzy matching.';

-- ============================================================================
-- 4. BULK RESOLUTION FUNCTION - For Campaign Address Processing
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_campaign_addresses(
    p_campaign_id UUID,
    p_dry_run BOOLEAN DEFAULT false
)
RETURNS TABLE (
    address_id UUID,
    input_address TEXT,
    result JSONB,
    resolved_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH resolved AS (
        SELECT 
            ca.id as addr_id,
            ca.address as input_addr,
            ca.house_number,
            ca.street_name,
            ca.locality as city,
            ca.region as province,
            ca.postal_code,
            resolve_address_point(
                ca.house_number,
                ca.street_name,
                ca.locality,
                ca.region,
                ca.postal_code
            ) as resolution
        FROM campaign_addresses ca
        WHERE ca.campaign_id = p_campaign_id
          AND ca.geom IS NULL  -- Only unresolved addresses
    )
    SELECT 
        resolved.addr_id,
        resolved.input_addr,
        resolved.resolution,
        NOW()
    FROM resolved;
    
    -- If not dry run, update the actual addresses
    IF NOT p_dry_run THEN
        UPDATE campaign_addresses ca
        SET 
            geom = ST_SetSRID(ST_MakePoint(
                (r.resolution->'geometry'->'coordinates'->>0)::float,
                (r.resolution->'geometry'->'coordinates'->>1)::float
            ), 4326),
            coordinate = jsonb_build_object(
                'lat', (r.resolution->'geometry'->'coordinates'->>1)::float,
                'lon', (r.resolution->'geometry'->'coordinates'->>0)::float
            )
        FROM (
            SELECT 
                ca.id as addr_id,
                resolve_address_point(
                    ca.house_number,
                    ca.street_name,
                    ca.locality,
                    ca.region,
                    ca.postal_code
                ) as resolution
            FROM campaign_addresses ca
            WHERE ca.campaign_id = p_campaign_id
              AND ca.geom IS NULL
        ) r
        WHERE ca.id = r.addr_id
          AND r.resolution->>'found' = 'true';
    END IF;
END;
$$;

COMMENT ON FUNCTION resolve_campaign_addresses IS 
'Bulk geocoding function for campaign addresses. Resolves all un-geocoded addresses
in a campaign using the two-pass Gold->Silver resolution. Set p_dry_run=true to
preview changes without updating the database.';

-- ============================================================================
-- 5. SYNC TRACKING TABLE - For monitoring data freshness
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref_addresses_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name TEXT NOT NULL,
    source_file TEXT NOT NULL,
    s3_bucket TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    records_processed INTEGER DEFAULT 0,
    records_inserted INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    sync_started_at TIMESTAMPTZ DEFAULT NOW(),
    sync_completed_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'running', -- 'running' | 'success' | 'partial' | 'failed'
    error_message TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_sync_log_source 
    ON ref_addresses_sync_log(source_name, sync_completed_at DESC);

-- ============================================================================
-- 6. TRIGGER FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_ref_gold_updated_at
    BEFORE UPDATE ON ref_addresses_gold
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. STATS VIEW - For monitoring table sizes and freshness
-- ============================================================================

CREATE OR REPLACE VIEW v_address_reference_stats AS
SELECT 
    'gold' as table_tier,
    source_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT city) as cities,
    COUNT(DISTINCT province) as provinces,
    MAX(source_date) as latest_data_date,
    MAX(created_at) as latest_sync_date
FROM ref_addresses_gold
GROUP BY source_name

UNION ALL

SELECT 
    'silver' as table_tier,
    source_dataset as source_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT city) as cities,
    COUNT(DISTINCT province) as provinces,
    MAX(source_date) as latest_data_date,
    MAX(created_at) as latest_sync_date
FROM ref_addresses_silver
GROUP BY source_dataset;

COMMENT ON VIEW v_address_reference_stats IS 
'Monitoring view for tracking data freshness and coverage across Gold and Silver tables.';
