BEGIN;
-- Store user bookmarks/selection provenance. Licensed provider rasters and raw
-- archive responses are not permanently copied by this migration.
CREATE TABLE IF NOT EXISTS public.storm_saved_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  event_key text NOT NULL,
  reference jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,event_key),
  CHECK(jsonb_typeof(reference)='object')
);
CREATE TABLE IF NOT EXISTS public.storm_property_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  event_key text NOT NULL,
  longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  latitude double precision NOT NULL CHECK(latitude BETWEEN -85 AND 85),
  property_label text NOT NULL DEFAULT '',
  outcome text NOT NULL CHECK(outcome IN ('pending','damage_observed','no_damage_observed','follow_up','do_not_knock')),
  notes text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storm_inspections_event_idx ON public.storm_property_inspections(workspace_id,event_key,observed_at DESC);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS storm_context jsonb;
COMMENT ON COLUMN public.campaigns.storm_context IS 'Immutable storm selection provenance at campaign creation; user-drawn boundary does not imply confirmed damage.';
ALTER TABLE public.storm_saved_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storm_property_inspections ENABLE ROW LEVEL SECURITY;
-- Access is through membership-checked server routes only. No browser table grants.
REVOKE ALL ON public.storm_saved_events,public.storm_property_inspections FROM anon,authenticated;
GRANT ALL ON public.storm_saved_events,public.storm_property_inspections TO service_role;
CREATE TABLE IF NOT EXISTS public.storm_archive_usage (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,day)
);
ALTER TABLE public.storm_archive_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storm_archive_usage FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.consume_storm_archive_request(p_workspace_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE accepted boolean;
BEGIN
  INSERT INTO storm_archive_usage(workspace_id,day,requests)
  VALUES(p_workspace_id,(now() AT TIME ZONE 'UTC')::date,1)
  ON CONFLICT(workspace_id,day) DO UPDATE SET requests=storm_archive_usage.requests+1
  WHERE storm_archive_usage.requests<300 RETURNING true INTO accepted;
  RETURN coalesce(accepted,false);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_storm_archive_request(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_storm_archive_request(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
