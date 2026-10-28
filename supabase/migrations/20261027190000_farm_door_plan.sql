-- Store the exact weekday home allocations with the farm, shared by its members.
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS door_plan jsonb;
COMMENT ON COLUMN public.farms.door_plan IS 'Versioned weekday door plan containing start date, daily capacity and farm address IDs.';
