BEGIN;
CREATE TABLE IF NOT EXISTS public.storm_event_snapshots (
 event_key text NOT NULL REFERENCES public.storm_events(event_key) ON DELETE CASCADE,
 content_hash text NOT NULL,
 payload jsonb NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_key,content_hash)
);
CREATE TABLE IF NOT EXISTS public.storm_archive_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL,
 product text NOT NULL,
 content_hash text NOT NULL,
 source_time timestamptz NOT NULL,
 bucket text NOT NULL DEFAULT 'storm-archive',
 storage_path text NOT NULL,
 byte_size bigint NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 captured_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,product,content_hash)
);
CREATE TABLE IF NOT EXISTS public.storm_collection_runs (
 window_key text PRIMARY KEY,
 status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','complete','partial','failed')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS storm_archive_assets_time_idx ON public.storm_archive_assets(provider,product,source_time);
CREATE INDEX IF NOT EXISTS storm_event_snapshots_time_idx ON public.storm_event_snapshots(captured_at);
DO $$ DECLARE tab text; BEGIN FOREACH tab IN ARRAY ARRAY['storm_event_snapshots','storm_archive_assets','storm_collection_runs'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tab);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
END LOOP; END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('storm-archive','storm-archive',false,10000000,ARRAY['application/gzip']) ON CONFLICT(id) DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
