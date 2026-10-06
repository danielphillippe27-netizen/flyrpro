'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { actionDateInput, localActionDate } from '@/lib/field-recordings/application';
import { applicationStorageKey, persistApplication, restoreApplication, type ApplicationPayload } from '@/lib/field-recordings/application-request';
import type { ReviewConversation } from './ConversationReview';

type Options = { households: { addressId: string; label: string; contacts: { id: string; name: string }[] }[]; taskCreationEnabled: boolean };

export default function ConversationApplication({ ownerId, workspaceId, recordingId, conversation, onSaved, draftDirty }: {
  ownerId: string; workspaceId: string; recordingId: string; conversation: ReviewConversation; draftDirty: boolean; onSaved: (value: ReviewConversation) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [saveNote, setSaveNote] = useState(!!conversation.note?.trim());
  const [selected, setSelected] = useState<number[]>([]);
  const [dates, setDates] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const frozen = useRef<ApplicationPayload | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const storageKey = useRef<string | null>(null);
  useEffect(() => {
    frozen.current = null; storageKey.current = null; setRetrying(false); setStorageReady(false);
    try {
      const key = applicationStorageKey(ownerId, workspaceId, recordingId, conversation.id);
      frozen.current = restoreApplication(localStorage, key); storageKey.current = key;
      setRetrying(frozen.current !== null); setStorageReady(true);
    } catch { setError('Saved application state could not be read. Reopen this review before applying.'); }
  }, [ownerId, workspaceId, recordingId, conversation.id]);
  const endpoint = `/api/field-recordings/${recordingId}/conversations/${conversation.id}/apply`;
  const proposals = conversation.action_proposals ?? [];
  const household = options?.households.find(value => value.addressId === address);
  async function load() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Unable to load linked contacts');
      setOptions(value);
      setDates(Object.fromEntries(proposals.map((proposal, index) => [index, actionDateInput(proposal.dueAt)])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load linked contacts'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (busy || !storageReady || !storageKey.current) return;
    setBusy(true); setError(null);
    let persisted = false;
    try {
      if (!frozen.current) {
        if (!household?.contacts.some(value => value.id === contact)) throw new Error('Choose a household and its linked contact');
        if (!saveNote && !selected.length) throw new Error('Select a note or follow-up');
        frozen.current = { requestId: crypto.randomUUID(), version: conversation.version, contactId: contact, addressId: address, saveNote,
          actions: selected.map(proposalIndex => ({ proposalIndex, dueAt: localActionDate(dates[proposalIndex] || '') })) };
      }
      persistApplication(localStorage, storageKey.current, frozen.current); persisted = true;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frozen.current) });
      const value = await response.json();
      if (!response.ok) {
        // Server/network failures may hide a committed result: retain the exact request.
        if (response.status < 500) { localStorage.removeItem(storageKey.current); frozen.current = null; setRetrying(false); }
        throw new Error(value.error || 'Unable to apply conversation');
      }
      if (value.conversation?.id !== conversation.id || value.conversation?.review_state !== 'approved' || value.conversation?.version <= frozen.current.version) throw new Error('Application result needs reconciliation');
      localStorage.removeItem(storageKey.current); frozen.current = null; setRetrying(false);
      onSaved(value.conversation);
    } catch (cause) {
      if (!persisted) {
        try { frozen.current = restoreApplication(localStorage, storageKey.current); }
        catch { frozen.current = null; setStorageReady(false); }
      }
      setRetrying(frozen.current !== null);
      setError(cause instanceof Error ? cause.message : 'Unable to apply conversation');
    } finally { setBusy(false); }
  }
  if (retrying) return <div className="space-y-2 rounded border p-3"><p role="status">A saved application needs confirmation. Retry its exact selections to recover the server result without duplicates.</p><Button disabled={busy || !storageReady} onClick={() => void apply()}>{busy ? 'Recovering…' : 'Retry saved application'}</Button>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}</div>;
  if (conversation.review_state !== 'pending' || !conversation.target_confirmed || conversation.consent !== 'granted') return null;
  if (draftDirty) return <p className="text-sm text-muted-foreground">Save your draft edits before applying this conversation to a contact.</p>;
  return <div className="space-y-3 rounded-md border p-3">
    <p className="text-sm font-medium">Apply to contact</p>
    {!options ? <Button variant="outline" disabled={busy || !storageReady} onClick={() => void load()}>Choose linked household and contact</Button> : <>
      <label className="block text-sm">Household<select className="mt-1 block w-full rounded border bg-background p-2" disabled={busy || retrying} value={address} onChange={event => { setAddress(event.target.value); setContact(''); }}><option value="">Choose exact address</option>{options.households.map(value => <option key={value.addressId} value={value.addressId}>{value.label}</option>)}</select></label>
      <label className="block text-sm">Contact<select className="mt-1 block w-full rounded border bg-background p-2" disabled={busy || retrying || !household} value={contact} onChange={event => setContact(event.target.value)}><option value="">Choose linked contact</option>{household?.contacts.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      {household && !household.contacts.length && <p className="text-sm text-muted-foreground">No contact linked to this household. Create or link the contact in Contacts, then reload this review.</p>}
      {!!conversation.note?.trim() && <label className="flex gap-2 text-sm"><input type="checkbox" checked={saveNote} disabled={busy || retrying} onChange={event => setSaveNote(event.target.checked)} />Save the reviewed note to this contact</label>}
      {proposals.map((proposal, index) => {
        const supported = proposal.kind !== 'do_not_contact' && (proposal.kind === 'appointment' || options.taskCreationEnabled);
        return <div key={index} className="space-y-1"><label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || retrying || !supported} checked={selected.includes(index)} onChange={event => setSelected(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))} />{proposal.title} · {proposal.kind.replaceAll('_', ' ')}</label>
          {!supported && <p className="text-xs text-muted-foreground">{proposal.kind === 'do_not_contact' ? 'Review contact preferences separately.' : 'Set up Sales to create follow-up tasks.'}</p>}
          {selected.includes(index) && <label className="block text-sm">Confirmed date and time<input type="datetime-local" className="ml-2 rounded border bg-background p-2" value={dates[index] ?? ''} disabled={busy || retrying} onChange={event => setDates(current => ({ ...current, [index]: event.target.value }))} /></label>}
        </div>;
      })}
      <p className="text-xs text-muted-foreground">Dates use your browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Follow-ups create tasks; messages are sent through your normal contact workflow.</p>
      {retrying && <p role="status" className="text-sm">The result is uncertain. Retry the same selections to recover the saved result without duplicates.</p>}
      <Button disabled={busy || (!retrying && (!contact || (!saveNote && !selected.length)))} onClick={() => void apply()}>{busy ? 'Applying…' : retrying ? 'Retry same application' : 'Apply reviewed note and selected actions'}</Button>
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
