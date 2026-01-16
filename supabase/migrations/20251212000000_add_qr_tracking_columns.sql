-- Add QR tracking columns to campaign_addresses and video_url to campaigns
-- This migration adds support for base64 QR code storage and tracking URLs

-- Add QR code base64 storage column
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS qr_code_base64 text;

-- Add tracking URL (purl) column
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS purl text;

-- Add video URL column to campaigns table
ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS video_url text;

-- Create index for faster lookups on purl
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_purl 
ON public.campaign_addresses(purl) 
WHERE purl IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.campaign_addresses.qr_code_base64 IS 'Base64-encoded QR code image (data URL format)';
COMMENT ON COLUMN public.campaign_addresses.purl IS 'Tracking URL for QR code scans (e.g., /api/scan?id={address_id})';
COMMENT ON COLUMN public.campaigns.video_url IS 'Optional video URL to redirect to when QR code is scanned';
