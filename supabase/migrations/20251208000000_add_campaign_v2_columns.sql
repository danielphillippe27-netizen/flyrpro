-- Add Campaign V2 columns to campaigns table
-- This migration adds the missing columns needed for the new campaign creation flow

-- Add address_source column
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS address_source text CHECK (address_source IN ('closest_home', 'import_list', 'map', 'same_street'));

-- Add status column
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS status text CHECK (status IN ('draft', 'active', 'completed', 'paused')) DEFAULT 'draft';

-- Add seed_query column (for closest_home address source)
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS seed_query text;

-- Add total_flyers, scans, conversions columns (for analytics)
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS total_flyers integer DEFAULT 0;
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS scans integer DEFAULT 0;
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS conversions integer DEFAULT 0;

-- Add type column if it doesn't exist, then update constraint
DO $$
BEGIN
  -- Add type column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'type'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN type text DEFAULT 'flyer';
  END IF;
  
  -- Now that we know the column exists, update the constraint
  -- Drop the old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'campaigns' 
    AND constraint_name = 'campaigns_type_check'
  ) THEN
    ALTER TABLE campaigns
    DROP CONSTRAINT campaigns_type_check;
  END IF;
  
  -- Add new constraint with all campaign types
  ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_type_check 
  CHECK (type IN ('flyer', 'door_knock', 'event', 'survey', 'gift', 'pop_by', 'open_house', 'letters'));
  
  -- Set default type to 'flyer' if not already set
  ALTER TABLE campaigns
  ALTER COLUMN type SET DEFAULT 'flyer';
END $$;

-- Update existing rows to have default values
UPDATE campaigns
SET status = 'draft'
WHERE status IS NULL;

UPDATE campaigns
SET total_flyers = 0
WHERE total_flyers IS NULL;

UPDATE campaigns
SET scans = 0
WHERE scans IS NULL;

UPDATE campaigns
SET conversions = 0
WHERE conversions IS NULL;

-- Update type for existing rows if type column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'type'
  ) THEN
    UPDATE campaigns
    SET type = 'flyer'
    WHERE type IS NULL;
  END IF;
END $$;

-- Ensure owner_id is set for existing rows (if user_id exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'user_id'
  ) THEN
    UPDATE campaigns
    SET owner_id = user_id
    WHERE owner_id IS NULL AND user_id IS NOT NULL;
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN campaigns.address_source IS 'Source of addresses: map (drawn territory), closest_home, import_list, or same_street';
COMMENT ON COLUMN campaigns.status IS 'Campaign status: draft, active, completed, or paused';
COMMENT ON COLUMN campaigns.seed_query IS 'Location query for closest_home address source';
COMMENT ON COLUMN campaigns.total_flyers IS 'Total number of flyers/addresses in this campaign';
COMMENT ON COLUMN campaigns.scans IS 'Total number of QR code scans for this campaign';
COMMENT ON COLUMN campaigns.conversions IS 'Total number of conversions for this campaign';
