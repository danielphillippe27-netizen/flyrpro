ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS commission_duration_months integer NOT NULL DEFAULT 12;

ALTER TABLE public.salespeople
  DROP CONSTRAINT IF EXISTS salespeople_commission_duration_months_check;
ALTER TABLE public.salespeople
  ADD CONSTRAINT salespeople_commission_duration_months_check
  CHECK (commission_duration_months >= 1 AND commission_duration_months <= 36);

CREATE TABLE IF NOT EXISTS public.salesperson_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  salesperson_id uuid NOT NULL REFERENCES public.salespeople(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  commission_rate_bps integer NOT NULL DEFAULT 2500,
  commission_duration_months integer NOT NULL DEFAULT 12,
  first_paid_at timestamptz,
  eligible_until timestamptz,
  last_paid_at timestamptz,
  status text NOT NULL DEFAULT 'attributed'
    CHECK (status IN ('attributed', 'active', 'expired', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_referrals_workspace_unique_idx
  ON public.salesperson_referrals (referred_workspace_id);

CREATE INDEX IF NOT EXISTS salesperson_referrals_salesperson_idx
  ON public.salesperson_referrals (salesperson_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_referrals_subscription_idx
  ON public.salesperson_referrals (stripe_subscription_id);

ALTER TABLE public.salesperson_referrals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.salesperson_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  salesperson_referral_id uuid NOT NULL REFERENCES public.salesperson_referrals(id) ON DELETE CASCADE,
  salesperson_id uuid NOT NULL REFERENCES public.salespeople(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text NOT NULL,
  stripe_invoice_id text NOT NULL,
  revenue_amount_cents integer NOT NULL CHECK (revenue_amount_cents >= 0),
  commission_rate_bps integer NOT NULL CHECK (commission_rate_bps >= 0 AND commission_rate_bps <= 10000),
  commission_amount_cents integer NOT NULL CHECK (commission_amount_cents >= 0),
  currency text NOT NULL,
  earned_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'voided')),
  paid_out_at timestamptz,
  payout_batch_id uuid,
  stripe_transfer_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_commissions_invoice_unique_idx
  ON public.salesperson_commissions (stripe_invoice_id);

CREATE INDEX IF NOT EXISTS salesperson_commissions_salesperson_status_idx
  ON public.salesperson_commissions (salesperson_id, status, earned_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_commissions_referral_idx
  ON public.salesperson_commissions (salesperson_referral_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_commissions_payout_batch_idx
  ON public.salesperson_commissions (payout_batch_id, earned_at DESC);

ALTER TABLE public.salesperson_commissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.salesperson_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'paid', 'failed')),
  currency text NOT NULL,
  total_commission_cents integer NOT NULL DEFAULT 0 CHECK (total_commission_cents >= 0),
  note text,
  paid_at timestamptz,
  processed_at timestamptz,
  stripe_connect_account_id text,
  stripe_transfer_id text,
  transfer_group text,
  commission_snapshot_hash text,
  failure_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_payout_batches_snapshot_unique_idx
  ON public.salesperson_payout_batches (salesperson_id, currency, commission_snapshot_hash)
  WHERE commission_snapshot_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS salesperson_payout_batches_status_idx
  ON public.salesperson_payout_batches (status, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_payout_batches_salesperson_status_idx
  ON public.salesperson_payout_batches (salesperson_id, status, created_at DESC);

ALTER TABLE public.salesperson_payout_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.salesperson_payout_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  payout_batch_id uuid NOT NULL REFERENCES public.salesperson_payout_batches(id) ON DELETE CASCADE,
  salesperson_commission_id uuid NOT NULL REFERENCES public.salesperson_commissions(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS salesperson_payout_batch_items_commission_unique_idx
  ON public.salesperson_payout_batch_items (salesperson_commission_id);

CREATE INDEX IF NOT EXISTS salesperson_payout_batch_items_batch_idx
  ON public.salesperson_payout_batch_items (payout_batch_id);

ALTER TABLE public.salesperson_payout_batch_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'salesperson_commissions_payout_batch_id_fkey'
      AND conrelid = 'public.salesperson_commissions'::regclass
  ) THEN
    ALTER TABLE public.salesperson_commissions
      ADD CONSTRAINT salesperson_commissions_payout_batch_id_fkey
      FOREIGN KEY (payout_batch_id)
      REFERENCES public.salesperson_payout_batches(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.salesperson_referrals_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_referrals_set_updated_at
  ON public.salesperson_referrals;
CREATE TRIGGER salesperson_referrals_set_updated_at
BEFORE UPDATE ON public.salesperson_referrals
FOR EACH ROW EXECUTE FUNCTION public.salesperson_referrals_set_updated_at();

CREATE OR REPLACE FUNCTION public.salesperson_commissions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_commissions_set_updated_at
  ON public.salesperson_commissions;
CREATE TRIGGER salesperson_commissions_set_updated_at
BEFORE UPDATE ON public.salesperson_commissions
FOR EACH ROW EXECUTE FUNCTION public.salesperson_commissions_set_updated_at();

CREATE OR REPLACE FUNCTION public.salesperson_payout_batches_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesperson_payout_batches_set_updated_at
  ON public.salesperson_payout_batches;
CREATE TRIGGER salesperson_payout_batches_set_updated_at
BEFORE UPDATE ON public.salesperson_payout_batches
FOR EACH ROW EXECUTE FUNCTION public.salesperson_payout_batches_set_updated_at();
