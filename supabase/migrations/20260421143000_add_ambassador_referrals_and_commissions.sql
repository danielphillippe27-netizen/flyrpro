ALTER TABLE public.ambassador_applications
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS commission_rate_bps integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS commission_duration_months integer NOT NULL DEFAULT 12;

ALTER TABLE public.ambassador_applications
  DROP CONSTRAINT IF EXISTS ambassador_applications_commission_rate_bps_check;
ALTER TABLE public.ambassador_applications
  ADD CONSTRAINT ambassador_applications_commission_rate_bps_check
  CHECK (commission_rate_bps >= 0 AND commission_rate_bps <= 10000);

ALTER TABLE public.ambassador_applications
  DROP CONSTRAINT IF EXISTS ambassador_applications_commission_duration_months_check;
ALTER TABLE public.ambassador_applications
  ADD CONSTRAINT ambassador_applications_commission_duration_months_check
  CHECK (commission_duration_months >= 1 AND commission_duration_months <= 36);

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_applications_referral_code_lower_idx
  ON public.ambassador_applications ((lower(referral_code)))
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ambassador_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  commission_rate_bps integer NOT NULL DEFAULT 2000,
  commission_duration_months integer NOT NULL DEFAULT 12,
  first_paid_at timestamptz,
  eligible_until timestamptz,
  last_paid_at timestamptz,
  status text NOT NULL DEFAULT 'attributed'
    CHECK (status IN ('attributed', 'active', 'expired', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_referrals_workspace_unique_idx
  ON public.ambassador_referrals (referred_workspace_id);

CREATE INDEX IF NOT EXISTS ambassador_referrals_ambassador_idx
  ON public.ambassador_referrals (ambassador_application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_referrals_subscription_idx
  ON public.ambassador_referrals (stripe_subscription_id);

ALTER TABLE public.ambassador_referrals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ambassador_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ambassador_referral_id uuid NOT NULL REFERENCES public.ambassador_referrals(id) ON DELETE CASCADE,
  ambassador_application_id uuid NOT NULL REFERENCES public.ambassador_applications(id) ON DELETE CASCADE,
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
    CHECK (status IN ('pending', 'paid', 'voided'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_commissions_invoice_unique_idx
  ON public.ambassador_commissions (stripe_invoice_id);

CREATE INDEX IF NOT EXISTS ambassador_commissions_ambassador_status_idx
  ON public.ambassador_commissions (ambassador_application_id, status, earned_at DESC);

CREATE INDEX IF NOT EXISTS ambassador_commissions_referral_idx
  ON public.ambassador_commissions (ambassador_referral_id, earned_at DESC);

ALTER TABLE public.ambassador_commissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ambassador_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'paid', 'failed')),
  currency text NOT NULL,
  total_commission_cents integer NOT NULL DEFAULT 0 CHECK (total_commission_cents >= 0),
  note text,
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS ambassador_payout_batches_status_idx
  ON public.ambassador_payout_batches (status, created_at DESC);

ALTER TABLE public.ambassador_payout_batches ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ambassador_payout_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  payout_batch_id uuid NOT NULL REFERENCES public.ambassador_payout_batches(id) ON DELETE CASCADE,
  ambassador_commission_id uuid NOT NULL REFERENCES public.ambassador_commissions(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_payout_batch_items_commission_unique_idx
  ON public.ambassador_payout_batch_items (ambassador_commission_id);

CREATE INDEX IF NOT EXISTS ambassador_payout_batch_items_batch_idx
  ON public.ambassador_payout_batch_items (payout_batch_id);

ALTER TABLE public.ambassador_payout_batch_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ambassador_referrals_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ambassador_referrals_set_updated_at
  ON public.ambassador_referrals;
CREATE TRIGGER ambassador_referrals_set_updated_at
BEFORE UPDATE ON public.ambassador_referrals
FOR EACH ROW EXECUTE FUNCTION public.ambassador_referrals_set_updated_at();

CREATE OR REPLACE FUNCTION public.ambassador_commissions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ambassador_commissions_set_updated_at
  ON public.ambassador_commissions;
CREATE TRIGGER ambassador_commissions_set_updated_at
BEFORE UPDATE ON public.ambassador_commissions
FOR EACH ROW EXECUTE FUNCTION public.ambassador_commissions_set_updated_at();

CREATE OR REPLACE FUNCTION public.ambassador_payout_batches_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ambassador_payout_batches_set_updated_at
  ON public.ambassador_payout_batches;
CREATE TRIGGER ambassador_payout_batches_set_updated_at
BEFORE UPDATE ON public.ambassador_payout_batches
FOR EACH ROW EXECUTE FUNCTION public.ambassador_payout_batches_set_updated_at();
