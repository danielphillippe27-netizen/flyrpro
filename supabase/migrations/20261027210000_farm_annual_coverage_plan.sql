-- Separate annual coverage from the existing daily assignments and touchpoint history.
ALTER TABLE public.farms ADD COLUMN IF NOT EXISTS annual_coverage_plan jsonb;
COMMENT ON COLUMN public.farms.annual_coverage_plan IS 'Versioned annual farm allocation: weekly target, up to 52 calendar weeks, holiday weeks and exact farm address IDs.';
NOTIFY pgrst, 'reload schema';
