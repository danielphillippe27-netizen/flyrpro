'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { restructureRequestSchema } from '@/lib/field-recordings/restructure';
import type { ReviewConversation } from './ConversationReview';
import type { TranscriptSegment } from '@/lib/field-recordings/contracts';
type Conversation = ReviewConversation & { chunk_id: string | null; segments: TranscriptSegment[] };
const envelope = z.object({ requestId: z.uuid(), change: restructureRequestSchema }).strict();
type Saved = z.infer<typeof envelope>;
export default function ConversationMerge({ ownerId, workspaceId, recordingId, conversations, dirty, onMerged, onLocked }: {
  ownerId: string; workspaceId: string; recordingId: string; conversations: Conversation[]; dirty: boolean;
  onMerged: (result: { conversations: Conversation[]; supersededIds: string[]; history?: Conversation[] }) => void;
  onLocked: (locked: boolean) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const key = useRef('');
  useEffect(() => { onLocked(busy || saved !== null); return () => onLocked(false); }, [busy, saved, onLocked]);
  useEffect(() => {
    generation.current++;
    const scopeGeneration = generation.current;
    setReady(false); setBusy(false); setSaved(null); setChosen([]); setError(null);
    try {
      key.current = `wolfgrid:conversation-merge:v1:${[ownerId, workspaceId, recordingId].map(id => z.uuid().parse(id).toLowerCase()).join(':')}`;
      const raw = localStorage.getItem(key.current);
      if (raw) {
        const stored = envelope.parse(JSON.parse(raw));
        if (stored.change.operation !== 'merge') throw new Error('Saved operation changed');
        setSaved(stored); setChosen(stored.change.conversations.map(item => item.id));
      }
      setReady(true);
    } catch { setError('Saved merge could not be read. Reopen recording review before continuing.'); }
    return () => { generation.current = scopeGeneration + 1; };
  }, [ownerId, workspaceId, recordingId]);
  const candidates = conversations.filter(item => item.review_state === 'pending' && item.chunk_id);
  const selected = candidates.filter(item => chosen.includes(item.id));
  const sameFile = selected.length >= 2 && selected.length === chosen.length && selected.every(item => item.chunk_id === selected[0].chunk_id);
  async function merge() {
    if (!ready || busy || (!saved && (dirty || !sameFile))) return;
    if (!saved && !window.confirm('Merge these conversations? The merged conversation needs fresh address and recording-permission review. Original notes and AI results remain in history.')) return;
    const requestGeneration = generation.current;
    const requestKey = key.current;
    setBusy(true); setError(null);
    let payload = saved;
    try {
      payload ??= { requestId: crypto.randomUUID(), change: { operation: 'merge', conversations: selected.map(item => ({ id: item.id, version: item.version })) } };
      payload = envelope.parse(payload);
      const prior = localStorage.getItem(requestKey);
      if (prior && JSON.stringify(envelope.parse(JSON.parse(prior))) !== JSON.stringify(payload)) throw new Error('Another merge needs recovery. Reopen recording review.');
      localStorage.setItem(requestKey, JSON.stringify(payload)); setSaved(payload);
      const response = await fetch(`/api/field-recordings/${recordingId}/restructure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (generation.current !== requestGeneration) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) { localStorage.removeItem(requestKey); setSaved(null); }
        throw new Error(result.error || 'Merge could not be confirmed');
      }
      if (payload.change.operation !== 'merge') throw new Error('Saved operation changed');
      const sources = payload.change.conversations.map(item => item.id);
      const child = result.conversations?.[0];
      if (!Array.isArray(result.conversations) || result.conversations.length !== 1 || !z.uuid().safeParse(child?.id).success || sources.includes(child.id) || child.recording_id !== recordingId || !Array.isArray(child.parent_conversation_ids) || sources.some(id => !child.parent_conversation_ids.includes(id)) || !Array.isArray(result.supersededIds) || result.supersededIds.length !== sources.length || new Set(result.supersededIds).size !== sources.length || sources.some(id => !result.supersededIds.includes(id))) throw new Error('Merge result needs reconciliation');
      localStorage.removeItem(requestKey); setSaved(null); setChosen([]); onMerged(result);
    } catch (cause) { if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : 'Merge could not be confirmed'); }
    finally { if (generation.current === requestGeneration) setBusy(false); }
  }
  if (candidates.length < 2 && !saved) return null;
  return <details className="space-y-2 rounded border p-3"><summary className="cursor-pointer font-medium">Merge conversations</summary>
    <p className="text-sm">Choose conversations from the same recording file. The merged conversation requires fresh address and permission review; original notes remain in history.</p>
    {candidates.map(item => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={chosen.includes(item.id)} disabled={!ready || busy || saved !== null || dirty} onChange={event => setChosen(current => event.target.checked ? [...current, item.id].slice(0, 20) : current.filter(id => id !== item.id))} /><span>{item.summary || item.segments[0]?.text.slice(0, 100) || 'Conversation'}</span></label>)}
    {dirty && !saved && <p className="text-sm">Save draft edits before merging.</p>}
    {chosen.length >= 2 && !sameFile && !saved && <p className="text-sm">Choose conversations from one recording file.</p>}
    {saved && <p role="status" className="text-sm">A saved merge needs confirmation. Retry sends the same request.</p>}
    <Button variant="outline" disabled={!ready || busy || (!saved && (dirty || !sameFile))} onClick={() => void merge()}>{busy ? 'Merging…' : saved ? 'Retry saved merge' : 'Merge selected conversations'}</Button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </details>;
}
