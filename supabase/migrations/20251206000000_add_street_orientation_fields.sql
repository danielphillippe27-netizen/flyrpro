-- Add Street Orientation Fields to campaign_addresses
-- This migration adds fields for automatic street-facing orientation of house markers

-- Add orientation fields to campaign_addresses table
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS road_bearing float8;

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS house_bearing float8;

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS street_name text;

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS is_oriented boolean DEFAULT false;

ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS orientation_locked boolean DEFAULT false;

-- Create index for efficient querying of unoriented addresses
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_is_oriented
  ON public.campaign_addresses(campaign_id, is_oriented)
  WHERE is_oriented = false;

-- Create index for street name grouping
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_street_name
  ON public.campaign_addresses(campaign_id, street_name)
  WHERE street_name IS NOT NULL;


