"use client";
import { useEffect, useId, useRef, useState } from 'react';
import type { Client, Task, Message } from '@/lib/coco/types';
import { escapeLetter, letterText, relationshipApi, type RelationshipData, type SpecialField } from '@/lib/coco/relationships';

const defaults: SpecialField[] = [{ name: 'Birthday', type: 'date', value: '' }, { name: 'Home anniversary', type: 'date', value: '' }];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not save. Please retry.';
function localNow() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

export function OutreachTools({ clients, userId, workspaceId, onSaved }: { clients: Client[]; userId: string; workspaceId: string; onSaved: () => Promise<void> }) {
  const activityId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('follow-up');
  const [title, setTitle] = useState('Christmas follow-up');
  const [body, setBody] = useState('');
  const [at, setAt] = useState(localNow);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const retry = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const letter = kind.startsWith('letter-');
  const missing = clients.filter(c => !c.address?.trim()).length;
  const invalid = !clients.length || clients.length > 500 || !title.trim() || !at || (letter && missing > 0);
  const payload = () => ({ action: 'outreach', ids: clients.map(c => c.id).sort(), kind, title, body, at: new Date(at).toISOString() });
  async function save() {
    if (busy || invalid) return;
    setBusy(true); setMessage('');
    try {
      const data = payload(); const fingerprint = JSON.stringify(data);
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, requestId: crypto.randomUUID() };
      const result = await relationshipApi<{ count: number }>(userId, workspaceId, { ...data, requestId: retry.current.requestId });
      setMessage(`Saved for ${result.count} contact${result.count === 1 ? '' : 's'}.`);
      try { await onSaved(); } catch { setMessage('Saved. Refresh to see the latest tasks and history.'); }
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  function printLetters() {
    if (invalid || !body.trim()) return;
    const popup = window.open('', '_blank');
    if (!popup) { setMessage('Allow pop-ups to open the printable letters.'); return; }
    popup.opener = null;
    popup.document.write(`<!doctype html><html><head><title>${escapeLetter(title)}</title><style>body{font:12pt Georgia,serif;line-height:1.6;margin:0}article{padding:20mm;break-after:page}article:last-child{break-after:auto}pre{white-space:pre-wrap;font:inherit}button{margin:20px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button>${clients.map(c => `<article><p>${escapeLetter(`${c.first_name} ${c.last_name}`)}<br>${escapeLetter(c.address || '')}</p><pre>${escapeLetter(letterText(body, c))}</pre></article>`).join('')}</body></html>`);
    popup.document.close();
    setMessage('Letters opened for review and printing. Save “Letter prepared” to record preparation; record “Letter mailed” after posting.');
  }
  return <div className="relationship-tools">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>Follow-ups, letters & touch points{clients.length > 1 ? ` (${clients.length})` : ''}</button>
    {open && <div className="relationship-form">
      <p>{clients.length} selected · Each contact gets their own record. Up to 500 at a time.</p>
      <label htmlFor={activityId}>Activity</label><select id={activityId} aria-label="Activity" disabled={busy} value={kind} onChange={e => { setKind(e.target.value); setMessage(''); }}>
        <option value="follow-up">Schedule follow-up</option><option value="letter-prepared">Letter prepared</option><option value="letter-mailed">Letter mailed</option><option value="call">Call</option><option value="email">Email</option><option value="text">Text</option><option value="visit">Visit</option><option value="note">Note</option>
      </select>
      <label>Occasion / title<input maxLength={200} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label>{kind === 'follow-up' ? 'Follow-up due' : 'Activity date'}<input type="datetime-local" value={at} disabled={busy} onChange={e => setAt(e.target.value)} /></label>
      <label>{letter ? 'Letter text' : 'Notes'}<textarea rows={5} maxLength={10000} value={body} disabled={busy} onChange={e => setBody(e.target.value)} placeholder={letter ? 'Hi {first_name},\n\nWishing you a wonderful Christmas!' : 'Add details about this touch point'} /></label>
      {letter && <><small>Personalize with {'{first_name}'}, {'{last_name}'} and {'{address}'}. Review addresses before printing. Printing does not send mail.</small>{missing > 0 && <p role="alert">{missing} selected contact(s) need a mailing address. Add their address or remove them from the selection.</p>}<button type="button" disabled={busy || invalid || !body.trim()} onClick={printLetters}>Preview / print personalized letters</button></>}
      <button type="button" className="primary" disabled={busy || invalid} onClick={() => void save()}>{busy ? 'Saving…' : kind === 'follow-up' ? `Create ${clients.length} follow-up task(s)` : `Record ${kind.replaceAll('-', ' ')} for ${clients.length} contact(s)`}</button>
      <p role="status">{message}</p>
    </div>}
  </div>;
}

export function RelationshipPanel({ client, userId, tasks, messages, onSaved, showTimeline = true }: { client: Client; userId: string; tasks: Task[]; messages: Message[]; onSaved: () => Promise<void>; showTimeline?: boolean }) {
  const [data, setData] = useState<RelationshipData | null>(null);
  const [fields, setFields] = useState<SpecialField[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'date'>('text');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    relationshipApi<RelationshipData>(userId, client.workspace_id, undefined, client.id, controller.signal).then(result => {
      setData(result); setFields(result.version > 0 ? result.fields : defaults.map(f => ({ ...f }))); setMessage('');
    }).catch(error => { if (!controller.signal.aborted) setMessage(errorMessage(error)); });
    return () => controller.abort();
  }, [userId, client.workspace_id, client.id, reload]);
  async function saveFields() {
    if (!data || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await relationshipApi<{ version: number }>(userId, client.workspace_id, { action: 'fields', contactId: client.id, version: data.version, fields });
      setData({ ...data, fields, version: result.version }); setMessage('Fields saved.');
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  const timeline = !showTimeline ? [] : [
    ...(data?.events ?? []).map(event => ({ id: event.id, at: event.occurred_at, title: `${event.kind === 'follow-up' ? 'Follow-up scheduled' : event.kind.replaceAll('-', ' ')} · ${event.title}`, body: event.body })),
    ...tasks.filter(task => task.completed_at).map(task => ({ id: `task-${task.id}`, at: task.completed_at!, title: `Task completed · ${task.title}`, body: task.notes || '' })),
    ...messages.map(item => ({ id: `message-${item.id}`, at: item.sent_at || item.created_at, title: item.direction === 'outgoing' ? 'Message sent' : 'Message received', body: item.body || 'Attachment' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return <section className="surface relationship-panel">
    <h2>Special fields & touch points</h2>
    <p>Keep birthdays, home anniversaries and other details with this contact.</p>
    {!data ? <p role="status">{message || 'Loading relationship details…'}</p> : <>
      <fieldset disabled={busy}><legend>Special fields</legend>
        {fields.map((field, index) => <div className="relationship-field" key={field.name}>
          <label>{field.name}<input type={field.type} value={field.value} maxLength={1000} onChange={e => setFields(current => current.map((f, i) => i === index ? { ...f, value: e.target.value } : f))} /></label>
          <button type="button" aria-label={`Remove ${field.name}`} onClick={() => setFields(current => current.filter((_, i) => i !== index))}>Remove</button>
        </div>)}
        <div className="relationship-field"><label>New field name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="e.g. Preferred contractor" /></label>
          <label>Field type<select value={type} onChange={e => setType(e.target.value as 'text' | 'date')}><option value="text">Text</option><option value="date">Date</option></select></label>
          <button type="button" disabled={!name.trim() || fields.length >= 40 || fields.some(f => f.name.toLowerCase() === name.trim().toLowerCase())} onClick={() => { setFields(current => [...current, { name: name.trim(), type, value: '' }]); setName(''); }}>Add field</button>
        </div>
        <button type="button" className="primary" onClick={() => void saveFields()}>Save fields</button>
      </fieldset>
      <p role="status">{message}</p>
      <OutreachTools clients={[client]} userId={userId} workspaceId={client.workspace_id} onSaved={async () => {
        const result = await relationshipApi<RelationshipData>(userId, client.workspace_id, undefined, client.id);
        setData(current => current ? { ...current, events: result.events } : result); await onSaved();
      }} />
      {showTimeline && <><h3>Touch-point history</h3>
      <p className="relationship-hint">Logged activities, completed tasks and loaded conversations. Dates here do not automatically schedule annual reminders.</p>
      {!timeline.length && <p>No touch points recorded yet.</p>}
      <ol className="relationship-timeline">{timeline.map(event => <li key={event.id}><strong>{event.title}</strong><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>{event.body && <p>{letterText(event.body, client)}</p>}</li>)}</ol></>}
    </>}
    {!data && message && <button type="button" onClick={() => setReload(value => value + 1)}>Retry loading</button>}
  </section>;
}
