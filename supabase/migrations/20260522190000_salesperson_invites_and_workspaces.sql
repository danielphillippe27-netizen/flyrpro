ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS founder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS invite_token text;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

ALTER TABLE public.salespeople
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

UPDATE public.salespeople
SET invite_token = gen_random_uuid()::text
WHERE invite_token IS NULL;

UPDATE public.salespeople
SET founder_user_id = (
  SELECT up.user_id
  FROM public.user_profiles up
  WHERE up.is_founder = true
  ORDER BY up.created_at ASC NULLS LAST, up.user_id ASC
  LIMIT 1
)
WHERE founder_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.is_founder = true
  );

CREATE UNIQUE INDEX IF NOT EXISTS salespeople_invite_token_unique_idx
  ON public.salespeople (invite_token)
  WHERE invite_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS salespeople_founder_user_idx
  ON public.salespeople (founder_user_id, created_at DESC)
  WHERE founder_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS salespeople_workspace_idx
  ON public.salespeople (workspace_id)
  WHERE workspace_id IS NOT NULL;
