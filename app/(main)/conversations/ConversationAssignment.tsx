'use client';
import type { ConversationTarget } from '@/lib/field-recordings/targets';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReviewConversation } from './ConversationReview';

export default function ConversationAssignment({ recordingId, conversation, targets, onSaved }: {
  recordingId: string; conversation: ReviewConversation; targets: ConversationTarget[]; onSaved: (value: ReviewConversation) => void;
}) {
  const [target, setTarget] = useState(conversation.target_id && targets.some(option => option.id === conversation.target_id) ? conversation.target_id : '');
  const [consent, setConsent] = useState(conversation.consent ?? 'unknown');
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/field-recordings/${recordingId}/conversations/${conversation.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'confirm_assignment', version: conversation.version, targetId: target || null, consent, permissionConfirmed: permission }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Unable to update assignment');
      onSaved(value.conversation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update assignment'); }
    finally { setBusy(false); }
  }
  if (conversation.review_state !== 'pending') return null;
  return <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Review door assignment and permission</summary><div className="mt-3 space-y-3">
    <label className="block text-sm">Session target<select disabled={busy} value={target} onChange={event => setTarget(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2"><option value="">Unassigned</option>{targets.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">Addresses come from this campaign session. Buildings with multiple addresses need household review. Leave unassigned if you cannot verify the door.</p>
    <label className="block text-sm">Recording permission<select disabled={busy} value={consent} onChange={event => { setConsent(event.target.value); setPermission(false); }} className="mt-1 block w-full rounded border bg-background p-2"><option value="unknown">Unknown</option><option value="granted">Granted</option><option value="declined">Declined</option></select></label>
    {consent === 'granted' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={permission} disabled={busy} onChange={event => setPermission(event.target.checked)} />I confirm the person in this conversation agreed to recording.</label>}
    <p className="text-sm text-muted-foreground">Updating clears the current AI analysis and draft, including draft edits, and queues a new analysis when permission is granted.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <Button variant="outline" disabled={busy || (consent === 'granted' && !permission)} onClick={() => void save()}>{busy ? 'Updating…' : 'Update assignment and permission'}</Button>
  </div></details>;
}
