-- =============================================================================
-- GOLD STANDARD: Add S3 Snapshot Columns to Campaigns
-- =============================================================================
-- 
-- This migration adds columns to store S3 snapshot URLs for the hybrid model:
-- - Buildings and Roads stay in S3 (flyr-snapshots bucket)
-- - Only Addresses are ingested into Supabase as "leads"
-- - 30-day TTL on S3 files keeps costs low

-- Add snapshot metadata columns to campaigns table
ALTER TABLE public.campaigns 
ADD COLUMN IF NOT EXISTS snapshot_bucket TEXT,
ADD COLUMN IF NOT EXISTS snapshot_prefix TEXT,
ADD COLUMN IF NOT EXISTS snapshot_buildings_url TEXT,
ADD COLUMN IF NOT EXISTS snapshot_roads_url TEXT,
ADD COLUMN IF NOT EXISTS snapshot_metadata_url TEXT,
ADD COLUMN IF NOT EXISTS overture_release TEXT,
ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP WITH TIME ZONE;

-- Add comment explaining the architecture
COMMENT ON COLUMN public.campaigns.snapshot_buildings_url IS 
  'Presigned S3 URL to gzipped GeoJSON buildings file. iOS app renders directly from S3.';

COMMENT ON COLUMN public.campaigns.snapshot_roads_url IS 
  'Presigned S3 URL to gzipped GeoJSON roads file. iOS app renders directly from S3.';

COMMENT ON COLUMN public.campaigns.snapshot_prefix IS 
  'S3 key prefix for this campaign (e.g., campaigns/{uuid}/)';

-- =============================================================================
-- Create Campaign Snapshots Table (Alternative: Store full metadata)
-- =============================================================================
-- This table stores detailed snapshot info for analytics and debugging

CREATE TABLE IF NOT EXISTS public.campaign_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    
    -- S3 Location
    bucket TEXT NOT NULL,
    prefix TEXT NOT NULL,
    
    -- S3 Keys
    buildings_key TEXT,
    addresses_key TEXT,
    roads_key TEXT,
    metadata_key TEXT,
    
    -- Presigned URLs (expire in 1 hour, refresh as needed)
    buildings_url TEXT,
    addresses_url TEXT,
    roads_url TEXT,
    metadata_url TEXT,
    
    -- Counts
    buildings_count INTEGER DEFAULT 0,
    addresses_count INTEGER DEFAULT 0,
    roads_count INTEGER DEFAULT 0,
    
    -- Metadata
    overture_release TEXT,
    tile_metrics JSONB,
    
    -- Routing (Valhalla Optimized Path)
    optimized_path_geometry JSONB,           -- GeoJSON LineString of the walking loop
    optimized_path_distance_km NUMERIC(10, 3),
    optimized_path_time_minutes INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '30 days'),
    
    -- Constraints
    CONSTRAINT unique_campaign_snapshot UNIQUE (campaign_id)
);

-- Enable RLS
ALTER TABLE public.campaign_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view snapshots for their campaigns"
    ON public.campaign_snapshots
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c
            JOIN public.profiles p ON c.owner_id = p.id
            WHERE c.id = campaign_snapshots.campaign_id
            AND (p.id = auth.uid() OR c.owner_id = auth.uid())
        )
    );

CREATE POLICY "Only admins can insert snapshots"
    ON public.campaign_snapshots
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Only admins can update snapshots"
    ON public.campaign_snapshots
    FOR UPDATE
    USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_campaign_id 
    ON public.campaign_snapshots(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_snapshots_expires_at 
    ON public.campaign_snapshots(expires_at);

-- =============================================================================
-- Function: Get fresh presigned URLs for a campaign
-- =============================================================================
-- Since presigned URLs expire, this function refreshes them on demand

CREATE OR REPLACE FUNCTION public.refresh_campaign_snapshot_urls(
    p_campaign_id UUID
)
RETURNS TABLE (
    buildings_url TEXT,
    addresses_url TEXT,
    roads_url TEXT,
    metadata_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Return the stored URLs (caller should check if expired and regenerate)
    RETURN QUERY
    SELECT 
        cs.buildings_url,
        cs.addresses_url,
        cs.roads_url,
        cs.metadata_url
    FROM public.campaign_snapshots cs
    WHERE cs.campaign_id = p_campaign_id
    AND cs.expires_at > NOW();
END;
$$;

COMMENT ON FUNCTION public.refresh_campaign_snapshot_urls IS 
  'Returns current presigned URLs for a campaign. If expired, frontend should call provision API to regenerate.';
