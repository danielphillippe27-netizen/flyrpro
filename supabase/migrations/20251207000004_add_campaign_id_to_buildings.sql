-- Mission-Based Campaign Provisioning: Add campaign_id to buildings and territory_boundary to campaigns
-- This migration enables campaign-exclusive building provisioning

-- Add campaign_id column to buildings table
ALTER TABLE public.buildings 
ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE;

-- Create index for campaign-based queries (critical for performance)
CREATE INDEX IF NOT EXISTS idx_buildings_campaign_id 
ON public.buildings(campaign_id);

-- Update RLS policy to filter by campaign ownership
DROP POLICY IF EXISTS "Authenticated users can view buildings" ON public.buildings;
CREATE POLICY "Users can view buildings for their campaigns"
ON public.buildings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
  OR buildings.campaign_id IS NULL -- Allow viewing buildings without campaign (for migration period)
);

-- Update insert policy to require campaign ownership
DROP POLICY IF EXISTS "Authenticated users can insert buildings" ON public.buildings;
CREATE POLICY "Users can insert buildings for their campaigns"
ON public.buildings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
);

-- Update update policy to require campaign ownership
DROP POLICY IF EXISTS "Authenticated users can update buildings" ON public.buildings;
CREATE POLICY "Users can update buildings for their campaigns"
ON public.buildings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
);

-- Add territory boundary to campaigns table
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS territory_boundary geometry(Polygon, 4326);

-- Create GIST index for spatial queries on campaign boundaries
CREATE INDEX IF NOT EXISTS idx_campaigns_boundary 
ON campaigns USING GIST (territory_boundary);

-- Add owner_id to campaigns if it doesn't exist (for RLS compatibility)
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS owner_id uuid;

-- If owner_id was just added and user_id exists, copy values
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'user_id'
  ) THEN
    UPDATE campaigns
    SET owner_id = user_id
    WHERE owner_id IS NULL;
  END IF;
END $$;

-- Make owner_id NOT NULL if we have data (after migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM campaigns WHERE owner_id IS NOT NULL
  ) THEN
    -- Only set NOT NULL if all rows have owner_id
    IF NOT EXISTS (SELECT 1 FROM campaigns WHERE owner_id IS NULL) THEN
      ALTER TABLE campaigns ALTER COLUMN owner_id SET NOT NULL;
    END IF;
  END IF;
END $$;

-- Update RLS policy to use owner_id (support both during transition)
DROP POLICY IF EXISTS "own campaigns" ON campaigns;
CREATE POLICY "own campaigns"
ON campaigns FOR ALL
USING (
  auth.uid() = owner_id 
  OR (
    owner_id IS NULL 
    AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'user_id'
    ) 
    AND auth.uid() = user_id
  )
);

-- Drop sync_history table if it exists (replaced by campaign-based provisioning)
DROP TABLE IF EXISTS public.sync_history CASCADE;

-- Drop is_area_synced function if it exists
DROP FUNCTION IF EXISTS public.is_area_synced CASCADE;

-- Add comments for documentation
COMMENT ON COLUMN public.buildings.campaign_id IS 'Campaign ID that owns this building - enables campaign-exclusive provisioning';
COMMENT ON COLUMN campaigns.territory_boundary IS 'Polygon boundary defining the campaign territory for building provisioning';


