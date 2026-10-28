'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { macApi } from '@/lib/mac-companion/client';
import { useCrmScope } from './useCrmScope';
import { ContactAiActions } from './CrmAssistant';
type Message = { id: string; direction: string; body: string | null; body_status: string; service: string | null; sent_at: string | null; has_attachments: boolean };
export function PrivateMessages({ contactId, framed = true }: { contactId: string; framed?: boolean }) {
  const scope = useCrmScope();
  return scope.userId ? <PrivateMessagesContent key={`${scope.key}:${contactId}`} contactId={contactId} userId={scope.userId} framed={framed} /> : null;
}
function PrivateMessagesContent({ contactId, framed, userId }: { contactId: string; framed: boolean; userId: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]), [more, setMore] = useState(false), [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState(''), [lastSync, setLastSync] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [anchor, setAnchor] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden && offset === 0 && !anchor) setRefresh(value => value + 1); }, 10000); return () => clearInterval(timer); }, [offset, anchor]);
  useEffect(() => {
    const read = () => { const value = window.location.hash.replace('#mac-message-',''); setAnchor(/^[a-f0-9-]{36}$/.test(value) ? value : ''); setOffset(0); };
    read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read);
  }, [contactId]);
  useEffect(() => {
    const controller = new AbortController(); setMessages([]); setNotice(''); setOffset(0); setLastSync(null); setMore(false);
    return () => controller.abort();
  }, [currentWorkspaceId, contactId]);
  useEffect(() => {
    if (!currentWorkspaceId) return;
    const controller = new AbortController(); setLoading(true);
    const params = new URLSearchParams({ workspaceId: currentWorkspaceId, contactId, offset: String(offset), ...(anchor ? { messageId: anchor } : {}) });
    macApi<{ messages: Message[]; more: boolean; lastSyncAt: string | null }>(`?${params}`, undefined, controller.signal, userId).then(result => {
      setMessages(previous => offset ? [...previous, ...result.messages] : result.messages); setMore(result.more); setLastSync(result.lastSyncAt);
      if (anchor) requestAnimationFrame(() => document.getElementById(`mac-message-${anchor}`)?.scrollIntoView({ block: 'center' }));
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentWorkspaceId, contactId, offset, anchor, refresh, userId]);
  return <section className={framed ? "space-y-4 rounded-2xl border bg-card p-5" : "space-y-4"} aria-label="Private Messages">
    {framed && <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-semibold">Private Messages</h2><Link href={`/messages?contactId=${contactId}`} className="text-xs underline">Open private inbox</Link><Link href="/settings/integrations/apple#messages" className="text-xs underline">Sync settings</Link></div>}
    <p className="text-xs text-muted-foreground">Visible only to you. {lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}.` : 'No sync recorded yet.'}</p>
    {framed && <ContactAiActions contactId={contactId} />}
    {anchor && <button className="text-xs underline" onClick={() => { setAnchor(''); window.history.replaceState(null,'',window.location.pathname); }}>Show latest messages</button>}
    {messages.map(message => <article key={message.id} id={`mac-message-${message.id}`} className={`max-w-[90%] scroll-mt-24 rounded-2xl px-4 py-3 sm:max-w-[78%] ${message.direction === 'outgoing' ? 'ml-auto rounded-br-md bg-[#e10019] text-white' : 'rounded-bl-md border border-border/50 bg-card'}`}><p className={`mb-2 text-[10px] ${message.direction === 'outgoing' ? 'text-white/70' : 'text-muted-foreground'}`}>{message.direction === 'outgoing' ? 'You' : 'Contact'} · {message.sent_at ? new Date(message.sent_at).toLocaleString() : 'Unknown date'} · {message.service || 'Apple Messages'}</p><p className="whitespace-pre-wrap break-words text-sm">{message.body || (message.body_status === 'unsupported' ? 'This message format could not be read.' : 'No text content')}</p>{message.has_attachments && <p className="mt-2 text-xs text-muted-foreground">Attachment remains in Apple Messages.</p>}</article>)}
    {loading && <p className="text-sm" role="status">Loading private history…</p>}{!loading && !notice && !messages.length && <p className="text-sm text-muted-foreground">No imported messages. Enable sync in Mac settings to bring in available conversations.</p>}
    {more && <button className="rounded border px-3 py-2 text-sm" disabled={loading} onClick={() => setOffset(messages.length)}>Load older messages</button>}
    {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
  </section>;
}
