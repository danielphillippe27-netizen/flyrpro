'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { pendingPreferences, recoverSavedPreference, type PendingPreference } from '@/lib/field-recordings/contact-preference';

export default function PreferenceRecovery({ ownerId, workspaceId, visibleSources }: {
  ownerId: string; workspaceId: string; visibleSources: { recordingId: string; conversationId: string }[];
}) {
  const [entries, setEntries] = useState<PendingPreference[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifetime = new AbortController(); controller.current = lifetime;
    setEntries([]); setMessage(null); setBusy(null);
    function refresh() {
      if (lifetime.signal.aborted) return;
      try { setEntries(pendingPreferences(localStorage, ownerId, workspaceId)); }
      catch { setEntries([]); setMessage('Saved preferences could not be read. Keep browser recovery data and reopen this page.'); }
    }
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('storage', refresh);
    return () => { lifetime.abort(); window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, [ownerId, workspaceId]);
  async function recover(entry: PendingPreference) {
    const lifetime = controller.current;
    if (!lifetime || lifetime.signal.aborted || busy) return;
    setBusy(entry.key); setMessage(null);
    try {
      const result = await recoverSavedPreference(localStorage, entry, workspaceId, lifetime.signal);
      if (lifetime.signal.aborted) return;
      setEntries(pendingPreferences(localStorage, ownerId, workspaceId));
      setMessage(result.kind === 'confirmed' ? 'Contact preference confirmed. Review existing tasks and other outreach tools separately.' : 'Saved preference was rejected or changed. Refresh the source conversation before a new review.');
    } catch {
      if (!lifetime.signal.aborted) setMessage('Preference remains unconfirmed. Keep the saved request and retry when connected.');
    } finally { if (!lifetime.signal.aborted) setBusy(null); }
  }
  return <section aria-label="Contact preference recovery" className="space-y-3">
    <Button variant="outline" disabled={busy !== null} onClick={() => {
      try { setEntries(pendingPreferences(localStorage, ownerId, workspaceId)); setMessage(null); }
      catch { setMessage('Saved preferences could not be read. Keep browser recovery data.'); }
    }}>Check saved contact preferences</Button>
    {entries.filter(entry => !visibleSources.some(source => source.recordingId === entry.recordingId && source.conversationId === entry.conversationId)).map(entry => <div key={entry.key} className="space-y-2 rounded border p-3">
      <p className="text-sm">Saved contact preference · conversation {entry.conversationId.slice(0, 8)}</p>
      <p className="text-sm">Recover the confirmed selection from an earlier review, including a hidden recording.</p>
      <Button disabled={busy !== null} onClick={() => void recover(entry)}>{busy === entry.key ? 'Checking…' : 'Recover saved preference'}</Button>
    </div>)}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
