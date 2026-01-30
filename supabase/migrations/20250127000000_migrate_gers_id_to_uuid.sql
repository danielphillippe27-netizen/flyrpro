-- UUID Migration: Convert GERS IDs from text to uuid type
-- Zero-Downtime Migration Strategy using Shadow Columns
-- Phase 1: Add shadow columns and populate them
-- Phase 2: Double-write (application code)
-- Phase 3: Switch reads (application code)
-- Phase 4: Finalize (drop text columns) - separate migration

-- Step 1: Add shadow UUID columns alongside existing text columns
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS gers_id_uuid uuid;
ALTER TABLE public.map_buildings ADD COLUMN IF NOT EXISTS source_id_uuid uuid;
ALTER TABLE public.campaign_addresses ADD COLUMN IF NOT EXISTS source_id_uuid uuid;

-- Step 2: Create helper function to convert hex strings to UUID format
-- Overture GERS IDs are 128-bit hex strings that need to be formatted as UUIDs
CREATE OR REPLACE FUNCTION hex_to_uuid(hex_str text) RETURNS uuid AS $$
BEGIN
  -- Handle NULL input
  IF hex_str IS NULL OR trim(hex_str) = '' THEN
    RETURN NULL;
  END IF;
  
  -- If already in UUID format (with hyphens), cast directly
  IF hex_str ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN hex_str::uuid;
  -- If pure hex (32 chars), format as UUID (8-4-4-4-12)
  ELSIF length(hex_str) = 32 AND hex_str ~ '^[0-9a-fA-F]+$' THEN
    RETURN (
      lower(substring(hex_str from 1 for 8)) || '-' ||
      lower(substring(hex_str from 9 for 4)) || '-' ||
      lower(substring(hex_str from 13 for 4)) || '-' ||
      lower(substring(hex_str from 17 for 4)) || '-' ||
      lower(substring(hex_str from 21 for 12))
    )::uuid;
  -- If longer hex string (might be 36+ chars with dashes but wrong format), try to extract
  ELSIF length(hex_str) >= 32 THEN
    -- Try to extract first 32 hex characters
    DECLARE
      clean_hex text;
    BEGIN
      clean_hex := regexp_replace(hex_str, '[^0-9a-fA-F]', '', 'g');
      IF length(clean_hex) >= 32 THEN
        RETURN (
          lower(substring(clean_hex from 1 for 8)) || '-' ||
          lower(substring(clean_hex from 9 for 4)) || '-' ||
          lower(substring(clean_hex from 13 for 4)) || '-' ||
          lower(substring(clean_hex from 17 for 4)) || '-' ||
          lower(substring(clean_hex from 21 for 12))
        )::uuid;
      END IF;
    END;
  END IF;
  
  -- Invalid format
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but return NULL (validation script will catch these)
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Populate shadow columns
-- Note: This may take time for large tables. Run during low-traffic period.
UPDATE public.buildings 
SET gers_id_uuid = hex_to_uuid(gers_id)
WHERE gers_id IS NOT NULL AND gers_id_uuid IS NULL;

UPDATE public.map_buildings 
SET source_id_uuid = hex_to_uuid(source_id)
WHERE source_id IS NOT NULL AND source_id_uuid IS NULL;

UPDATE public.campaign_addresses 
SET source_id_uuid = hex_to_uuid(source_id)
WHERE source_id IS NOT NULL AND source_id_uuid IS NULL;

-- Step 4: Create indexes on shadow columns for performance
CREATE INDEX IF NOT EXISTS idx_buildings_gers_id_uuid ON public.buildings(gers_id_uuid) WHERE gers_id_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_map_buildings_source_id_uuid ON public.map_buildings(source_id_uuid) WHERE source_id_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_source_id_uuid ON public.campaign_addresses(source_id_uuid) WHERE source_id_uuid IS NOT NULL;

-- Step 5: Add unique constraints on shadow columns
CREATE UNIQUE INDEX IF NOT EXISTS idx_buildings_gers_id_uuid_unique 
ON public.buildings(gers_id_uuid) 
WHERE gers_id_uuid IS NOT NULL;

-- Note: map_buildings.source_id is not unique (can have multiple buildings with same source_id)
-- campaign_addresses has composite unique constraint (campaign_id, source_id) - will be handled in final migration

-- Step 6: Validation queries (run these to check conversion success)
-- Count failed conversions (should be 0 or very low)
DO $$
DECLARE
  buildings_failed int;
  map_buildings_failed int;
  addresses_failed int;
BEGIN
  SELECT COUNT(*) INTO buildings_failed
  FROM public.buildings 
  WHERE gers_id IS NOT NULL AND gers_id_uuid IS NULL;
  
  SELECT COUNT(*) INTO map_buildings_failed
  FROM public.map_buildings 
  WHERE source_id IS NOT NULL AND source_id_uuid IS NULL;
  
  SELECT COUNT(*) INTO addresses_failed
  FROM public.campaign_addresses 
  WHERE source_id IS NOT NULL AND source_id_uuid IS NULL;
  
  -- Log results (will appear in migration output)
  RAISE NOTICE 'UUID Conversion Results:';
  RAISE NOTICE '  Buildings: % failed conversions', buildings_failed;
  RAISE NOTICE '  Map Buildings: % failed conversions', map_buildings_failed;
  RAISE NOTICE '  Campaign Addresses: % failed conversions', addresses_failed;
  
  IF buildings_failed > 0 OR map_buildings_failed > 0 OR addresses_failed > 0 THEN
    RAISE WARNING 'Some GERS IDs could not be converted to UUID format. Review failed records before proceeding.';
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON FUNCTION hex_to_uuid(text) IS 'Converts Overture GERS ID hex strings to UUID format. Handles both hyphenated UUIDs and pure 32-character hex strings.';
COMMENT ON COLUMN public.buildings.gers_id_uuid IS 'Shadow column for UUID migration. Will replace gers_id after validation period.';
COMMENT ON COLUMN public.map_buildings.source_id_uuid IS 'Shadow column for UUID migration. Will replace source_id after validation period.';
COMMENT ON COLUMN public.campaign_addresses.source_id_uuid IS 'Shadow column for UUID migration. Will replace source_id after validation period.';
