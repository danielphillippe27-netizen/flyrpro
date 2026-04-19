BEGIN;

ALTER TABLE public.workspace_invites
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_invites_campaign_id
  ON public.workspace_invites(campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_invites_session_id
  ON public.workspace_invites(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.workspace_invites.campaign_id
  IS 'Optional campaign anchor so accepted invites can route back into the originating campaign.';

COMMENT ON COLUMN public.workspace_invites.session_id
  IS 'Optional live session handoff so accepted invites can rejoin an active shared canvassing session.';

COMMENT ON COLUMN public.workspace_invites.email
  IS 'Optional email restriction for private invites. Null means any authenticated recipient can accept.';

COMMIT;
