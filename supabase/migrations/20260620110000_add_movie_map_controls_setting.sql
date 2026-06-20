ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS movie_map_controls_enabled boolean NOT NULL DEFAULT false;

UPDATE public.workspaces
SET movie_map_controls_enabled = false
WHERE movie_map_controls_enabled IS DISTINCT FROM false;

COMMENT ON COLUMN public.workspaces.movie_map_controls_enabled IS
  'Workspace opt-in for cinematic clapperboard demo camera controls on web maps.';
