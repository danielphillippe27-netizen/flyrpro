-- Ensure CRM connections are unique per workspace/provider (not per user/provider).
-- Supports multi-tenant integrations where one user may belong to multiple workspaces.

BEGIN;

-- Legacy unique index from single-user model.
DROP INDEX IF EXISTS public.idx_crm_connections_user_provider;

-- New multi-tenant unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_connections_workspace_provider
ON public.crm_connections(workspace_id, provider);

-- Helpful lookup index for workspace-scoped integration reads.
CREATE INDEX IF NOT EXISTS idx_crm_connections_workspace_status
ON public.crm_connections(workspace_id, status);

COMMIT;
