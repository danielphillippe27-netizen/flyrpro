-- ============================================================================
-- CASCADING GEOCODER - SILVER TIER FROM S3 (On-Demand Regional Loading)
-- ============================================================================
-- This migration modifies the Silver tier to support on-demand loading from S3.
-- 
-- Architecture:
--   S3 (Data Lake): 160M addresses + Overture buildings (full dataset)
--   Supabase (Hot): Regional subsets loaded when users create campaigns
--   
-- When a user selects an area:
--   1. Load addresses from S3 into ref_addresses_silver for that bbox
--   2. Load buildings from S3 into overture_buildings for that bbox  
--   3. Resolution: Gold (municipal) → Silver (regional subset from S3)
-- ============================================================================

-- ============================================================================
-- 1. MODIFY SILVER TABLE - Add S3 tracking columns
-- ============================================================================

ALTER TABLE ref_addresses_silver 
ADD COLUMN IF NOT EXISTS s3_source_path TEXT,
ADD COLUMN IF NOT EXISTS loaded_for_campaign_id UUID,
ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bbox_bounds GEOMETRY(Polygon, 4326);

-- Index for campaign-specific queries
CREATE INDEX IF NOT EXISTS idx_ref_silver_campaign 
    ON ref_addresses_silver(loaded_for_campaign_id) 
    WHERE loaded_for_campaign_id IS NOT NULL;

-- Index for spatial queries within campaign bounds
CREATE INDEX IF NOT EXISTS idx_ref_silver_bbox 
    ON ref_addresses_silver USING GIST(bbox_bounds) 
    WHERE bbox_bounds IS NOT NULL;

-- ============================================================================
-- 2. OVERTURE BUILDINGS TABLE - Regional subset from S3
-- ============================================================================

CREATE TABLE IF NOT EXISTS overture_buildings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gers_id TEXT NOT NULL UNIQUE,  -- Overture GERS ID
    
    -- Geometry
    geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
    centroid GEOMETRY(Point, 4326),
    
    -- Building attributes
    height FLOAT,
    house_name TEXT,
    
    -- Address components from Overture
    addr_housenumber TEXT,
    addr_street TEXT,
    addr_unit TEXT,
    
    -- Source tracking
    s3_source_path TEXT,
    loaded_for_campaign_id UUID,
    loaded_at TIMESTAMPTZ,
    bbox_bounds GEOMETRY(Polygon, 4326),
    
    -- Overture metadata
    overture_categories TEXT[],
    confidence FLOAT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial indexes
CREATE INDEX IF NOT EXISTS idx_overture_buildings_geom 
    ON overture_buildings USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_overture_buildings_centroid 
    ON overture_buildings USING GIST(centroid);

CREATE INDEX IF NOT EXISTS idx_overture_buildings_gers 
    ON overture_buildings(gers_id);

CREATE INDEX IF NOT EXISTS idx_overture_buildings_campaign 
    ON overture_buildings(loaded_for_campaign_id) 
    WHERE loaded_for_campaign_id IS NOT NULL;

-- For address matching
CREATE INDEX IF NOT EXISTS idx_overture_buildings_address 
    ON overture_buildings(addr_street, addr_housenumber) 
    WHERE addr_street IS NOT NULL;

-- ============================================================================
-- 3. REGIONAL LOAD LOG - Track what's loaded from S3
-- ============================================================================

CREATE TABLE IF NOT EXISTS regional_data_load_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL,
    
    -- Load parameters
    data_type TEXT NOT NULL,  -- 'silver_addresses' | 'overture_buildings'
    s3_source_path TEXT NOT NULL,
    bbox GEOMETRY(Polygon, 4326) NOT NULL,
    
    -- Results
    records_loaded INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,  -- Duplicates, etc.
    load_duration_ms INTEGER,
    
    -- Status
    load_status TEXT DEFAULT 'running',  -- 'running' | 'success' | 'partial' | 'failed'
    error_message TEXT,
    
    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Metadata
    loaded_by_user_id UUID,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_regional_load_campaign 
    ON regional_data_load_log(campaign_id, data_type);

CREATE INDEX IF NOT EXISTS idx_regional_load_status 
    ON regional_data_load_log(load_status, started_at DESC);

-- ============================================================================
-- 4. CAMPAIGN DATA LOAD FUNCTION - Trigger S3 → Supabase load
-- ============================================================================

