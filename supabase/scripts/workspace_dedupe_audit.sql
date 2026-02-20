-- Audit: workspaces per owner (by email). Run in Supabase SQL Editor.
-- Use this to see duplicate workspaces before cleaning.

SELECT
  u.email AS owner_email,
  w.owner_id,
  count(*) AS workspace_count,
  array_agg(w.id ORDER BY w.created_at) AS workspace_ids,
  array_agg(w.name ORDER BY w.created_at) AS workspace_names
FROM public.workspaces w
JOIN auth.users u ON u.id = w.owner_id
GROUP BY u.email, w.owner_id
HAVING count(*) > 1
ORDER BY count(*) DESC;

-- Optional: list the "keep" workspace per owner (oldest by created_at) and the rest as duplicates.
-- Uncomment and run separately if you want to identify which to keep vs remove.
/*
WITH ranked AS (
  SELECT
    w.id,
    w.name,
    w.owner_id,
    w.subscription_status,
    w.created_at,
    row_number() OVER (PARTITION BY w.owner_id ORDER BY w.created_at ASC) AS rn
  FROM public.workspaces w
)
SELECT id, name, owner_id, subscription_status, created_at,
  CASE WHEN rn = 1 THEN 'keep' ELSE 'duplicate' END AS suggestion
FROM ranked
ORDER BY owner_id, created_at;
*/
