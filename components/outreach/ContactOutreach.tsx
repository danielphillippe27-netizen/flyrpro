'use client';
import { useRef, useState } from 'react';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/lib/workspace-context';
import { nativeContactUrl, recipientsFor, type OutreachContact, type OutreachMode } from '@/lib/outreach/native';
import { GmailConnection, outreachRequest } from './GmailConnection';

export function ContactOutreach({ contacts, compact = false }: { contacts: OutreachContact[]; compact?: boolean }) {
  const { currentWorkspaceId } = useWorkspace();
  const [mode, setMode] = useState<OutreachMode | null>(null);
  const [available, setAvailable] = useState<OutreachContact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [queue, setQueue] = useState<OutreachContact[] | null>(null);
  const [index, setIndex] = useState(0);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [gmail, setGmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sendingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const requestId = useRef('');
  const stop = useRef(false);
  function open(next: OutreachMode) {
    const eligible = recipientsFor(contacts, next);
    setAvailable(eligible); setSelected(eligible.map(c => c.id)); setMode(next); setQueue(null); setIndex(0); setNotice(''); setResults({}); requestId.current = crypto.randomUUID();
  }
  function start() { setQueue(available.filter(c => selected.includes(c.id))); setIndex(0); }
  async function sendEmails() {
    if (!queue || !currentWorkspaceId || sendingRef.current) return;
    sendingRef.current = true; setBusy(true); stop.current = false; setNotice('');
    try {
      for (const contact of queue) {
        if (stop.current) break;
        if (results[contact.id]) continue;
        try {
          const result = await outreachRequest('/api/outreach/gmail/send', { method: 'POST', body: JSON.stringify({ workspaceId: currentWorkspaceId, requestId: requestId.current, contactId: contact.id, subject, body }) });
          setResults(previous => ({ ...previous, [contact.id]: result.status }));
          if (result.warning) setNotice(result.warning);
          if (result.status !== 'accepted') { setNotice('Sending paused. Check Gmail before retrying a failed or unknown result.'); break; }
        } catch (e) {
          setResults(previous => ({ ...previous, [contact.id]: 'unknown' }));
          setNotice(`${e instanceof Error ? e.message : 'Sending interrupted.'} Check Gmail before resending.`); break;
        }
      }
    } finally { sendingRef.current = false; setBusy(false); }
  }
  const current = queue?.[index];
  const title = mode === 'call' ? 'Call list' : mode === 'message' ? 'Message list' : 'Email list';
  return <>
    <div className="flex flex-wrap gap-2">
      {compact && contacts[0] && nativeContactUrl(contacts[0], 'message') ? <Button size="sm" variant="outline" asChild><a href={nativeContactUrl(contacts[0], 'message')!}><MessageSquare className="mr-1.5 h-4 w-4" />Messages</a></Button> : <Button type="button" size="sm" variant="outline" disabled={!contacts.length || compact} onClick={() => open('message')}><MessageSquare className="mr-1.5 h-4 w-4" />{compact ? 'Messages' : 'Message list'}</Button>}
      {compact && contacts[0] && nativeContactUrl(contacts[0], 'call') ? <Button size="sm" variant="outline" asChild><a href={nativeContactUrl(contacts[0], 'call')!}><Phone className="mr-1.5 h-4 w-4" />Call on Mac / iPhone</a></Button> : <Button type="button" size="sm" variant="outline" disabled={!contacts.length || compact} onClick={() => open('call')}><Phone className="mr-1.5 h-4 w-4" />{compact ? 'Call on Mac / iPhone' : 'Call list'}</Button>}
      <Button type="button" size="sm" variant="outline" disabled={!contacts.length} onClick={() => open('email')}><Mail className="mr-1.5 h-4 w-4" />{compact ? 'Gmail' : 'Email list'}</Button>
    </div>
    <Dialog open={mode !== null} onOpenChange={open => { if (!open && !sendingRef.current) setMode(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{mode === 'email' ? 'Send a separate email to each selected contact from your connected Gmail.' : mode === 'message' ? 'Open each contact in Messages. Copy your message, paste it into Messages, then press Send.' : 'Open each number in your calling app, then return here for the next contact.'}</DialogDescription></DialogHeader>
        {mode === 'email' && <GmailConnection onConnected={setGmail} />}
        {!queue ? <>
          <p className="text-sm text-muted-foreground">{available.length} unique recipients · {contacts.length - available.length} missing, invalid or duplicate</p>
          {mode === 'email' && <Input aria-label="Email subject" placeholder="Subject" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} />}
          {mode !== 'call' && <Textarea aria-label="Message body" placeholder="Write your message…" maxLength={mode === 'email' ? 20000 : 5000} value={body} onChange={e => setBody(e.target.value)} />}
          <Button variant="ghost" size="sm" onClick={() => setSelected(selected.length === available.length ? [] : available.map(c => c.id))}>{selected.length === available.length ? 'Deselect all' : 'Select all'}</Button>
          <div className="max-h-60 space-y-1 overflow-y-auto">{available.map(c => <label key={c.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted"><input type="checkbox" checked={selected.includes(c.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} /><span className="min-w-0"><span className="block truncate font-medium">{c.full_name || 'Contact'}</span><span className="block text-sm text-muted-foreground">{mode === 'email' ? c.email : c.phone_e164 || c.phone}</span></span></label>)}</div>
          <Button disabled={!selected.length || (mode === 'email' && (!gmail || !subject.trim() || !body.trim())) || (mode === 'message' && !body.trim())} onClick={start}>{mode === 'email' ? 'Review' : 'Start'} {selected.length} contacts</Button>
        </> : mode === 'email' ? <>
          <p className="text-sm">From <strong>{gmail}</strong> · {queue.length} recipients</p><p className="text-xs text-muted-foreground">Keep this tab open while sending. Accepted means Gmail received the email, not confirmed delivery.</p><h3 className="font-semibold">{subject}</h3><p className="whitespace-pre-wrap text-sm">{body}</p>
          <ul className="max-h-48 overflow-y-auto text-sm space-y-2">{queue.map(c => <li key={c.id}>{c.full_name || 'Contact'} ({c.email}): {results[c.id] === 'accepted' ? 'Accepted by Gmail' : results[c.id] || 'Not sent'}</li>)}</ul>
          <Button disabled={busy || !gmail || !currentWorkspaceId || queue.every(c => results[c.id])} onClick={() => void sendEmails()}>{busy ? 'Sending…' : Object.keys(results).length ? 'Continue unsent emails' : `Send ${queue.length} emails`}</Button>
          {busy && <Button variant="outline" onClick={() => { stop.current = true; setNotice('Pausing after the current email.'); }}>Pause after current email</Button>}
        </> : current ? <>
          <p className="text-sm text-muted-foreground">{index + 1} of {queue.length}</p><h3 className="text-xl font-semibold">{current.full_name || 'Contact'}</h3><p>{current.phone_e164 || current.phone}</p>
          {mode === 'message' && <><Textarea aria-label="Message to copy" value={body} onChange={e => setBody(e.target.value)} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(body); setNotice('Message copied. Open Messages and paste it into your draft.'); } catch { setNotice('Select the message above and copy it manually.'); } }}>Copy message</Button></>}
          <Button asChild><a href={nativeContactUrl(current, mode === 'message' ? 'message' : 'call')!}>{mode === 'message' ? 'Open Messages' : 'Open Phone'}</a></Button>
          <div className="flex gap-2"><Button variant="outline" onClick={() => { setIndex(i => i + 1); setNotice(''); }}>Next contact</Button><Button variant="ghost" onClick={() => { setIndex(i => i + 1); setNotice(''); }}>Skip</Button></div>
          <p className="text-xs text-muted-foreground">{mode === 'message' ? 'Your device chooses iMessage or SMS. WolfGrid can’t confirm whether you sent the message.' : 'Mac calls require iPhone calling to be configured. WolfGrid can’t detect when the call ends.'}</p>
        </> : <p className="py-6 text-center font-medium">List complete.</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
