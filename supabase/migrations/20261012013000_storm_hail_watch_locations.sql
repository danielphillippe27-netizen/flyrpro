BEGIN;
CREATE TABLE IF NOT EXISTS public.storm_hail_watch_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 country text NOT NULL CHECK(country IN ('CA','AU')),
 name text NOT NULL,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(country,latitude,longitude)
);
ALTER TABLE public.storm_hail_watch_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storm_hail_watch_locations FROM anon,authenticated;
GRANT ALL ON public.storm_hail_watch_locations TO service_role;
COMMIT;
