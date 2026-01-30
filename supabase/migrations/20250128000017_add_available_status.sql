-- Add 'available' status to buildings.latest_status CHECK constraint
-- This enables buildings to be marked as 'available' (Red) during provisioning

ALTER TABLE public.buildings 
DROP CONSTRAINT IF EXISTS buildings_latest_status_check;

ALTER TABLE public.buildings 
ADD CONSTRAINT buildings_latest_status_check 
CHECK (latest_status IN ('default', 'not_home', 'interested', 'dnc', 'available'));

-- Add comment
COMMENT ON CONSTRAINT buildings_latest_status_check ON public.buildings IS 
'Status values: default (Grey), not_home (Orange), interested (Green), dnc (Red), available (Red - for newly provisioned buildings)';
