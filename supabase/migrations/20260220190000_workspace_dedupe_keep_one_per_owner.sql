-- One-time cleanup: for owners with multiple workspaces, keep the oldest and remove
-- duplicates that have no campaigns (safe to delete). Run after workspace_dedupe_audit.sql.

-- Delete duplicate workspaces: same owner, not the "keep" one (oldest), and no campaigns.
DELETE FROM public.workspaces w
WHERE w.owner_id IN (
  SELECT owner_id
  FROM public.workspaces
  GROUP BY owner_id
  HAVING count(*) > 1
)
AND w.id <> (
  SELECT id
  FROM public.workspaces w2
  WHERE w2.owner_id = w.owner_id
  ORDER BY w2.created_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM public.campaigns c WHERE c.workspace_id = w.id)
AND NOT EXISTS (SELECT 1 FROM public.crm_connections cc WHERE cc.workspace_id = w.id)
AND NOT EXISTS (SELECT 1 FROM public.buildings b WHERE b.workspace_id = w.id)
AND NOT EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.workspace_id = w.id);
