-- ============================================================================
-- Gold Tier Data Load - SQL Script
-- ============================================================================
-- 
-- Run this in the Supabase SQL Editor after downloading files from S3
-- 
-- Prerequisites:
--   1. Download GeoJSON from S3:
--      aws s3 cp s3://flyr-pro-addresses-2025/gold-standard/canada/ontario/durham/addresses.geojson ./
--      aws s3 cp s3://flyr-pro-addresses-2025/gold-standard/canada/ontario/durham/buildings.geojson ./
--
--   2. Convert to CSV (you'll need a script or use jq)
--
-- Or use the Storage API to load directly...
-- ============================================================================

-- ============================================================================
-- OPTION 1: Load via Supabase Storage + pg_read_file (if available)
-- ============================================================================

-- First, clear existing data
DELETE FROM ref_addresses_gold WHERE source_id = 'durham_addresses';
DELETE FROM ref_buildings_gold WHERE source_id = 'durham_buildings';

-- ============================================================================
-- OPTION 2: Use pg_temp and INSERT in chunks via JS/TS
-- ============================================================================

-- This is what the load_gold_direct.ts script does programmatically

-- ============================================================================
-- OPTION 3: Simple INSERT for smaller test batches
-- ============================================================================

-- Example for testing with 100 records:
/*
INSERT INTO ref_addresses_gold (
  source_id, source_file, source_url, source_date,
  street_number, street_name, unit, city, zip, province, country,
  geom, precision
) 
SELECT 
  'durham_addresses',
  'gold-standard/canada/ontario/durham/addresses.geojson',
  'https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/0',
  '2026-02-17',
  (elem->'properties'->>'CIVIC_NUM') || COALESCE(elem->'properties'->>'CIVIC_SFX', ''),
  elem->'properties'->>'ROAD_NAME' || ' ' || elem->'properties'->>'ROAD_TYPE',
  elem->'properties'->>'UNIT_NUM',
  elem->'properties'->>'MUNICIPALITY',
  elem->'properties'->>'POSTAL_CODE',
  'ON',
  'CA',
  ST_SetSRID(ST_MakePoint(
    (elem->'geometry'->'coordinates'->>0)::float,
    (elem->'geometry'->'coordinates'->>1)::float
  ), 4326),
  'rooftop'
FROM jsonb_array_elements(
  (SELECT content::jsonb FROM 
    (SELECT pg_read_file('/tmp/addresses.geojson')::text as content) t
  ) -> 'features'
) elem
LIMIT 100;
*/

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check what's loaded
SELECT 
  source_id,
  COUNT(*) as count,
  MIN(created_at) as first_load,
  MAX(created_at) as last_update
FROM ref_addresses_gold
GROUP BY source_id;

SELECT 
  source_id,
  COUNT(*) as count,
  MIN(created_at) as first_load,
  MAX(created_at) as last_update
FROM ref_buildings_gold
GROUP BY source_id;

-- Sample addresses
SELECT street_number, street_name, city, zip, ST_AsText(geom)
FROM ref_addresses_gold
WHERE source_id = 'durham_addresses'
LIMIT 5;

-- Sample buildings
SELECT external_id, area_sqm, ST_AsText(centroid)
FROM ref_buildings_gold
WHERE source_id = 'durham_buildings'
LIMIT 5;

-- Spatial extent
SELECT 
  source_id,
  ST_Extent(geom::box2d) as bbox
FROM ref_addresses_gold
WHERE source_id = 'durham_addresses'
GROUP BY source_id;
