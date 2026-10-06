'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { checkedPreferenceReceipt, clearPreference, persistPreference, preferenceStorageKey, restorePreference, type PreferencePayload } from '@/lib/field-recordings/contact-preference';
import type { ReviewConversation } from './ConversationReview';

type Household = { addressId: string; label: string; contacts: { id: string; name: string }[] };
export default function ConversationContactPreference({ ownerId, workspaceId, recordingId, conversation, segments, dirty, onSaved, onLocked }: {
  ownerId: string; workspaceId: string; recordingId: string; conversation: ReviewConversation; segments: { id: string; text: string }[]; dirty: boolean;
  onSaved: (version: number) => void; onLocked: (id: string, locked: boolean) => void;
}) {
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [address, setAddress] = useState(''), [contact, setContact] = useState('');
  const [saved, setSaved] = useState<PreferencePayload | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scope = useRef<AbortController | null>(null), key = useRef('');
  const endpoint = `/api/field-recordings/${recordingId}/conversations/${conversation.id}/contact-preference?workspaceId=${encodeURIComponent(workspaceId)}`;
  const household = households?.find(item => item.addressId === address);
  const proposals = (conversation.action_proposals ?? []).map((proposal, index) => ({ proposal, index })).filter(item => item.proposal.kind === 'do_not_contact');
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    setReady(false); setSaved(null); setHouseholds(null); setAddress(''); setContact(''); setMessage(null); setBusy(false);
    try { key.current = preferenceStorageKey(ownerId, workspaceId, recordingId, conversation.id); setSaved(restorePreference(localStorage, key.current)); setReady(true); }
    catch { setMessage('Saved preference could not be read. Keep browser recovery data and reopen this review.'); }
    return () => controller.abort();
  }, [ownerId, workspaceId, recordingId, conversation.id]);
  useEffect(() => { onLocked(conversation.id, busy || saved !== null || !ready); return () => onLocked(conversation.id, false); }, [busy, saved, ready, conversation.id, onLocked]);
  async function load() {
    const controller = scope.current; if (!controller || controller.signal.aborted || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(endpoint.replace('/contact-preference', '/apply'), { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.households)) throw new Error('Linked contact options unavailable.');
      if (!controller.signal.aborted) setHouseholds(data.households);
    } catch { if (!controller.signal.aborted) setMessage('Linked contact options unavailable. Refresh the recording and try again.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function confirm(index?: number) {
    const controller = scope.current;
    if (!controller || controller.signal.aborted || busy || !ready) return;
    let payload = saved;
    if (!payload) {
      if (dirty || index === undefined || !household?.contacts.some(item => item.id === contact)) return;
      if (!window.confirm('Mark this linked contact as do not contact? Confirm the transcript contains their explicit request for no further contact. Reviewed conversation follow-ups and new call, email, text or visit Sales tasks will be blocked. Existing tasks and other outreach tools require separate review.')) return;
      payload = { requestId: crypto.randomUUID(), version: conversation.version, contactId: contact, addressId: address, proposalIndex: index, confirmed: true };
    }
    const requestKey = key.current;
    setBusy(true); setMessage(null);
    try {
      persistPreference(localStorage, requestKey, payload); setSaved(payload);
      // Recover an already committed receipt before retrying a mutation, including after retention.
      let response = await fetch(`${endpoint}&requestId=${encodeURIComponent(payload.requestId)}`, { cache: 'no-store', signal: controller.signal });
      if (response.status === 404) response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if ([400, 409].includes(response.status)) { clearPreference(localStorage, requestKey, payload); setSaved(null); }
        throw new Error(response.status === 409 ? 'Conversation or preference changed. Refresh before reviewing again.' : 'Preference could not be confirmed. Keep the saved request and retry when connected.');
      }
      const receipt = checkedPreferenceReceipt(data, conversation.id, payload);
      clearPreference(localStorage, requestKey, payload); setSaved(null);
      setMessage('Contact preference confirmed. Review existing tasks and other outreach tools separately.');
      onSaved(receipt.version);
    } catch { if (!controller.signal.aborted) { try { setSaved(restorePreference(localStorage, requestKey)); } catch { setReady(false); } setMessage('Preference could not be confirmed. Reopen or refresh this review, then retry the saved request.'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (!saved && ready && (!proposals.length || !['pending', 'approved'].includes(conversation.review_state) || !conversation.target_confirmed || conversation.consent !== 'granted')) return null;
  return <div className="space-y-2 rounded border p-3">
    <p className="text-sm font-medium">Review contact preference</p>
    {saved ? <><p role="status" className="text-sm">A saved contact preference needs confirmation. Retry uses its exact contact and request.</p><Button disabled={busy || !ready} onClick={() => void confirm()}>{busy ? 'Checking…' : 'Recover saved preference'}</Button></> : <>
      <p className="text-sm">Confirm an explicit request for no further contact. AI suggestions do not change the contact automatically.</p>
      {dirty && <p className="text-sm">Save draft edits before reviewing this preference.</p>}
      {!households ? <Button variant="outline" disabled={busy || !ready || dirty} onClick={() => void load()}>Choose linked contact for preference</Button> : <>
        <label className="block text-sm">Household<select className="block w-full rounded border p-2" value={address} disabled={busy || dirty} onChange={event => { setAddress(event.target.value); setContact(''); }}><option value="">Choose exact address</option>{households.map(item => <option key={item.addressId} value={item.addressId}>{item.label}</option>)}</select></label>
        <label className="block text-sm">Contact<select className="block w-full rounded border p-2" value={contact} disabled={busy || dirty || !household} onChange={event => setContact(event.target.value)}><option value="">Choose linked contact</option>{household?.contacts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {proposals.map(({ proposal, index }) => <div key={index} className="space-y-1"><p className="text-sm">{proposal.title}</p>{proposal.evidence.map((citation, item) => <p key={item} className="text-sm">{segments.some(segment => segment.id === citation.segmentId && segment.text.includes(citation.quote)) ? `“${citation.quote}”` : 'Evidence needs review.'}</p>)}<Button variant="outline" disabled={busy || !ready || dirty || !contact || !proposal.evidence.length || proposal.evidence.some(citation => !citation.quote.trim() || citation.quote.length > 2000 || !segments.some(segment => segment.id === citation.segmentId && segment.text.includes(citation.quote)))} onClick={() => void confirm(index)}>Confirm no further contact</Button></div>)}
      </>}
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
