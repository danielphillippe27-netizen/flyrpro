-- Gold Standard GERS Infrastructure: Buildings and Building Interactions Tables
-- This migration creates the new spatial-entity model using Overture GERS IDs
-- anchored by internal UUIDs with PostGIS geometry types and status caching

-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create buildings table with surrogate keys and PostGIS geometry
CREATE TABLE IF NOT EXISTS public.buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gers_id text UNIQUE NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) NOT NULL,
  latest_status text DEFAULT 'default' CHECK (latest_status IN ('default', 'not_home', 'interested', 'dnc')),
  is_hidden boolean DEFAULT false NOT NULL,
  -- Overture metadata (optional)
  height numeric,
  house_name text,
  addr_housenumber text,
  addr_street text,
  addr_unit text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create building_interactions table for interaction history
CREATE TABLE IF NOT EXISTS public.building_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('default', 'not_home', 'interested', 'dnc')),
  notes text,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create GIST indexes for spatial queries (high performance)
CREATE INDEX IF NOT EXISTS idx_buildings_geom ON public.buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_centroid ON public.buildings USING GIST (centroid);

-- Create B-tree indexes for lookups
CREATE INDEX IF NOT EXISTS idx_buildings_gers_id ON public.buildings (gers_id);
CREATE INDEX IF NOT EXISTS idx_buildings_is_hidden ON public.buildings (is_hidden);
CREATE INDEX IF NOT EXISTS idx_buildings_latest_status ON public.buildings (latest_status);

-- Index for building_interactions lookups
CREATE INDEX IF NOT EXISTS idx_building_interactions_building_id ON public.building_interactions (building_id);
CREATE INDEX IF NOT EXISTS idx_building_interactions_created_at ON public.building_interactions (created_at DESC);

-- Function to update latest_status when a new interaction is added
CREATE OR REPLACE FUNCTION public.update_building_latest_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the latest_status in the buildings table with the most recent interaction status
  UPDATE public.buildings
  SET latest_status = NEW.status,
      updated_at = now()
  WHERE id = NEW.building_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update latest_status when building_interactions is updated
CREATE TRIGGER trigger_update_building_latest_status
  AFTER INSERT ON public.building_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_building_latest_status();

-- Enable Row Level Security
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_interactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (adjust based on your auth requirements)
-- For now, allow authenticated users to read all buildings
CREATE POLICY "Authenticated users can view buildings"
  ON public.buildings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert buildings
CREATE POLICY "Authenticated users can insert buildings"
  ON public.buildings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update buildings
CREATE POLICY "Authenticated users can update buildings"
  ON public.buildings FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to view interactions
CREATE POLICY "Authenticated users can view interactions"
  ON public.building_interactions FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert interactions
CREATE POLICY "Authenticated users can insert interactions"
  ON public.building_interactions FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Add comment for documentation
COMMENT ON TABLE public.buildings IS 'Spatial-entity model using Overture GERS IDs with PostGIS geometry types';
COMMENT ON TABLE public.building_interactions IS 'Interaction history for buildings with automatic status caching';
COMMENT ON COLUMN public.buildings.latest_status IS 'Cached status automatically updated by trigger from building_interactions';
COMMENT ON COLUMN public.buildings.gers_id IS 'Overture GERS (Global Entity Reference System) ID - unique external anchor';

