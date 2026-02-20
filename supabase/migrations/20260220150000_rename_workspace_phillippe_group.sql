-- Set workspace name to "Phillippe Group" for the workspace owned by daniel.phillippe27@gmail.com.
UPDATE public.workspaces w
SET name = 'Phillippe Group', updated_at = now()
FROM auth.users u
WHERE w.owner_id = u.id
  AND lower(u.email) = lower('daniel.phillippe27@gmail.com');
