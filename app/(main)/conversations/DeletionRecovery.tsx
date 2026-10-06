'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { pendingRecordingDeletions } from '@/lib/field-recordings/deletion-journal';
import RecordingDeletion from './RecordingDeletion';
export default function DeletionRecovery({ workspaceId, excludedRecordingId }: { workspaceId: string; excludedRecordingId: string | null }) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ recordingId: string; requestId: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let authVersion = 0;
    const client = createClient();
    setOwnerId(null); setEntries([]); setError(null);
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (active) { authVersion++; setEntries([]); setOwnerId(session?.user.id ?? null); setRevision(value => value + 1); }
    });
    client.auth.getUser().then(({ data, error: authError }) => {
      if (!active || authVersion !== 0) return;
      if (authError) setError('Sign in to recover deletion requests.');
      else setOwnerId(data.user?.id ?? null);
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, [workspaceId]);
  useEffect(() => {
    setEntries([]);
    if (!ownerId) return;
    try { setEntries(pendingRecordingDeletions(localStorage, ownerId, workspaceId)); setError(null); }
    catch { setError('Saved deletion requests could not be read. Browser recovery is unavailable.'); }
  }, [ownerId, workspaceId, revision, excludedRecordingId]);
  const visible = entries.filter(entry => entry.recordingId !== excludedRecordingId);
  return <section className="space-y-3" aria-label="Deletion recovery">
    <button type="button" className="text-sm underline" onClick={() => setRevision(value => value + 1)}>Check saved deletion requests</button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {ownerId && visible.map(entry => <div key={`${ownerId}:${workspaceId}:${entry.recordingId}`} className="rounded border p-3"><p className="text-sm">Saved recording deletion · {entry.recordingId.slice(0, 8)}</p><RecordingDeletion ownerId={ownerId} workspaceId={workspaceId} recordingId={entry.recordingId} dirty={false} onHidden={() => undefined} onLocked={() => undefined} /></div>)}
  </section>;
}
