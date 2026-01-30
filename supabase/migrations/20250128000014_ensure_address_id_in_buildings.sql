-- Ensure address_id column exists in buildings table with proper foreign key constraint
-- This is the "Double-Linked" system: buildings.address_id → campaign_addresses.id
-- Part of the Spatial Handshake implementation

-- Add address_id column if it doesn't exist
ALTER TABLE public.buildings 
  ADD COLUMN IF NOT EXISTS address_id uuid;

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'buildings_address_id_fkey'
    AND table_schema = 'public'
    AND table_name = 'buildings'
  ) THEN
    ALTER TABLE public.buildings
      ADD CONSTRAINT buildings_address_id_fkey
      FOREIGN KEY (address_id) REFERENCES public.campaign_addresses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index if it doesn't exist (for performance)
CREATE INDEX IF NOT EXISTS idx_buildings_address_id 
  ON public.buildings(address_id) 
  WHERE address_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.buildings.address_id IS 
'Foreign key to campaign_addresses.id. Part of the "Spatial Handshake" - enables building-first queries (click house → show contact). Set during provisioning via spatial matching (25m ST_DWithin, distance + area ranking).';
