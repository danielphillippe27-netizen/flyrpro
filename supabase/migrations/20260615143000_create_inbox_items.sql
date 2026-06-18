CREATE TABLE IF NOT EXISTS public.inbox_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  salesperson_id uuid REFERENCES public.salespeople(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('email', 'sms', 'call', 'task', 'system')),
  source_table text,
  source_id text,
  external_id text,
  title text NOT NULL,
  preview text,
  body text,
  from_label text,
  from_email text,
  from_phone text,
  to_label text,
  to_email text,
  to_phone text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'snoozed', 'archived')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  done_at timestamptz,
  snoozed_until timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_items_workspace_source_key UNIQUE (workspace_id, source, source_table, source_id),
  CONSTRAINT inbox_items_workspace_external_key UNIQUE (workspace_id, source, external_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_workspace_source_unique
  ON public.inbox_items (workspace_id, source, source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_workspace_external_unique
  ON public.inbox_items (workspace_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_occurred
  ON public.inbox_items (workspace_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_workspace_status_occurred
  ON public.inbox_items (workspace_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_items_owner_status_occurred
  ON public.inbox_items (owner_user_id, status, occurred_at DESC)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_items_contact_occurred
  ON public.inbox_items (contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_inbox_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_inbox_items_updated_at ON public.inbox_items;
CREATE TRIGGER set_inbox_items_updated_at
BEFORE UPDATE ON public.inbox_items
FOR EACH ROW
EXECUTE FUNCTION public.set_inbox_items_updated_at();

ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_items_workspace_members_select ON public.inbox_items;
CREATE POLICY inbox_items_workspace_members_select
ON public.inbox_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = inbox_items.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS inbox_items_workspace_members_update ON public.inbox_items;
CREATE POLICY inbox_items_workspace_members_update
ON public.inbox_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = inbox_items.workspace_id
      AND wm.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = inbox_items.workspace_id
      AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS inbox_items_service_role_all ON public.inbox_items;
CREATE POLICY inbox_items_service_role_all
ON public.inbox_items
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
