BEGIN;

ALTER TABLE IF EXISTS public.user_profiles
  ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.leaderboard_hidden IS
  'When true, this user is excluded from public and workspace leaderboard results without deleting the account or stats.';

COMMENT ON COLUMN public.profiles.leaderboard_hidden IS
  'When true, this user is excluded from public and workspace leaderboard results without deleting the account or stats.';

NOTIFY pgrst, 'reload schema';

COMMIT;
