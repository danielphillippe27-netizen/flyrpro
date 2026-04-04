BEGIN;

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS message text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_invites_status_check'
      AND conrelid = 'public.workspace_invites'::regclass
  ) THEN
    ALTER TABLE public.workspace_invites
      DROP CONSTRAINT workspace_invites_status_check;
  END IF;
END $$;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'canceled'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_workspace_email_pending_unique
  ON public.workspace_invites(workspace_id, lower(trim(email)))
  WHERE status = 'pending';

COMMENT ON COLUMN public.workspace_invites.last_sent_at IS 'When the most recent join link for this invite was issued.';
COMMENT ON COLUMN public.workspace_invites.message IS 'Optional owner/admin message shown alongside the invite.';

COMMIT;
