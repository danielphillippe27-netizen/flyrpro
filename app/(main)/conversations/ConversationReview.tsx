'use client';

import { useState } from 'react';
import { actionDateInput, localActionDate } from '@/lib/field-recordings/application';
import { Button } from '@/components/ui/button';
import type { z } from 'zod';
import type { writingSchema } from '@/lib/field-recordings/writing';

type Writing = z.infer<typeof writingSchema>;
export type ReviewConversation = {
  target_id?: string | null; consent?: string; target_confirmed?: boolean;
  id: string; version: number; summary: string | null; note: string | null;
  review_state: string; evidence: Writing['evidence'] | null;
  action_proposals: Writing['actions'] | null;
};

export default function ConversationReview({ recordingId, conversation, segments, onSaved, onDirtyChange }: {
  segments: { id: string; text: string; startMs: number; speaker: string | null }[];
  onDirtyChange?: (dirty: boolean) => void;
  recordingId: string; conversation: ReviewConversation; onSaved: (conversation: ReviewConversation) => void;
}) {
  const [summary, setSummary] = useState(conversation.summary ?? '');
  const [note, setNote] = useState(conversation.note ?? '');
  const [evidence, setEvidence] = useState(conversation.evidence ?? []);
  const [sourceId, setSourceId] = useState('');
  const [quote, setQuote] = useState('');
  const [newKind, setNewKind] = useState<Writing['actions'][number]['kind']>('call');
  const [newTitle, setNewTitle] = useState('');
  const source = segments.find(segment => segment.id === sourceId);
  const validQuote = !!quote.trim() && quote.length <= 2000 && !!source?.text.includes(quote);
  function changed() { setSaved(false); onDirtyChange?.(true); }
  const [actions, setActions] = useState(() => (conversation.action_proposals ?? []).map((action, index) => ({ ...action, key: index, dateInput: actionDateInput(action.dueAt) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(operation: 'save_draft' | 'reject') {
    if (busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const response = await fetch(`/api/field-recordings/${recordingId}/conversations/${conversation.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: conversation.version, operation,
          ...(operation === 'save_draft' ? { writing: { summary, note, evidence, actions: actions.map(action => ({ kind: action.kind, title: action.title, evidence: action.evidence, dueAt: action.dateInput ? localActionDate(action.dateInput) : null })) } } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save review');
      onDirtyChange?.(false); onSaved(result.conversation); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save review'); }
    finally { setBusy(false); }
  }
  if (conversation.review_state !== 'pending') return <div className="space-y-2"><p>{conversation.summary}</p><p className="whitespace-pre-wrap">{conversation.note}</p></div>;
  return <div className="space-y-3">
    <label className="block text-sm font-medium">Summary<textarea value={summary} maxLength={2000} disabled={busy} onChange={event => { setSummary(event.target.value); setSaved(false); onDirtyChange?.(true); }} className="mt-1 block min-h-20 w-full rounded-md border bg-background p-2" /></label>
    <label className="block text-sm font-medium">Conversation note<textarea value={note} maxLength={4000} disabled={busy} onChange={event => { setNote(event.target.value); setSaved(false); onDirtyChange?.(true); }} className="mt-1 block min-h-28 w-full rounded-md border bg-background p-2" /></label>
    <details className="space-y-2 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Review note evidence or add a follow-up</summary>
      {evidence.map((citation, index) => <div key={index} className="mt-2 space-y-1"><blockquote className="border-l-2 pl-3 text-sm">{citation.quote}</blockquote><Button type="button" variant="outline" disabled={busy} onClick={() => { setEvidence(current => current.filter((_, item) => item !== index)); changed(); }}>Remove note evidence</Button></div>)}
      <label className="block text-sm">Transcript source<select disabled={busy} className="mt-1 block w-full rounded border bg-background p-2" value={sourceId} onChange={event => { setSourceId(event.target.value); setQuote(''); }}><option value="">Choose a transcript segment</option>{segments.map(segment => <option key={segment.id} value={segment.id}>{Math.floor(segment.startMs / 1000)}s · {segment.speaker ?? 'Unknown speaker'} · {segment.text.slice(0, 100)}</option>)}</select></label>
      {source && <p className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">{source.text}</p>}
      <label className="block text-sm">Exact supporting quote<textarea disabled={busy || !source} maxLength={2000} className="mt-1 block w-full rounded border bg-background p-2" value={quote} onChange={event => setQuote(event.target.value)} /></label>
      {!!quote && !validQuote && <p role="alert" className="text-sm text-red-600">Use an exact quote from the selected transcript segment.</p>}
      <Button type="button" variant="outline" disabled={busy || !validQuote || evidence.length >= 50} onClick={() => { setEvidence(current => current.some(value => value.segmentId === sourceId && value.quote === quote) ? current : [...current, { segmentId: sourceId, quote }]); changed(); }}>Add quote to note evidence</Button>
      <label className="block text-sm">New follow-up type<select disabled={busy} value={newKind} className="mt-1 block rounded border bg-background p-2" onChange={event => setNewKind(event.target.value as typeof newKind)}>{(['call', 'text', 'email', 'visit', 'send_cma', 'appointment', 'do_not_contact'] as const).map(kind => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="block text-sm">New follow-up title<input disabled={busy} maxLength={200} className="mt-1 block w-full rounded border bg-background p-2" value={newTitle} onChange={event => setNewTitle(event.target.value)} /></label>
      <Button type="button" variant="outline" disabled={busy || !validQuote || !newTitle.trim() || actions.length >= 20} onClick={() => {
        setActions(current => [...current, { key: Math.max(-1, ...current.map(value => value.key)) + 1, kind: newKind, title: newTitle.trim(), dueAt: null, dateInput: '', evidence: [{ segmentId: sourceId, quote }] }]); setNewTitle(''); changed();
      }}>Add evidence-backed proposal</Button>
      <p className="text-xs text-muted-foreground">Adding a proposal keeps it as a draft. Check that the quote supports the requested action. Contact preferences require separate review.</p>
    </details>
    {!!actions.length && <div className="space-y-3"><p className="text-sm font-medium">Suggested follow-ups</p>{actions.map((action) => <fieldset key={action.key} disabled={busy} className="space-y-2 rounded border p-3">
      <legend className="px-1 text-sm">{action.kind.replaceAll('_', ' ')}</legend>
      <label className="block text-sm">Follow-up title<input className="mt-1 block w-full rounded border bg-background p-2" value={action.title} maxLength={200} onChange={event => {
        setActions(current => current.map(value => value.key === action.key ? { ...value, title: event.target.value } : value)); setSaved(false); onDirtyChange?.(true);
      }} /></label>
      <label className="block text-sm">Suggested date and time<input type="datetime-local" className="mt-1 block rounded border bg-background p-2" value={action.dateInput} onChange={event => {
        setActions(current => current.map(value => value.key === action.key ? { ...value, dateInput: event.target.value } : value)); setSaved(false); onDirtyChange?.(true);
      }} /></label>
      <p className="text-xs text-muted-foreground">Leave the date empty if timing needs review. Confirm a date before applying this action.</p>
      <details><summary className="cursor-pointer text-sm">Transcript evidence</summary>{action.evidence.map((citation, index) => <blockquote key={index} className="mt-2 border-l-2 pl-3 text-sm">{citation.quote}</blockquote>)}</details>
      <Button type="button" variant="outline" onClick={() => { setActions(current => current.filter(value => value.key !== action.key)); setSaved(false); onDirtyChange?.(true); }}>Remove proposal</Button>
    </fieldset>)}<p className="text-xs text-muted-foreground">Dates use your browser timezone. Source evidence is preserved when saving edits.</p></div>}
    <p className="text-sm text-muted-foreground">Check edits against the transcript. Saving keeps this as a draft.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {saved && <p role="status" className="text-sm">Draft saved.</p>}
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit('save_draft')}>{busy ? 'Saving…' : 'Save draft'}</Button><Button variant="outline" disabled={busy} onClick={() => void submit('reject')}>Reject conversation</Button></div>
  </div>;
}
