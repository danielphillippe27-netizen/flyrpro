'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { checkedDeletionReceipt, checkedDeletionStatus } from '@/lib/field-recordings/deletion-status';
import { clearRecordingDeletion, pendingRecordingDeletions, persistRecordingDeletion } from '@/lib/field-recordings/deletion-journal';
type Status = ReturnType<typeof checkedDeletionStatus>;
export default function RecordingDeletion({ ownerId, workspaceId, recordingId, dirty, onHidden, onLocked }: { ownerId: string; workspaceId: string; recordingId: string; dirty: boolean; onHidden: () => void; onLocked: (locked: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const hiddenCallback = useRef(onHidden);
  useEffect(() => { hiddenCallback.current = onHidden; }, [onHidden]);
  useEffect(() => {
    const refreshStatus = () => setRevision(value => value + 1);
    window.addEventListener('focus', refreshStatus);
    return () => window.removeEventListener('focus', refreshStatus);
  }, []);
  useEffect(() => { onLocked(busy || requestId !== null); return () => onLocked(false); }, [busy, requestId, onLocked]);
  useEffect(() => {
    const version = ++generation.current;
    setStatus(null); setRequestId(null); setBusy(false); setError(null);
    const controller = new AbortController();
    try { setRequestId(pendingRecordingDeletions(localStorage, ownerId, workspaceId).find(entry => entry.recordingId === recordingId)?.requestId ?? null); }
    catch { setError('Saved deletion requests could not be read. Reopen review.'); return; }
    fetch(`/api/field-recordings/${recordingId}/deletion`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Deletion status unavailable');
      const value = checkedDeletionStatus(await response.json(), recordingId);
      if (generation.current === version && !controller.signal.aborted) {
        setStatus(value);
        if (value.hidden) hiddenCallback.current();
      }
    }).catch(() => { if (!controller.signal.aborted) setError('Deletion status could not be checked.'); });
    return () => { controller.abort(); generation.current = version + 1; };
  }, [ownerId, workspaceId, recordingId, revision]);
  async function submit() {
    if (!status || busy || dirty || (!requestId && (!status.deletionEnabled || !status.captureStopped || status.hidden))) return;
    if (!requestId && !window.confirm('Request recording deletion? This hides the recording and queues audio cleanup. Provider cleanup may remain pending. Approved contact notes and tasks, and copies on your pin or phone, remain.')) return;
    const version = generation.current;
    setBusy(true); setError(null);
    let savedId = requestId;
    try {
      savedId ??= crypto.randomUUID();
      const saved = persistRecordingDeletion(localStorage, ownerId, workspaceId, { recordingId, requestId: savedId });
      setRequestId(saved.requestId);
      const response = await fetch(`/api/field-recordings/${recordingId}/deletion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: saved.requestId }) });
      const value = await response.json();
      if (generation.current !== version) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) { clearRecordingDeletion(localStorage, ownerId, workspaceId, recordingId, saved.requestId); setRequestId(null); }
        throw new Error(value.error || 'Deletion could not be confirmed');
      }
      checkedDeletionReceipt(value, recordingId, saved.requestId);
      setStatus(current => current ? { ...current, hidden: true } : current); hiddenCallback.current();
    } catch (cause) { if (generation.current === version) setError(cause instanceof Error ? cause.message : 'Deletion could not be confirmed'); }
    finally { if (generation.current === version) setBusy(false); }
  }
  return <details className="space-y-2 rounded border p-3"><summary className="cursor-pointer font-medium">Recording deletion</summary>
    <p className="text-sm">Deletion hides this recording and requests audio cleanup. Provider cleanup and copies on your devices may remain pending. Approved contact notes and tasks remain.</p>
    {status?.hidden && <p role="status" className="text-sm">Hidden from review. Complete cleanup is not yet confirmed.</p>}
    {status?.cleanup && <p className="text-sm">Private audio: {status.cleanup.storage_state}. Provider: {status.cleanup.provider_state}.</p>}
    <Button variant="outline" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh cleanup status</Button>
    {status && !status.deletionEnabled && !requestId && <p className="text-sm">Deletion rollout is not enabled yet.</p>}
    {dirty && <p className="text-sm">Save draft edits before requesting deletion.</p>}
    <Button variant="outline" disabled={!status || busy || dirty || (!requestId && (!status.deletionEnabled || !status.captureStopped || status.hidden))} onClick={() => void submit()}>{busy ? 'Checking deletion…' : requestId ? 'Recover saved deletion' : 'Request deletion'}</Button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </details>;
}
