import { createAdminClient } from '@/lib/supabase/server';
import { checkedRetentionCandidates, dispatchRetentionCandidates } from './retention';

export async function expireFieldRecordings() {
  const db = createAdminClient();
  const { data, error } = await db.rpc('field_recording_retention_candidates');
  if (error) throw new Error('Retention queue unavailable');
  return dispatchRetentionCandidates(checkedRetentionCandidates(data), async row => {
    const { data: receipt, error: expireError } = await db.rpc('expire_field_recording', { p_recording: row.recording_id, p_policy_version: row.policy_version });
    if (expireError) throw new Error('Retention expiry unavailable');
    if (receipt === null) return false;
    if (!receipt || receipt.recordingId !== row.recording_id || typeof receipt.requestId !== 'string') throw new Error('Retention receipt unavailable');
    return true;
  }, async row => {
    const { error: deferError } = await db.rpc('defer_field_recording_retention', { p_recording: row.recording_id, p_policy_version: row.policy_version });
    if (deferError) throw new Error('Retention retry unavailable');
  });
}
