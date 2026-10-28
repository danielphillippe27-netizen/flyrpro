'use client';
import { useEffect, useState } from 'react';
import { macApi, type NativePerson } from '@/lib/mac-companion/client';
const button = 'rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:opacity-40';
type Match = { id: string; full_name: string; phone: string | null; email: string | null };
export function ContactReview({ person, userId, workspaceId, deviceId, onDone }: { person: NativePerson; userId: string; workspaceId: string; deviceId: string; onDone: () => void }) {
  const [name, setName] = useState(person.fullName), [phone, setPhone] = useState(person.phones[0] ?? ''), [email, setEmail] = useState(person.emails[0] ?? '');
  const [matches, setMatches] = useState<Match[]>(), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setMatches(undefined); setTarget('');
    const timer = setTimeout(() => void macApi<Match[]>('', { userId, action: 'review-contact', workspaceId, phones: person.phones, emails: person.emails, fullName: name }, controller.signal).then(setMatches).catch(error => { if (!controller.signal.aborted) setNotice(error.message); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [workspaceId, userId, person, name]);
  async function save() {
    setBusy(true);
    try { await macApi('', { userId, action: 'import-contact', workspaceId, deviceId, externalId: person.externalId, fullName: name, phones: person.phones, emails: person.emails, phone, email, targetId: target || null }); onDone(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Review Apple contact</h2>
    <label className="block text-sm">Name<input className="mt-1 w-full rounded border bg-background p-2" value={name} onChange={event => setName(event.target.value)} /></label>
    <div className="flex flex-wrap gap-3"><label>Primary phone<select className="ml-2 max-w-full rounded border bg-background p-2" value={phone} onChange={event => setPhone(event.target.value)}><option value="">None</option>{person.phones.map((value,index) => <option key={index}>{value}</option>)}</select></label><label>Primary email<select className="ml-2 max-w-full rounded border bg-background p-2" value={email} onChange={event => setEmail(event.target.value)}><option value="">None</option>{person.emails.map((value,index) => <option key={index}>{value}</option>)}</select></label></div>
    {!!matches?.length && <label className="block text-sm">Possible existing people — choose who to update<select className="mt-1 block w-full rounded border bg-background p-2" value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a person</option>{matches.map(match => <option key={match.id} value={match.id}>{match.full_name} · {match.phone || match.email}</option>)}</select></label>}
    <p className="text-xs text-muted-foreground">Saving this contact also approves future messages for uniquely matched phone numbers and emails. Older history and AI access require separate choices. Primary details fill empty fields only; existing CRM details stay intact.</p>
    <div className="flex gap-2"><button className={button} disabled={busy || !matches || !name.trim() || (!!matches.length && !target)} onClick={() => void save()}>{matches?.length ? 'Fill missing details' : 'Save new contact'}</button><button className={button} disabled={busy} onClick={onDone}>Skip</button></div>
    {notice && <p className="text-sm" role="status">{notice}</p>}
  </section>;
}
