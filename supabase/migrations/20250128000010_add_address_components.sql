-- Add structured address component columns to campaign_addresses
-- This migration adds columns for house_number, locality, region, and building_gers_id
-- Note: street_name already exists from migration 20251206000000_add_street_orientation_fields.sql

-- Add house_number column (house/unit number)
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS house_number text;

-- Add locality column (town/city)
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS locality text;

-- Add region column (province/state)
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS region text;

-- Add building_gers_id column (parent building GERS ID from Overture for handshake optimization)
ALTER TABLE public.campaign_addresses
ADD COLUMN IF NOT EXISTS building_gers_id text;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_campaign_addresses_house_number
  ON public.campaign_addresses(campaign_id, house_number)
  WHERE house_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_locality
  ON public.campaign_addresses(campaign_id, locality)
  WHERE locality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_region
  ON public.campaign_addresses(campaign_id, region)
  WHERE region IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_addresses_building_gers_id
  ON public.campaign_addresses(building_gers_id)
  WHERE building_gers_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.campaign_addresses.house_number IS 'House/unit number from Overture address data';
COMMENT ON COLUMN public.campaign_addresses.locality IS 'Town/City from Overture address data';
COMMENT ON COLUMN public.campaign_addresses.region IS 'Province/State from Overture address data';
COMMENT ON COLUMN public.campaign_addresses.building_gers_id IS 'Parent building GERS ID from Overture (parent_id) for handshake optimization';
