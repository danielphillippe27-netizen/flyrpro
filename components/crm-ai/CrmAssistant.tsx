'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace-context';
import { useCrmScope } from './useCrmScope';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
type Mode = 'question' | 'summarize' | 'follow-up' | 'draft';
type OpenDetail = { contactId?: string; mode?: Mode };
type Answer = { answer: string; draft: string | null; sources: { id: string; label: string; href: string; excerpt: string }[]; coverage: string; messagesIncluded: boolean; consentRevision?: number };
const prompts: Record<Mode,string> = { question: '', summarize: 'Summarize my relationship and recent conversations with this contact.', 'follow-up': 'What should I follow up on with this contact, and why?', draft: 'Draft a concise, natural reply based on our most recent conversation. Do not invent facts or commitments.' };
export function openCrmAssistant(detail: OpenDetail = {}) { window.dispatchEvent(new CustomEvent('wolfgrid-crm-ai-open', { detail })); }
export function CrmAssistant() {
  const scope = useCrmScope();
  return scope.userId ? <CrmAssistantContent key={scope.key} userId={scope.userId} /> : null;
}
function CrmAssistantContent({ userId }: { userId: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const pathname = usePathname();
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(''), [mode, setMode] = useState<Mode>('question');
  const [contactId, setContactId] = useState<string>(), [result, setResult] = useState<Answer>(), [draft, setDraft] = useState('');
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [after, setAfter] = useState(''), [before, setBefore] = useState('');
  const [historyScope, setHistoryScope] = useState(''); const [historyRevision, setHistoryRevision] = useState<number>();
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    const current = epoch; const abort = controller;
    const reset = () => { current.current++; abort.current?.abort(); setResult(undefined); setDraft(''); setQuestion(''); setHistory([]); setNotice(''); setOpen(false); setBusy(false); setContactId(undefined); };
    reset();
    const api = createClient(); let owner: string | undefined;
    void api.auth.getSession().then(({ data }) => { owner = data.session?.user.id; });
    const { data } = api.auth.onAuthStateChange((_event, session) => { const next = session?.user.id; if (next !== owner) { owner = next; reset(); } });
    return () => { current.current++; abort.current?.abort(); data.subscription.unsubscribe(); };
  }, [currentWorkspaceId]);
  useEffect(() => {
    const listener = (event: Event) => {
      epoch.current++; controller.current?.abort(); setBusy(false); setResult(undefined); setDraft(''); setHistory([]); setNotice('');
      const detail = (event as CustomEvent<OpenDetail>).detail ?? {};
      setContactId(detail.contactId); setMode(detail.mode ?? 'question'); setQuestion(prompts[detail.mode ?? 'question']); setOpen(true);
    };
    window.addEventListener('wolfgrid-crm-ai-open', listener);
    return () => window.removeEventListener('wolfgrid-crm-ai-open', listener);
  }, []);
  async function ask() {
    if (!currentWorkspaceId || !question.trim()) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const started = ++epoch.current; setBusy(true); setNotice(''); setResult(undefined);
    try {
      const response = await fetch('/api/crm-ai', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json', 'x-wolfgrid-user-id': userId }, body: JSON.stringify({ workspaceId: currentWorkspaceId, contactId, mode, question, history: historyScope === (contactId ?? 'workspace') ? history : [], ...(historyRevision === undefined ? {} : { historyRevision }), ...(after ? { after: new Date(`${after}T00:00:00`).toISOString() } : {}), ...(before ? { before: new Date(`${before}T23:59:59.999`).toISOString() } : {}) }) });
      const answer = await response.json(); if (!response.ok) throw new Error(answer.error || 'The assistant is unavailable.');
      if (epoch.current !== started) return;
      setResult(answer); setDraft(answer.draft ?? ''); setHistoryScope(contactId ?? 'workspace'); setHistoryRevision(answer.consentRevision);
      setHistory(previous => [...(historyScope === (contactId ?? 'workspace') ? previous : []), { role: 'user' as const, content: question.slice(0,2000) }, { role: 'assistant' as const, content: answer.answer.slice(0,2000) }].slice(-6));
    } catch (error) { if (epoch.current === started && !request.signal.aborted) setNotice((error as Error).message); }
    finally { if (epoch.current === started) setBusy(false); }
  }
  function close(value: boolean) { setOpen(value); if (!value) { epoch.current++; controller.current?.abort(); setBusy(false); } }
  return <>
    <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>WolfGrid CRM assistant</DialogTitle><DialogDescription>Answers and editable drafts from your records. API usage is billed to your OpenAI account.</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">{contactId ? 'Working with this contact.' : 'Working with your contacts in the current workspace.'} Message access follows your <Link href="/settings/mac" className="underline" onClick={() => close(false)}>Mac privacy settings</Link>.</p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void ask(); }}>
        <label className="block text-sm">Question or drafting instruction<textarea className="mt-1 min-h-24 w-full rounded-lg border bg-background p-3" value={question} maxLength={1200} onChange={event => setQuestion(event.target.value)} disabled={busy} /></label>
        <div className="flex flex-wrap gap-3"><label className="text-sm">From<input aria-label="Messages from date" type="date" className="ml-2 rounded border bg-background p-2" value={after} onChange={event => setAfter(event.target.value)} /></label><label className="text-sm">Through<input aria-label="Messages through date" type="date" className="ml-2 rounded border bg-background p-2" value={before} onChange={event => setBefore(event.target.value)} /></label></div>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40" disabled={busy || !question.trim() || !currentWorkspaceId}>{busy ? 'Thinking…' : 'Ask'}</button>
        <Link href="/settings/mac#openai" className="ml-3 text-sm underline" onClick={() => close(false)}>OpenAI connection</Link>
      </form>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {result && <div className="space-y-4"><p className="whitespace-pre-wrap break-words text-sm">{result.answer}</p><p className="text-xs text-muted-foreground">{result.coverage} {result.messagesIncluded ? 'Synced message context was allowed.' : 'Synced messages were excluded.'}</p>
        {result.draft !== null && <div className="space-y-2"><label className="block text-sm">Editable reply draft<textarea className="mt-1 min-h-28 w-full rounded-lg border bg-background p-3" value={draft} onChange={event => setDraft(event.target.value)} /></label><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void navigator.clipboard.writeText(draft).then(() => setNotice('Draft copied. Review it before sending.')).catch(() => setNotice('Select the draft text to copy it.'))}>Copy draft</button>{pathname === '/messages' && contactId && <button className="ml-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => { window.dispatchEvent(new CustomEvent('wolfgrid-crm-draft', { detail: { contactId, draft } })); close(false); }}>Use in conversation</button>}</div>}
        {result.sources.length > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold">Sources</h3>{result.sources.map(source => <div key={source.id} className="rounded-lg border p-3"><Link className="text-sm underline" href={source.href} onClick={() => close(false)}>{source.label}</Link><p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{source.excerpt}</p></div>)}</div>}
      </div>}
    </DialogContent></Dialog>
  </>;
}
export function ContactAiActions({ contactId }: { contactId: string }) {
  return <div className="flex flex-wrap gap-2">{(['summarize','follow-up','draft'] as const).map(mode => <button key={mode} className="rounded-lg border px-3 py-2 text-xs" onClick={() => openCrmAssistant({ contactId, mode })}>{mode === 'summarize' ? 'Summarize' : mode === 'follow-up' ? 'Suggest follow-up' : 'Draft reply'}</button>)}</div>;
}
