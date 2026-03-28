-- Add address column to campaign_addresses if it doesn't exist
-- This column is used for the formatted address string

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS address TEXT;

-- Create index for address lookups
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_address 
  ON public.campaign_addresses(campaign_id, address) 
  WHERE address IS NOT NULL;

COMMENT ON COLUMN public.campaign_addresses.address IS 'Formatted address string (e.g., "123 Main St, Toronto, ON")';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
