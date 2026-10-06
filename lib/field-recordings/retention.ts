export function checkedRetention(value: unknown): { retentionDays: number | null; version: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid retention settings');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['retentionDays', 'version'].includes(key)) ||
      (row.retentionDays !== null && (!Number.isInteger(row.retentionDays) || Number(row.retentionDays) < 1 || Number(row.retentionDays) > 3650)) ||
      !Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new Error('Invalid retention settings');
  return { retentionDays: row.retentionDays as number | null, version: row.version as number };
}

export function retentionEnabled(retention: string | undefined, deletion: string | undefined): boolean {
  return retention === 'true' && deletion === 'true';
}
type Candidate = { recording_id: string; policy_version: number };
export function checkedRetentionCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value) || value.length > 3) throw new Error('Retention queue unavailable');
  const ids = new Set<string>();
  return value.map(row => {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !['recording_id', 'policy_version'].includes(key)) ||
        typeof row.recording_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.recording_id) ||
        ids.has(row.recording_id) || !Number.isSafeInteger(row.policy_version) || row.policy_version < 1) throw new Error('Retention queue unavailable');
    ids.add(row.recording_id);
    return { recording_id: row.recording_id, policy_version: row.policy_version };
  });
}
/** Each expiry is a separate database transaction; one failure must not starve later rows. */
export async function dispatchRetentionCandidates(candidates: Candidate[], expire: (row: Candidate) => Promise<boolean>, defer: (row: Candidate) => Promise<void>) {
  let recordingsExpired = 0, retentionFailures = 0, retentionRetryFailures = 0;
  for (const row of candidates) {
    try { if (await expire(row)) recordingsExpired++; }
    catch {
      retentionFailures++;
      try { await defer(row); } catch { retentionRetryFailures++; }
    }
  }
  return { recordingsExpired, retentionFailures, retentionRetryFailures };
}
