'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { checkedRetention } from '@/lib/field-recordings/retention';
import { Button } from '@/components/ui/button';

export function RecordingRetention({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const db = createClient();
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => { revision++; if (active) setOwner(session?.user.id ?? null); });
    const initial = revision;
    void db.auth.getSession().then(({ data }) => { if (active && revision === initial) setOwner(data.session?.user.id ?? null); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return owner ? <RetentionForm key={`${owner}:${workspaceId}`} workspaceId={workspaceId} enabled={enabled} /> : null;
}
function RetentionForm({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const [settings, setSettings] = useState<ReturnType<typeof checkedRetention> | null>(null);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const url = `/api/integrations/plaud/retention?workspaceId=${encodeURIComponent(workspaceId)}`;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setSettings(null); setBusy(true); setMessage('');
    void fetch(url, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error('Retention settings unavailable.');
      return checkedRetention(data);
    }).then(value => { if (!controller.signal.aborted) { setSettings(value); setDays(value.retentionDays?.toString() ?? ''); } })
      .catch(() => { if (!controller.signal.aborted) setMessage('Retention settings unavailable. Refresh to try again.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [url, refresh]);
  async function save(retentionDays: number | null) {
    const controller = lifetime.current;
    if (!settings || !controller || controller.signal.aborted || busy) return;
    let payload;
    try { payload = checkedRetention({ retentionDays, version: settings.version }); }
    catch { setMessage('Enter a whole number from 1 to 3650 days.'); return; }
    if (retentionDays !== null && !window.confirm(`Automatically expire your existing and future stopped recordings ${retentionDays} days after they end? WolfGrid audio and transcripts enter the deletion queue. Approved CRM records remain. Phone, pin, provider and backup copies require separate cleanup.`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'PUT', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'Settings changed or retention is paused. Refresh before saving again.' : 'Unable to save retention settings.');
      const next = checkedRetention(data);
      if (!controller.signal.aborted) { setSettings(next); setDays(next.retentionDays?.toString() ?? ''); setMessage('Retention settings saved.'); }
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Unable to save retention settings.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="space-y-2 rounded border p-3">
    <p className="text-sm font-medium">Automatic recording retention</p>
    <p className="text-sm">{settings ? settings.retentionDays === null ? 'Disabled for your recordings in this workspace.' : `Your stopped recordings expire after ${settings.retentionDays} days.` : busy ? 'Loading retention settings…' : 'Retention settings unavailable.'}</p>
    {!enabled && <p className="text-sm">Automatic expiry is paused by the server. You can still disable your policy.</p>}
    <label className="block text-sm">Days after recording ends<input type="number" min="1" max="3650" step="1" value={days} onChange={event => setDays(event.target.value)} disabled={busy || !settings || !enabled} className="ml-2 w-24 rounded border p-1" /></label>
    <p className="text-xs text-muted-foreground">Applies to existing recordings too. Disabling stops future expiry; it cannot restore recordings already queued for deletion. Approved CRM notes and follow-ups remain. Other copies require separate cleanup.</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !settings || !enabled || days.trim() === ''} onClick={() => void save(Number(days))}>Save duration</Button><Button variant="outline" disabled={busy || !settings || settings.retentionDays === null} onClick={() => void save(null)}>Disable expiry</Button><Button variant="outline" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh retention</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
