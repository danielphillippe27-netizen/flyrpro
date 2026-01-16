-- Create campaign_recipients table if it doesn't exist
-- This table is used for CSV uploads of campaign recipients

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  address_line text,
  city text,
  region text,
  postal_code text,
  status text DEFAULT 'pending',   -- pending|sent|scanned
  sent_at timestamp,
  scanned_at timestamp,
  qr_png_url text,
  created_at timestamp DEFAULT now()
);

-- Enable RLS
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access recipients for their campaigns
DROP POLICY IF EXISTS "recipients by owner" ON campaign_recipients;
CREATE POLICY "recipients by owner"
ON campaign_recipients FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM campaigns 
    WHERE campaigns.id = campaign_recipients.campaign_id 
    AND campaigns.owner_id = auth.uid()
  )
  OR (
    -- Fallback for campaigns with user_id instead of owner_id
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = campaign_recipients.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  )
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id 
ON campaign_recipients(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status 
ON campaign_recipients(status);
