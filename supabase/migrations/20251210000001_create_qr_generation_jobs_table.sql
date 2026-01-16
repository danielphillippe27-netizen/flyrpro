-- Create QR generation jobs table for tracking async QR code generation
-- This allows processing large batches without timing out

CREATE TABLE IF NOT EXISTS public.qr_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  total_addresses integer NOT NULL DEFAULT 0,
  processed_addresses integer NOT NULL DEFAULT 0,
  failed_addresses integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_qr_generation_jobs_campaign_id
ON public.qr_generation_jobs(campaign_id);

CREATE INDEX IF NOT EXISTS idx_qr_generation_jobs_user_id
ON public.qr_generation_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_qr_generation_jobs_status
ON public.qr_generation_jobs(status)
WHERE status IN ('pending', 'processing');

-- Add comment for documentation
COMMENT ON TABLE public.qr_generation_jobs IS 'Tracks QR code generation jobs for large campaigns to prevent timeouts';
COMMENT ON COLUMN public.qr_generation_jobs.status IS 'Job status: pending (queued), processing (in progress), completed (success), failed (error)';
COMMENT ON COLUMN public.qr_generation_jobs.processed_addresses IS 'Number of addresses successfully processed';
COMMENT ON COLUMN public.qr_generation_jobs.failed_addresses IS 'Number of addresses that failed to process';
