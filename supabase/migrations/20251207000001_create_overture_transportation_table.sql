-- Overture Transportation Table for Vector-Based Orientation
-- Stores road segments from Overture for calculating house bearings

CREATE TABLE IF NOT EXISTS public.overture_transportation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gers_id text UNIQUE,
  geom geometry(LineString, 4326) NOT NULL,
  class text, -- 'primary', 'secondary', 'residential', etc.
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create GIST index for spatial queries
CREATE INDEX IF NOT EXISTS idx_transport_geom ON public.overture_transportation USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transport_gers_id ON public.overture_transportation (gers_id);
CREATE INDEX IF NOT EXISTS idx_transport_class ON public.overture_transportation (class);

-- Enable Row Level Security
ALTER TABLE public.overture_transportation ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view transportation"
  ON public.overture_transportation FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert transportation"
  ON public.overture_transportation FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Add comment for documentation
COMMENT ON TABLE public.overture_transportation IS 'Overture transportation segments for vector-based house orientation';
COMMENT ON COLUMN public.overture_transportation.gers_id IS 'Overture GERS ID of the transportation segment';