CREATE OR REPLACE FUNCTION load_regional_data_from_s3(
    p_campaign_id UUID,
    p_bbox WEST FLOAT,
    p_south FLOAT,
    p_east FLOAT,
    p_north FLOAT,
    p_load_addresses BOOLEAN DEFAULT true,
    p_load_buildings BOOLEAN DEFAULT true,
    p_s3_address_path TEXT DEFAULT 's3://flyr-pro-data/addresses/silver/ca_addresses.parquet',
    p_s3_building_path TEXT DEFAULT 's3://flyr-pro-data/buildings/overture/ca_buildings.parquet'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_bbox_geom GEOMETRY(Polygon, 4326);
    v_result JSONB;
    v_address_count INTEGER := 0;
    v_building_count INTEGER := 0;
BEGIN
    -- Create bbox polygon
    v_bbox_geom := ST_MakeEnvelope(p_bbox_west, p_bbox_south, p_bbox_east, p_bbox_north, 4326);
    
    -- Log start
    INSERT INTO regional_data_load_log (
        campaign_id, data_type, s3_source_path, bbox, load_status, loaded_by_user_id
    ) VALUES (
        p_campaign_id, 'silver_addresses', p_s3_address_path, v_bbox_geom, 'running', auth.uid()
    );
    
    INSERT INTO regional_data_load_log (
        campaign_id, data_type, s3_source_path, bbox, load_status, loaded_by_user_id
    ) VALUES (
        p_campaign_id, 'overture_buildings', p_s3_building_path, v_bbox_geom, 'running', auth.uid()
    );
    
    -- NOTE: Actual S3 loading is done via Node.js/DuckDB script
    -- This function just initializes the log entries and returns instructions
    -- The script will update the log when complete
    
    v_result := jsonb_build_object(
        'status', 'initiated',
        'campaign_id', p_campaign_id,
        'bbox', jsonb_build_object(
            'west', p_bbox_west,
            'south', p_bbox_south,
            'east', p_bbox_east,
            'north', p_bbox_north
        ),
        'instructions', 'Call Node.js script: npx tsx scripts/load-regional-data.ts --campaign=' || p_campaign_id::text,
        's3_paths', jsonb_build_object(
            'addresses', p_s3_address_path,
            'buildings', p_s3_building_path
        )
    );
    
    RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. UPDATED RESOLUTION FUNCTION - Gold → Silver (S3-loaded) → Not Found
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_address_point_v2(
    p_search_num TEXT,
    p_search_street TEXT,
    p_search_city TEXT,
    p_search_province TEXT,
    p_search_postal TEXT DEFAULT NULL,
    p_campaign_id UUID DEFAULT NULL  -- Optional: restrict to campaign-loaded data
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
    -- PASS 1: GOLD - High-quality municipal data (always first)
    -- =========================================================================
    
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
        CASE WHEN postal_code_normalized = v_postal_normalized THEN 0 ELSE 1 END,
        CASE WHEN precision = 'rooftop' THEN 0 ELSE 1 END,
        created_at DESC
    LIMIT 1;
    
    -- Fuzzy match fallback
    IF v_gold_record IS NULL THEN
        SELECT 
            id, street_number, street_name, unit, city, province, postal_code,
            ST_X(geom) as lon, ST_Y(geom) as lat,
            source_name, precision, geom
        INTO v_gold_record
        FROM ref_addresses_gold
        WHERE street_number_normalized = v_num_normalized
          AND street_name_normalized % v_street_normalized
          AND city = p_search_city
          AND province = p_search_province
        ORDER BY similarity(street_name_normalized, v_street_normalized) DESC
        LIMIT 1;
    END IF;
    
    -- Return Gold result
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
                END,
                'tier', 'gold'
            )
        );
    END IF;
    
    -- =========================================================================
    -- PASS 2: SILVER - Regional subset from S3 (campaign-specific or global)
    -- =========================================================================
    
    -- If campaign_id provided, only search campaign-loaded data
    -- Otherwise search all Silver data (for pre-loaded regions)
    
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
        loaded_for_campaign_id,
        s3_source_path,
        geom
    INTO v_silver_record
    FROM ref_addresses_silver
    WHERE street_number_normalized = v_num_normalized
      AND street_name_normalized = v_street_normalized
      AND city = p_search_city
      AND province = p_search_province
      AND (p_campaign_id IS NULL OR loaded_for_campaign_id = p_campaign_id)
    ORDER BY 
        confidence DESC NULLS LAST,
        CASE WHEN postal_code_normalized = v_postal_normalized THEN 0 ELSE 1 END
    LIMIT 1;
    
    -- Fuzzy match fallback
    IF v_silver_record IS NULL THEN
        SELECT 
            id, street_number, street_name, unit, city, province, postal_code,
            ST_X(geom) as lon, ST_Y(geom) as lat,
            source_dataset, precision, confidence,
            loaded_for_campaign_id, s3_source_path, geom
        INTO v_silver_record
        FROM ref_addresses_silver
        WHERE street_number_normalized = v_num_normalized
          AND street_name_normalized % v_street_normalized
          AND city = p_search_city
          AND province = p_search_province
          AND (p_campaign_id IS NULL OR loaded_for_campaign_id = p_campaign_id)
        ORDER BY similarity(street_name_normalized, v_street_normalized) DESC
        LIMIT 1;
    END IF;
    
    -- Return Silver result
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
                's3_source', v_silver_record.s3_source_path,
                'campaign_loaded', v_silver_record.loaded_for_campaign_id IS NOT NULL,
                'matched_via', CASE 
                    WHEN v_silver_record.street_name_normalized = v_street_normalized THEN 'exact_match'
                    ELSE 'fuzzy_match'
                END,
                'tier', 'silver'
            )
        );
    END IF;
    
    -- =========================================================================
    -- NO MATCH FOUND - Return not found with metadata
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
            'error', 'Address not found in Gold or Silver datasets',
            'suggestion', CASE 
                WHEN p_campaign_id IS NOT NULL THEN 'Data may not be loaded for this campaign area yet'
                ELSE 'No regional data loaded for this area'
            END
        )
    );
