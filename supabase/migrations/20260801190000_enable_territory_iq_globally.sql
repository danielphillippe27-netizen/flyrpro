BEGIN;

ALTER TABLE public.workspaces
  ALTER COLUMN territory_iq_enabled SET DEFAULT true;

-- The tab is already globally visible. Enable future mutation/source triggers
-- without creating an immediate duplicate score job for every old campaign.
ALTER TABLE public.workspaces DISABLE TRIGGER workspaces_enqueue_territory_iq;

UPDATE public.workspaces
SET territory_iq_enabled = true,
    updated_at = now()
WHERE territory_iq_enabled = false;

ALTER TABLE public.workspaces ENABLE TRIGGER workspaces_enqueue_territory_iq;

COMMIT;
