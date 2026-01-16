-- Add source_id column to campaign_addresses for Overture GERS ID tracking
-- This enables deduplication of addresses from Overture data sources

-- Add source_id column to store Overture gers_id
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS source_id text;

-- Create unique constraint on (campaign_id, source_id) for deduplication
-- Note: PostgreSQL allows multiple NULLs in unique constraints, so addresses without source_id can coexist
-- But if source_id is provided, it must be unique per campaign
-- We use a partial unique index to enforce uniqueness only when source_id is NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_addresses_campaign_source_id 
ON public.campaign_addresses(campaign_id, source_id)
WHERE source_id IS NOT NULL;

-- Note: For Supabase upsert, we'll use the column names directly: onConflict: 'campaign_id,source_id'
-- Supabase will use the unique index for conflict resolution

-- Create index for performance on source_id lookups
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_source_id 
ON public.campaign_addresses(source_id)
WHERE source_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.campaign_addresses.source_id IS 'Overture GERS ID or other source identifier for deduplication';