END;
$$;

COMMENT ON FUNCTION resolve_address_point_v2 IS 
'Two-pass address geocoding with campaign-specific Silver data support.
Pass 1: Gold (municipal) - always checked first
Pass 2: Silver (S3-loaded regional data) - campaign-specific or global

Use p_campaign_id to restrict search to data loaded for a specific campaign.';

-- ============================================================================
-- 6. CLEANUP FUNCTION - Remove campaign data when campaign deleted
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_campaign_regional_data(p_campaign_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_addresses_deleted INTEGER;
    v_buildings_deleted INTEGER;
BEGIN
    -- Delete Silver addresses loaded for this campaign
    DELETE FROM ref_addresses_silver 
    WHERE loaded_for_campaign_id = p_campaign_id;
    GET DIAGNOSTICS v_addresses_deleted = ROW_COUNT;
    
    -- Delete buildings loaded for this campaign
    DELETE FROM overture_buildings 
    WHERE loaded_for_campaign_id = p_campaign_id;
    GET DIAGNOSTICS v_buildings_deleted = ROW_COUNT;
    
    -- Update load log
    UPDATE regional_data_load_log 
    SET load_status = 'cleaned_up', completed_at = NOW()
    WHERE campaign_id = p_campaign_id;
    
    RETURN jsonb_build_object(
        'campaign_id', p_campaign_id,
        'addresses_deleted', v_addresses_deleted,
        'buildings_deleted', v_buildings_deleted,
        'status', 'cleaned_up'
    );
END;
$$;

-- ============================================================================
-- 7. VIEW: Campaign data coverage status
-- ============================================================================

CREATE OR REPLACE VIEW v_campaign_data_coverage AS
SELECT 
    c.id as campaign_id,
    c.name as campaign_name,
    c.bbox,
    -- Gold data availability
    (SELECT COUNT(*) FROM ref_addresses_gold g 
     WHERE c.bbox IS NOT NULL AND ST_Within(g.geom, ST_MakeEnvelope(
         (c.bbox->>0)::float, (c.bbox->>1)::float, 
         (c.bbox->>2)::float, (c.bbox->>3)::float, 4326
     ))) as gold_address_count,
    -- Silver data loaded for this campaign
    (SELECT COUNT(*) FROM ref_addresses_silver s 
     WHERE s.loaded_for_campaign_id = c.id) as silver_address_count,
    -- Buildings loaded for this campaign
    (SELECT COUNT(*) FROM overture_buildings b 
     WHERE b.loaded_for_campaign_id = c.id) as building_count,
    -- Load status
    (SELECT load_status FROM regional_data_load_log 
     WHERE campaign_id = c.id AND data_type = 'silver_addresses'
     ORDER BY started_at DESC LIMIT 1) as address_load_status,
    (SELECT load_status FROM regional_data_load_log 
     WHERE campaign_id = c.id AND data_type = 'overture_buildings'
     ORDER BY started_at DESC LIMIT 1) as building_load_status
FROM campaigns c;

COMMENT ON VIEW v_campaign_data_coverage IS 
'Shows data coverage for each campaign - Gold addresses in bbox, Silver addresses loaded, buildings loaded.';
