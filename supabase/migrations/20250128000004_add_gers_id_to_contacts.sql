-- Add GERS ID and Address ID linking to contacts table
-- This enables linking contacts to map_buildings via source_id (GERS ID)
-- and to campaign_addresses via address_id for direct address relationships

-- Add gers_id column to store Overture GERS ID
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS gers_id uuid;

-- Add address_id column with foreign key to campaign_addresses
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES public.campaign_addresses(id) ON DELETE SET NULL;

-- Create indexes for performance on lookups
CREATE INDEX IF NOT EXISTS idx_contacts_gers_id 
  ON public.contacts(gers_id) 
  WHERE gers_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_address_id 
  ON public.contacts(address_id) 
  WHERE address_id IS NOT NULL;

-- Composite index for common query pattern: find contacts by campaign and GERS ID
CREATE INDEX IF NOT EXISTS idx_contacts_campaign_gers_id 
  ON public.contacts(campaign_id, gers_id) 
  WHERE campaign_id IS NOT NULL AND gers_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.contacts.gers_id IS 'Overture GERS ID linking contact to map_buildings.source_id. Allows querying residents by building GERS ID.';
COMMENT ON COLUMN public.contacts.address_id IS 'Direct foreign key to campaign_addresses.id. Enables linking contacts to specific campaign addresses.';
