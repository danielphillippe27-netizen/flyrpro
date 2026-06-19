BEGIN;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS tags text;

COMMENT ON COLUMN public.contacts.source IS 'Optional lead source, such as open house, referral, website, scraper, or import.';
COMMENT ON COLUMN public.contacts.tags IS 'Optional tags for the contact, stored as comma-separated text.';

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_source
  ON public.contacts(workspace_id, source);

CREATE TABLE IF NOT EXISTS public.smart_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_lists_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_smart_lists_workspace_created
  ON public.smart_lists(workspace_id, created_at DESC);

ALTER TABLE public.smart_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smart_lists_member_read" ON public.smart_lists;
CREATE POLICY "smart_lists_member_read"
  ON public.smart_lists FOR SELECT
  USING (workspace_id = ANY(public.current_user_workspace_ids()));

DROP POLICY IF EXISTS "smart_lists_member_insert" ON public.smart_lists;
CREATE POLICY "smart_lists_member_insert"
  ON public.smart_lists FOR INSERT
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "smart_lists_creator_or_admin_update" ON public.smart_lists;
CREATE POLICY "smart_lists_creator_or_admin_update"
  ON public.smart_lists FOR UPDATE
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND (
      created_by_user_id = auth.uid()
      OR public.is_workspace_owner_or_admin(workspace_id)
    )
  )
  WITH CHECK (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND (
      created_by_user_id = auth.uid()
      OR public.is_workspace_owner_or_admin(workspace_id)
    )
  );

DROP POLICY IF EXISTS "smart_lists_creator_or_admin_delete" ON public.smart_lists;
CREATE POLICY "smart_lists_creator_or_admin_delete"
  ON public.smart_lists FOR DELETE
  USING (
    workspace_id = ANY(public.current_user_workspace_ids())
    AND (
      created_by_user_id = auth.uid()
      OR public.is_workspace_owner_or_admin(workspace_id)
    )
  );

COMMIT;
