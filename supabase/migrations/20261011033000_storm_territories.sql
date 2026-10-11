BEGIN;
CREATE TABLE IF NOT EXISTS public.storm_territories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  boundary jsonb NOT NULL CHECK (boundary->>'type' = 'Polygon'),
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storm_territories_workspace_idx ON public.storm_territories(workspace_id,created_at DESC);
ALTER TABLE public.storm_territories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storm_territories FROM anon,authenticated;
GRANT ALL ON public.storm_territories TO service_role;
COMMENT ON TABLE public.storm_territories IS 'Saved user-selected storm prospecting boundaries. Child campaigns link via storm_context.territoryId.';
NOTIFY pgrst,'reload schema';
COMMIT;
