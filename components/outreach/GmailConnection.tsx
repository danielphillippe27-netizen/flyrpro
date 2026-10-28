'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getClientAsync } from '@/lib/supabase/client';
export async function outreachRequest(path: string, init?: RequestInit) {
  const { data } = await (await getClientAsync()).auth.getSession();
  const headers = new Headers(init?.headers);
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}
export function GmailConnection({ onConnected }: { onConnected?: (email: string | null) => void }) {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await outreachRequest('/api/outreach/gmail');
      setEmail(data.email); setReady(data.configured); onConnected?.(data.email);
      if (!data.configured) setError('Gmail connections are awaiting setup by WolfGrid.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load Gmail.'); }
    finally { setBusy(false); }
  }, [onConnected]);
  useEffect(() => { void load(); }, [load]);
  async function connect() {
    setBusy(true); setError('');
    try { const data = await outreachRequest('/api/outreach/gmail/connect', { method: 'POST' }); window.location.assign(data.url); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect.'); setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError('');
    try { await outreachRequest('/api/outreach/gmail', { method: 'DELETE' }); setEmail(null); onConnected?.(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to disconnect.'); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-border p-4 space-y-3">
    <div><h3 className="font-semibold">Your Gmail</h3><p className="text-sm text-muted-foreground">{email || 'Connect your own Google account to send campaign emails. We request sending access, not inbox access.'}</p></div>
    <Button variant="outline" size="sm" disabled={busy || !ready} onClick={() => void (email ? disconnect() : connect())}>{busy ? 'Loading…' : email ? 'Disconnect Gmail' : 'Connect Gmail'}</Button>
    {error && <p role="status" className="text-sm text-muted-foreground">{error}</p>}
  </div>;
}
