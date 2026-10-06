import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { cleanupDeletionEntries, deletionStoragePaths, removeDeletionStorage } from './deletion';
/** Retries repeat storage batches. Real storage idempotency requires acceptance testing. */
export async function cleanupFieldRecordingStorage() {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: pending, error } = await db.from('field_recording_deletions').select('recording_id,user_id,workspace_id,manifest').eq('storage_state', 'pending').lte('storage_not_before', now).lte('storage_retry_after', now).order('storage_retry_after').order('created_at').limit(3);
  if (error) throw new Error('Deletion queue unavailable');
  return cleanupDeletionEntries(pending || [], async entry => {
    const { data: recording, error: recordingError } = await db.from('field_recordings').select('id,user_id,workspace_id,deleted_at').eq('id', entry.recording_id).maybeSingle();
    if (recordingError || !recording?.deleted_at || recording.user_id !== entry.user_id || recording.workspace_id !== entry.workspace_id) throw new Error('Deletion identity unavailable');
    const chunks = await fetchAllInPages<{ id: string; storage_path: string }>(async (from, to) => await db.from('field_recording_chunks').select('id,storage_path').eq('recording_id', entry.recording_id).order('id').range(from, to));
    const paths = deletionStoragePaths({ recordingId: entry.recording_id, userId: entry.user_id, workspaceId: entry.workspace_id }, entry.manifest, chunks || []);
    await removeDeletionStorage(paths, async batch => {
      const { error: removeError } = await db.storage.from('field-recordings').remove(batch);
      if (removeError) throw new Error('Private audio cleanup unavailable');
    }, async () => {
      const { error: commitError } = await db.rpc('complete_field_recording_storage_cleanup', { p_recording: entry.recording_id });
      if (commitError) throw new Error('Deletion checkpoint unavailable');
    });
  }, async entry => {
    const { error: retryError } = await db.rpc('defer_field_recording_storage_cleanup', { p_recording: entry.recording_id });
    if (retryError) throw new Error('Cleanup retry checkpoint unavailable');
  });
}
