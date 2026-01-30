-- Add INSERT and UPDATE RLS policies for map_buildings table
-- This allows authenticated users to insert/update map_buildings for their campaigns
-- Matches the RLS policy pattern used for the buildings table

-- Add INSERT policy: Users can insert map_buildings for their campaigns
DROP POLICY IF EXISTS "Users can insert map_buildings for their campaigns" ON public.map_buildings;
CREATE POLICY "Users can insert map_buildings for their campaigns"
ON public.map_buildings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = map_buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
  OR map_buildings.campaign_id IS NULL -- Allow inserts without campaign_id (for migration period)
);

-- Add UPDATE policy: Users can update map_buildings for their campaigns
DROP POLICY IF EXISTS "Users can update map_buildings for their campaigns" ON public.map_buildings;
CREATE POLICY "Users can update map_buildings for their campaigns"
ON public.map_buildings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = map_buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
  OR map_buildings.campaign_id IS NULL -- Allow updates without campaign_id (for migration period)
);

-- Update SELECT policy to match buildings table pattern (filter by campaign ownership)
DROP POLICY IF EXISTS "Authenticated users can view map_buildings" ON public.map_buildings;
CREATE POLICY "Users can view map_buildings for their campaigns"
ON public.map_buildings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = map_buildings.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
  OR map_buildings.campaign_id IS NULL -- Allow viewing buildings without campaign (for migration period)
);

COMMENT ON POLICY "Users can insert map_buildings for their campaigns" ON public.map_buildings 
IS 'Allows authenticated users to insert map_buildings for campaigns they own';
COMMENT ON POLICY "Users can update map_buildings for their campaigns" ON public.map_buildings 
IS 'Allows authenticated users to update map_buildings for campaigns they own';
COMMENT ON POLICY "Users can view map_buildings for their campaigns" ON public.map_buildings 
IS 'Allows authenticated users to view map_buildings for campaigns they own';
