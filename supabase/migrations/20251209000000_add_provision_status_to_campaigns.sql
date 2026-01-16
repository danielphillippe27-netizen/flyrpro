-- Add provision_status column to campaigns table
-- This tracks the provisioning state: 'pending', 'ready', or 'failed'
-- Allows for idempotent provisioning and retry functionality

ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS provision_status text DEFAULT 'pending';

-- Add check constraint to ensure valid status values
ALTER TABLE public.campaigns
DROP CONSTRAINT IF EXISTS campaigns_provision_status_check;

ALTER TABLE public.campaigns
ADD CONSTRAINT campaigns_provision_status_check
CHECK (provision_status IN ('pending', 'ready', 'failed'));

-- Create index for faster lookups by status
CREATE INDEX IF NOT EXISTS idx_campaigns_provision_status
ON public.campaigns(provision_status)
WHERE provision_status IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.campaigns.provision_status IS 'Status of campaign provisioning: pending (in progress), ready (completed), or failed (error occurred)';
