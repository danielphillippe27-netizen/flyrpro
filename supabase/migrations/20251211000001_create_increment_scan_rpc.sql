-- Create secure RPC function to increment scan count
-- Uses security definer to allow anonymous users to track scans without exposing RLS policies

CREATE OR REPLACE FUNCTION public.increment_scan(row_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.campaign_addresses 
  SET 
    scans = scans + 1,
    last_scanned_at = now()
  WHERE id = row_id;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION public.increment_scan(uuid) IS 'Increments the scan count and updates last_scanned_at timestamp for a campaign address. Uses security definer to allow anonymous access.';
