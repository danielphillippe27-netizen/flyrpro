CREATE INDEX IF NOT EXISTS salesperson_lead_master_workspace_assignee_created_idx
  ON public.salesperson_lead_master(workspace_id, assigned_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS salesperson_lead_master_workspace_salesperson_created_idx
  ON public.salesperson_lead_master(workspace_id, assigned_salesperson_id, created_at DESC)
  WHERE assigned_salesperson_id IS NOT NULL;
