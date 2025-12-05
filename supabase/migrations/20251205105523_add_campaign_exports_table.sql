-- Create campaign_exports table
CREATE TABLE IF NOT EXISTS campaign_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  flyer_id UUID REFERENCES flyers(id) ON DELETE SET NULL,
  trackable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_exports_campaign_id ON campaign_exports(campaign_id);

-- Enable RLS
ALTER TABLE campaign_exports ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access exports for their campaigns
CREATE POLICY "Users can view exports for their campaigns"
ON campaign_exports FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_exports.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
);

-- RLS Policy: Users can create exports for their campaigns
CREATE POLICY "Users can create exports for their campaigns"
ON campaign_exports FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM campaigns
    WHERE campaigns.id = campaign_exports.campaign_id
    AND campaigns.owner_id = auth.uid()
  )
);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_campaign_exports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_campaign_exports_updated_at
  BEFORE UPDATE ON campaign_exports
  FOR EACH ROW
  EXECUTE FUNCTION update_campaign_exports_updated_at();

