'use client';
import { useEffect, useState } from 'react';
import { useCrmScope } from '@/components/crm-ai/useCrmScope';
import { useWorkspace } from '@/lib/workspace-context';
export function OpenAIConnection() {
  const scope = useCrmScope();
  return scope.userId ? <OpenAIConnectionContent key={scope.key} userId={scope.userId} /> : null;
}
function OpenAIConnectionContent({ userId }: { userId: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const [status, setStatus] = useState<{ connected: boolean; canSave: boolean; configured: boolean }>();
  const [key, setKey] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setKey(''); setStatus(undefined); setNotice('');
    if (currentWorkspaceId) fetch(`/api/crm-ai/connection?workspaceId=${currentWorkspaceId}`, { signal: controller.signal, cache: 'no-store', headers: { 'x-wolfgrid-user-id': userId } }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); setStatus(result); }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [currentWorkspaceId, userId]);
  async function change(method: 'POST' | 'DELETE') {
    if (!currentWorkspaceId) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/crm-ai/connection', { method, headers: { 'Content-Type': 'application/json', 'x-wolfgrid-user-id': userId }, body: JSON.stringify({ workspaceId: currentWorkspaceId, ...(method === 'POST' ? { apiKey: key } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setKey(''); setStatus(previous => previous ? { ...previous, connected: result.connected } : previous);
      setNotice(method === 'POST' ? 'OpenAI key verified and saved. Model access and available credits are checked when you ask a question.' : 'Saved key removed from WolfGrid. This does not revoke the key at OpenAI.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-border p-5">
    <h3 className="font-semibold">OpenAI · CRM assistant</h3>
    <p className="text-sm text-muted-foreground">Connect your personal OpenAI API key for questions, summaries, follow-up suggestions, and reply drafts. API usage is billed separately to your OpenAI account. Your key is private to you in this workspace.</p>
    <p className="text-sm">{status?.connected ? 'Connected' : 'Not connected'}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void change('POST'); }}>
      <label className="flex-1 text-sm">{status?.connected ? 'Replacement API key' : 'OpenAI API key'}<input className="mt-1 block w-full rounded-lg border bg-background p-2" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} disabled={busy || !status?.canSave} /></label>
      <button className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40" disabled={busy || !key.trim() || !status?.canSave}>Verify &amp; save</button>
      {status?.connected && <button type="button" className="rounded-lg border px-4 py-2 text-sm" disabled={busy} onClick={() => void change('DELETE')}>Disconnect</button>}
    </form>
    {status && !status.canSave && <p className="text-sm text-muted-foreground">Secure key storage is awaiting setup.</p>}
    {status && !status.configured && <p className="text-sm text-muted-foreground">The assistant model is awaiting setup.</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
