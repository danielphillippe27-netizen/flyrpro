-- Add qr_png_url column to campaign_addresses
-- This allows storing QR code PNG image URLs directly on addresses
-- Matching the pattern used in campaign_recipients for backward compatibility

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS qr_png_url text;

-- Create index for faster lookups of addresses with QR codes
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_qr_png_url
ON public.campaign_addresses(campaign_id)
WHERE qr_png_url IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.campaign_addresses.qr_png_url IS 'URL to the QR code PNG image stored in Supabase Storage';
