-- Founder entitlement: gate admin/founder-only pages and APIs via user_profiles.is_founder.
-- Grant founder to daniel.phillippe27@gmail.com (resolved from auth.users).

-- 1. Add founder flag to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_founder boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.is_founder IS 'Founder entitlement; gates /admin and founder-only APIs.';

-- 2. Helper: true iff current user has is_founder = true (RLS-safe, uses auth.uid())
CREATE OR REPLACE FUNCTION public.is_founder()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_founder = true
  );
$$;

COMMENT ON FUNCTION public.is_founder() IS 'Returns true if the current auth user has founder entitlement (user_profiles.is_founder).';

-- 3. Seed founder for daniel.phillippe27@gmail.com (email in auth.users)
-- Ensure user_profiles row exists then set is_founder = true
INSERT INTO public.user_profiles (user_id, weekly_door_goal, is_founder)
SELECT u.id, 100, true
FROM auth.users u
WHERE lower(u.email) = lower('daniel.phillippe27@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET is_founder = true;
