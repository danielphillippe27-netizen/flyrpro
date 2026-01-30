-- Add Address Columns to Buildings and Map_Buildings Tables
-- Fixes PGRST204 error where 'addr_housenumber' column is missing
-- Ensures both tables have consistent address fields for Overture data

-- Note: buildings table already has addr_housenumber, addr_street, addr_unit
-- from migration 20251207000000_create_gers_buildings_tables.sql
-- This migration ensures they exist and adds corresponding fields to map_buildings

-- Step 1: Ensure buildings table has address columns (idempotent)
ALTER TABLE public.buildings 
  ADD COLUMN IF NOT EXISTS addr_housenumber text,
  ADD COLUMN IF NOT EXISTS addr_street text,
  ADD COLUMN IF NOT EXISTS addr_unit text;

-- Step 2: Add address columns to map_buildings table
-- Using house_number and street_name to match common naming conventions
ALTER TABLE public.map_buildings 
  ADD COLUMN IF NOT EXISTS house_number text,
  ADD COLUMN IF NOT EXISTS street_name text;

-- Step 3: Create indexes for address lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_buildings_addr_street ON public.buildings(addr_street) WHERE addr_street IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_map_buildings_street_name ON public.map_buildings(street_name) WHERE street_name IS NOT NULL;

-- Step 4: Refresh PostgREST schema cache
-- This ensures the API immediately recognizes the new columns
NOTIFY pgrst, 'reload schema';

-- Add comments for documentation
COMMENT ON COLUMN public.buildings.addr_housenumber IS 'House number from Overture address data';
COMMENT ON COLUMN public.buildings.addr_street IS 'Street name from Overture address data';
COMMENT ON COLUMN public.buildings.addr_unit IS 'Unit number from Overture address data';
COMMENT ON COLUMN public.map_buildings.house_number IS 'House number from Overture address data (synced with buildings.addr_housenumber)';
COMMENT ON COLUMN public.map_buildings.street_name IS 'Street name from Overture address data (synced with buildings.addr_street)';
