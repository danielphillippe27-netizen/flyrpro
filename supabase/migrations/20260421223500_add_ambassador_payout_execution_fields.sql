ALTER TABLE public.ambassador_commissions
  ADD COLUMN IF NOT EXISTS paid_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_batch_id uuid REFERENCES public.ambassador_payout_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text;

ALTER TABLE public.ambassador_payout_batches
  ADD COLUMN IF NOT EXISTS ambassador_application_id uuid REFERENCES public.ambassador_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text,
  ADD COLUMN IF NOT EXISTS transfer_group text,
  ADD COLUMN IF NOT EXISTS commission_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_payout_batches_snapshot_unique_idx
  ON public.ambassador_payout_batches (ambassador_application_id, currency, commission_snapshot_hash)
  WHERE commission_snapshot_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS ambassador_commissions_payout_batch_idx
  ON public.ambassador_commissions (payout_batch_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_payout_batches_ambassador_status_idx
  ON public.ambassador_payout_batches (ambassador_application_id, status, created_at DESC);
