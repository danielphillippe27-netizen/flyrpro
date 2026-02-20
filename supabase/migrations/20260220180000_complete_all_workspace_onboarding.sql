-- Mark onboarding as completed for all workspaces that don't have it set.
-- After this, the post-auth gate will send owners to /home instead of /onboarding.

UPDATE workspaces
SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
WHERE onboarding_completed_at IS NULL;
