-- ============================================================================
-- FIX: Add missing normalized columns to ref_addresses_gold
-- ============================================================================

-- Add street_number_normalized (extracts numeric part)
ALTER TABLE ref_addresses_gold 
ADD COLUMN IF NOT EXISTS street_number_normalized INTEGER 
GENERATED ALWAYS AS (
    CASE 
        WHEN street_number ~ '^[0-9]+$' THEN street_number::INTEGER
        WHEN street_number ~ '^[0-9]+' THEN (regexp_match(street_number, '^[0-9]+'))[1]::INTEGER
        ELSE NULL
    END
) STORED;

-- Add street_name_normalized (lowercase, no special chars)
ALTER TABLE ref_addresses_gold 
ADD COLUMN IF NOT EXISTS street_name_normalized TEXT 
GENERATED ALWAYS AS (
    lower(regexp_replace(street_name, '[^a-zA-Z0-9]', '', 'g'))
) STORED;

-- Add zip_normalized (uppercase, no spaces)
ALTER TABLE ref_addresses_gold 
ADD COLUMN IF NOT EXISTS zip_normalized TEXT 
GENERATED ALWAYS AS (
    upper(regexp_replace(zip, '[^A-Z0-9]', '', 'gi'))
) STORED;

-- Create indexes for normalized columns
CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_street_norm 
    ON ref_addresses_gold(street_name_normalized);

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_lookup_norm 
    ON ref_addresses_gold(street_number_normalized, street_name_normalized, city);

-- Also add trigram index for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_ref_addr_gold_street_trgm 
    ON ref_addresses_gold USING GIN(street_name_normalized gin_trgm_ops);

-- Verify the columns were added
SELECT 
    column_name, 
    data_type,
    is_nullable,
    generation_expression
FROM information_schema.columns 
WHERE table_name = 'ref_addresses_gold' 
AND column_name LIKE '%normalized%'
ORDER BY ordinal_position;
