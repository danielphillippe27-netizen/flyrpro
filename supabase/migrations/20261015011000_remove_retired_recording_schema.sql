BEGIN;
-- The recording tables were created exclusively for the retired device integration.
-- Approved CRM notes/tasks live in separate tables and must remain untouched.
-- Storage API cleanup and provider reconciliation must precede this migration.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='field-recordings') THEN
  RAISE EXCEPTION 'Remove recording audio through the Storage API before schema retirement';
 END IF;
END $$;
DROP TABLE IF EXISTS public.field_conversation_applications,
 public.field_conversation_contact_preferences,
 public.field_conversation_restructures,
 public.field_conversations,
 public.field_recording_chunks,
 public.field_recording_deletions,
 public.field_recording_events,
 public.field_recording_jobs,
 public.field_recording_provider_reservations,
 public.field_recording_retention_policies,
 public.field_recordings RESTRICT;
DO $$
DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
 'append_field_recording_event',
 'apply_field_conversation',
 'assign_field_conversation',
 'checkpoint_field_recording_audio_duration',
 'claim_field_recording_job',
 'commit_field_recording_job',
 'complete_field_recording_storage_cleanup',
 'defer_field_recording_retention',
 'defer_field_recording_storage_cleanup',
 'enqueue_field_recording_chunk',
 'expire_field_recording',
 'field_conversation_application_options',
 'field_recording_audio_usage',
 'field_recording_provider_usage',
 'field_recording_retention_candidates',
 'guard_field_recording_chunk_identity',
 'merge_field_conversations',
 'refresh_field_recording_processing',
 'reject_retired_recording_write',
 'request_field_recording_deletion',
 'reserve_field_recording_provider_request',
 'reserve_field_recording_upload',
 'review_field_conversation_draft',
 'set_field_recording_retention',
 'split_field_conversation')
 LOOP
  EXECUTE 'DROP FUNCTION ' || fn.signature || ' RESTRICT';
 END LOOP;
END $$;
COMMIT;
