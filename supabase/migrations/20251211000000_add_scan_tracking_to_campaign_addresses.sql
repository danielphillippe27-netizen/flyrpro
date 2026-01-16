-- Add scan tracking columns to campaign_addresses
-- This allows tracking how many times each address's QR code has been scanned

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS scans integer DEFAULT 0;

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz;

-- Create index for faster analytics queries on scan data
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_scans
ON public.campaign_addresses(campaign_id, scans DESC)
WHERE scans > 0;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_last_scanned_at
ON public.campaign_addresses(campaign_id, last_scanned_at DESC)
WHERE last_scanned_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.campaign_addresses.scans IS 'Total number of times this address QR code has been scanned';
COMMENT ON COLUMN public.campaign_addresses.last_scanned_at IS 'Timestamp of the most recent QR code scan';
