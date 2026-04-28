ALTER TABLE public.ambassador_applications
  ADD COLUMN IF NOT EXISTS referral_code_max_uses integer,
  ADD COLUMN IF NOT EXISTS stripe_promotion_code_id text;

ALTER TABLE public.ambassador_applications
  DROP CONSTRAINT IF EXISTS ambassador_applications_referral_code_max_uses_check;
ALTER TABLE public.ambassador_applications
  ADD CONSTRAINT ambassador_applications_referral_code_max_uses_check
  CHECK (referral_code_max_uses IS NULL OR referral_code_max_uses >= 1);
