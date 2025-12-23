-- Enhance QR Codes and Add Scan Tracking
-- This migration adds destination_type and direct_url to qr_codes,
-- and creates the qr_code_scans table for analytics

-- 1) Extend qr_codes with destination_type + direct_url

ALTER TABLE public.qr_codes
ADD COLUMN IF NOT EXISTS destination_type text CHECK (destination_type IN ('landingPage', 'directLink'));

ALTER TABLE public.qr_codes
ADD COLUMN IF NOT EXISTS direct_url text;

-- Optional default: treat existing codes as landing pages if they have landing_page_id
UPDATE public.qr_codes
SET destination_type = 'landingPage'
WHERE destination_type IS NULL
  AND landing_page_id IS NOT NULL;

-- 2) Create qr_code_scans table if it doesn't exist

CREATE TABLE IF NOT EXISTS public.qr_code_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id uuid REFERENCES public.qr_codes(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  device_info text,
  user_agent text,
  ip_address inet,
  referrer text
);

-- 3) Indexes for analytics

CREATE INDEX IF NOT EXISTS idx_qr_code_scans_qr_code_id
  ON public.qr_code_scans(qr_code_id)
  WHERE qr_code_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qr_code_scans_qr_code_time
  ON public.qr_code_scans(qr_code_id, scanned_at DESC)
  WHERE qr_code_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qr_code_scans_address_id
  ON public.qr_code_scans(address_id)
  WHERE address_id IS NOT NULL;




