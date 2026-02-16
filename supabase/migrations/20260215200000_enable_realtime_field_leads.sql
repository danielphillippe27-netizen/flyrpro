-- Enable Realtime for field_leads so the web app can show leads created on iOS without refresh.
-- Dashboard: Database → Replication → supabase_realtime (or run this migration).
-- If field_leads does not exist yet, this block is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'field_leads'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'field_leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.field_leads;
  END IF;
END
$$;

-- Only add comment if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'field_leads') THEN
    EXECUTE 'COMMENT ON TABLE public.field_leads IS ''Field-captured leads from door sessions; optional sync to external CRM. Realtime enabled for web sync.''';
  END IF;
END
$$;
