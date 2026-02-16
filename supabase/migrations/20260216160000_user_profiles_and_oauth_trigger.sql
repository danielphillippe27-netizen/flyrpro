-- Ensure user_profiles exists and auto-create row on signup (fixes 404/500 for OAuth users).
-- Run after 20260210000000 (weekly goals) so we create table with all columns if missing.

-- 1. Create user_profiles if not present (e.g. project only had migrations, no schema.sql)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pro_active boolean DEFAULT false,
  stripe_customer_id text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Add weekly goal columns if missing (idempotent)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_door_goal integer DEFAULT 100;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_sessions_goal integer;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_minutes_goal integer;

-- 2. RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it only had USING (so we can add WITH CHECK for insert)
DROP POLICY IF EXISTS "own profile" ON public.user_profiles;

-- Own profile: select/update/delete by owner; insert only for own user_id
CREATE POLICY "own profile"
  ON public.user_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Function: insert a user_profiles row for a new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, weekly_door_goal)
  VALUES (new.id, 100)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a user_profiles row when a new user signs up (email or OAuth). Fixes 404/500 for OAuth users.';

-- 4. Trigger on auth.users (runs after insert)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 5. Backfill: insert user_profiles for any existing auth users who don't have one
INSERT INTO public.user_profiles (user_id, weekly_door_goal)
SELECT id, 100
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_profiles)
ON CONFLICT (user_id) DO NOTHING;
