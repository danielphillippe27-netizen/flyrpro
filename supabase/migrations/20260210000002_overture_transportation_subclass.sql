-- Add subclass column to overture_transportation for walk network prioritization
-- 
-- Overture segment schema uses:
-- - class: top-level road classification (e.g., 'footway', 'residential', 'primary')
-- - subclass: more specific type (e.g., 'sidewalk', 'crosswalk' for footway class)
--
-- For walk snapping, we prioritize segments where subclass IN ('sidewalk', 'crosswalk')
-- over generic footway/path segments.

-- Ensure table exists (in case migration 20251207000001 hasn't run yet)
CREATE TABLE IF NOT EXISTS public.overture_transportation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gers_id text UNIQUE,
  geom geometry(LineString, 4326) NOT NULL,
  class text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create basic indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_transport_geom ON public.overture_transportation USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transport_gers_id ON public.overture_transportation (gers_id);
CREATE INDEX IF NOT EXISTS idx_transport_class ON public.overture_transportation (class);

-- Enable RLS if not already enabled
ALTER TABLE public.overture_transportation ENABLE ROW LEVEL SECURITY;

-- Add subclass column
ALTER TABLE public.overture_transportation 
ADD COLUMN IF NOT EXISTS subclass text;

-- Create index for subclass lookups
CREATE INDEX IF NOT EXISTS idx_transport_subclass 
ON public.overture_transportation (subclass);

-- Add comments documenting the Overture schema mapping
COMMENT ON COLUMN public.overture_transportation.class IS 
'Overture road class: footway, path, pedestrian, steps, residential, service, primary, secondary, etc.';

COMMENT ON COLUMN public.overture_transportation.subclass IS 
'Overture road subclass: sidewalk, crosswalk, etc. (when class=footway). Used for walk network prioritization.';

-- Update table comment to reflect expanded usage
COMMENT ON TABLE public.overture_transportation IS 
'Overture transportation segments for vector-based house orientation and walk network snapping. Class/subclass follow Overture segment schema. For walk snapping, load segments where subtype = road AND class IN (footway, path, pedestrian, steps) with subclass when available.';
