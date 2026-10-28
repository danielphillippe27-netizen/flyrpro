BEGIN;
-- Shut down the device-only recording pipeline before storage/provider cleanup.
CREATE OR REPLACE FUNCTION public.reject_retired_recording_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Recording integration retired' USING ERRCODE = '55000';
END $$;
REVOKE ALL ON FUNCTION public.reject_retired_recording_write() FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE name text;
BEGIN
 IF to_regclass('public.field_recording_jobs') IS NOT NULL THEN
  UPDATE public.field_recording_jobs SET status='cancelled', lease_until=NULL WHERE status IN ('pending','running');
 END IF;
 FOR name IN SELECT tablename FROM pg_tables WHERE schemaname='public'
 AND tablename IN ('field_recordings','field_recording_chunks','field_recording_events','field_recording_jobs',
 'field_conversations','field_conversation_applications','field_conversation_contact_preferences',
 'field_conversation_restructures','field_recording_deletions','field_recording_provider_reservations','field_recording_retention_policies')
 LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS reject_retired_recording_write ON public.%I', name);
  EXECUTE format('CREATE TRIGGER reject_retired_recording_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.reject_retired_recording_write()', name);
 END LOOP;
END $$;
COMMIT;
