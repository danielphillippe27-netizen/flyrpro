'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { restructureRequestSchema } from '@/lib/field-recordings/restructure';
import type { TranscriptSegment } from '@/lib/field-recordings/contracts';
import type { ReviewConversation } from './ConversationReview';

type Conversation = ReviewConversation & { segments: TranscriptSegment[] };
const savedSchema = z.object({ requestId: z.uuid(), change: restructureRequestSchema }).strict();
type Saved = z.infer<typeof savedSchema>;
export default function ConversationSplit({ ownerId, workspaceId, recordingId, conversation, dirty, onSplit }: {
  ownerId: string; workspaceId: string; recordingId: string; conversation: Conversation; dirty: boolean;
  onSplit: (result: { conversations: Conversation[]; supersededIds: string[]; history?: Conversation[] }) => void;
}) {
  const [boundary, setBoundary] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<Saved | null>(null);
  const key = useRef<string | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    active.current = true; saved.current = null; key.current = null; setReady(false); setRetrying(false); setBusy(false); setBoundary(''); setError(null);
    try {
      const scope = [ownerId, workspaceId, recordingId, conversation.id].map(value => z.uuid().parse(value).toLowerCase());
      key.current = `wolfgrid:conversation-split:v1:${scope.join(':')}`;
      const raw = localStorage.getItem(key.current);
      if (raw) {
        const value = savedSchema.parse(JSON.parse(raw));
        if (value.change.operation !== 'split' || value.change.conversationId !== conversation.id) throw new Error('Saved split identity changed');
        saved.current = value; setBoundary(value.change.beforeSegmentId); setRetrying(true);
      }
      setReady(true);
    } catch { setError('Saved split state could not be read. Reopen the review before splitting.'); }
    return () => { active.current = false; generation.current += 1; };
  }, [ownerId, workspaceId, recordingId, conversation.id]);
  async function split() {
    if (busy || !ready || !key.current || (!saved.current && (!boundary || dirty))) return;
    if (!saved.current && !window.confirm('Split this conversation? Both parts will need fresh address and recording-permission confirmation. Existing notes and AI results stay in the original history.')) return;
    setBusy(true); setError(null);
    const requestGeneration = generation.current;
    const requestKey = key.current;
    const stillCurrent = () => active.current && generation.current === requestGeneration;
    let persisted = false;
    try {
      if (!saved.current) saved.current = { requestId: crypto.randomUUID(), change: { operation: 'split', conversationId: conversation.id, version: conversation.version, beforeSegmentId: boundary } };
      const payload = savedSchema.parse(saved.current);
      const previous = localStorage.getItem(requestKey);
      if (previous && JSON.stringify(savedSchema.parse(JSON.parse(previous))) !== JSON.stringify(payload)) throw new Error('Another saved split needs recovery. Reopen this review before continuing.');
      localStorage.setItem(requestKey, JSON.stringify(payload)); persisted = true;
      const response = await fetch(`/api/field-recordings/${recordingId}/restructure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const value = await response.json();
      if (!stillCurrent()) return;
      if (!response.ok) {
        if (response.status < 500) { localStorage.removeItem(requestKey); saved.current = null; setRetrying(false); }
        throw new Error(value.error || 'Split could not be confirmed');
      }
      if (!Array.isArray(value.conversations) || value.conversations.length !== 2 || new Set(value.conversations.map((child: { id?: string }) => child.id)).size !== 2 || !Array.isArray(value.supersededIds) || value.supersededIds.length !== 1 || value.supersededIds[0] !== conversation.id || value.conversations.some((child: { id?: string; recording_id?: string; parent_conversation_ids?: string[] }) => !z.uuid().safeParse(child.id).success || child.id === conversation.id || child.recording_id !== recordingId || !Array.isArray(child.parent_conversation_ids) || !child.parent_conversation_ids.includes(conversation.id))) throw new Error('Split result needs reconciliation');
      localStorage.removeItem(requestKey); saved.current = null; setRetrying(false); onSplit(value);
    } catch (cause) {
      if (!stillCurrent()) return;
      if (!persisted) saved.current = null;
      setRetrying(saved.current !== null); setError(cause instanceof Error ? cause.message : 'Split could not be confirmed');
    } finally { if (stillCurrent()) setBusy(false); }
  }
  if (conversation.review_state !== 'pending' || conversation.segments.length < 2) return null;
  return <details className="space-y-2 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Split conversation</summary>
    <p className="text-sm text-muted-foreground">Split between transcript segments when this recording contains separate conversations. Both parts require fresh address and permission review; existing notes and AI results remain in the original history.</p>
    {dirty && !retrying && <p className="text-sm">Save draft edits before splitting.</p>}
    <label className="block text-sm">Start the second conversation at<select className="mt-1 block w-full rounded border bg-background p-2" disabled={busy || retrying || !ready || dirty} value={boundary} onChange={event => setBoundary(event.target.value)}><option value="">Choose transcript boundary</option>{conversation.segments.slice(1).map(segment => <option key={segment.id} value={segment.id}>{Math.floor(segment.startMs / 1000)}s · {segment.text.slice(0, 120)}</option>)}</select></label>
    {retrying && <p role="status" className="text-sm">The result is uncertain. Retry the same split to recover its two conversations.</p>}
    <Button variant="outline" disabled={busy || !ready || (!retrying && (!boundary || dirty))} onClick={() => void split()}>{busy ? 'Splitting…' : retrying ? 'Retry saved split' : 'Split into two conversations'}</Button>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </details>;
}
