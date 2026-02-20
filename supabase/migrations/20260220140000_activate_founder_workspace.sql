-- Activate workspace(s) owned by the founder daniel.phillippe27@gmail.com so they have dashboard access.
-- Sets subscription_status = 'trialing' and trial_ends_at = 1 year from now.

UPDATE public.workspaces w
SET
  subscription_status = 'trialing',
  trial_ends_at = now() + interval '1 year',
  updated_at = now()
FROM auth.users u
WHERE w.owner_id = u.id
  AND lower(u.email) = lower('daniel.phillippe27@gmail.com');
