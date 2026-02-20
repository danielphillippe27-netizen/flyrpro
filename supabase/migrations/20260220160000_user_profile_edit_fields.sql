-- Profile edit: industry, brokerage_name, quote, avatar_url on user_profiles.
-- Used when user edits profile from header (photo, name, industry, brokerage, quote).
-- Workspace name is edited separately by owners via workspaces table.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS brokerage_name text;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS quote text;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.user_profiles.industry IS 'User-selected industry (e.g. Real Estate, Solar).';
COMMENT ON COLUMN public.user_profiles.brokerage_name IS 'Brokerage name when applicable (e.g. Real Estate).';
COMMENT ON COLUMN public.user_profiles.quote IS 'User profile quote or tagline.';
COMMENT ON COLUMN public.user_profiles.avatar_url IS 'Profile photo URL (Supabase Storage or external).';
