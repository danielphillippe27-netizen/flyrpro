-- Add full unique constraint on (campaign_id, source_id) for Supabase onConflict support
-- This complements the partial unique index by providing a constraint that Supabase can recognize
-- Note: PostgreSQL allows multiple NULLs in unique constraints, so addresses without source_id can coexist

-- Drop the partial unique index if it exists (we'll recreate it after)
DROP INDEX IF EXISTS public.idx_campaign_addresses_campaign_source_id;

-- Create a full unique constraint (allows NULLs, multiple NULLs are allowed)
-- This constraint will be recognized by Supabase's onConflict
ALTER TABLE public.campaign_addresses
DROP CONSTRAINT IF EXISTS campaign_addresses_campaign_source_id_unique;

ALTER TABLE public.campaign_addresses
ADD CONSTRAINT campaign_addresses_campaign_source_id_unique 
UNIQUE (campaign_id, source_id);

-- Recreate the partial index for performance (for queries filtering by source_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_source_id 
ON public.campaign_addresses(campaign_id, source_id)
WHERE source_id IS NOT NULL;

COMMENT ON CONSTRAINT campaign_addresses_campaign_source_id_unique ON public.campaign_addresses 
IS 'Full unique constraint on (campaign_id, source_id) for Supabase onConflict support. Allows multiple NULLs.';
