BEGIN;

ALTER TABLE public.workspace_scripts
  DROP CONSTRAINT IF EXISTS workspace_scripts_body_check;

ALTER TABLE public.workspace_scripts
  ADD CONSTRAINT workspace_scripts_body_check
  CHECK (char_length(body) <= 50000)
  NOT VALID;

ALTER TABLE public.workspace_scripts
  VALIDATE CONSTRAINT workspace_scripts_body_check;

COMMIT;
