-- Add weekly goal columns to user_profiles for Home dashboard.
-- Used by GET /api/home/dashboard and PATCH /api/user/goals.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_door_goal integer DEFAULT 100;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_sessions_goal integer;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS weekly_minutes_goal integer;

COMMENT ON COLUMN public.user_profiles.weekly_door_goal IS 'Weekly doors hit goal for Home dashboard';
COMMENT ON COLUMN public.user_profiles.weekly_sessions_goal IS 'Optional weekly sessions goal';
COMMENT ON COLUMN public.user_profiles.weekly_minutes_goal IS 'Optional weekly minutes doorknocking goal';
