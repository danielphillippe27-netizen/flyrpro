'use client';
import Link from 'next/link';
import { OpenAIConnection } from '@/components/crm-ai/OpenAIConnection';
import { useCallback, useEffect, useState } from 'react';
import { useCrmScope } from '@/components/crm-ai/useCrmScope';
import { useWorkspace } from '@/lib/workspace-context';
import { hasMacBridge, macApi, macNative, type NativePerson, type MacStatus } from '@/lib/mac-companion/client';
const button = 'rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40';
type Match = { id: string; full_name: string; phone: string | null; email: string | null };
export default function MacSettingsPage() {
  const scope = useCrmScope();
  return scope.userId ? <MacSettingsContent key={scope.key} userId={scope.userId} /> : <p className="p-6">Loading your Mac settings…</p>;
}
function MacSettingsContent({ userId }: { userId: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const [state, setState] = useState<MacStatus>();
  const [native, setNative] = useState<{ deviceId: string; messagesAllowed: boolean }>();
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<NativePerson[]>([]);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!currentWorkspaceId) return;
    const result = await macApi<MacStatus>(`?workspaceId=${currentWorkspaceId}`, undefined, signal); setState(result);
  }, [currentWorkspaceId]);
  useEffect(() => {
    const controller = new AbortController(); setPeople([]); setState(undefined); setNotice('');
    const refresh = () => void load(controller.signal).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    refresh(); const timer = setInterval(refresh, 10000);
    if (hasMacBridge()) void macNative<{ deviceId: string; messagesAllowed: boolean }>('status').then(setNative).catch(error => setNotice(error.message));
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  async function preference(syncEnabled: boolean, aiMessagesEnabled: boolean) {
    if (!currentWorkspaceId) return;
    setBusy(true);
    try {
      await macApi('', { userId, action: 'preferences', workspaceId: currentWorkspaceId, syncEnabled, aiMessagesEnabled });
      if (!syncEnabled && hasMacBridge()) await macNative('clear-approval');
      await load(); setNotice('Preferences saved. Changes apply to your account in this workspace.');
    } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  async function recheck() {
    setBusy(true);
    try { await macApi('', { userId, action: 'recheck', workspaceId: currentWorkspaceId }); setNotice('History recheck queued. Your running Mac app will replay available history without duplicating messages.'); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  async function choose() {
    setBusy(true);
    try { setPeople(await macNative<NativePerson[]>('contacts')); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6 p-6">
    <Link className="text-sm text-muted-foreground" href="/settings/integrations">← Integrations</Link>
    <div><h1 className="text-2xl font-semibold">Mac contacts &amp; messages</h1><p className="mt-2 text-muted-foreground">Connect Apple Contacts and sync conversations for your CRM people. Imported messages stay private to your account.</p></div>
    <section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">WolfGrid for Mac</h2>
      <p className="text-sm text-muted-foreground">{native ? native.messagesAllowed ? 'This Mac can read Messages. Sync continues while a WolfGrid window is open, including when minimized.' : 'Allow this WolfGrid app in System Settings → Privacy & Security → Full Disk Access, then quit and reopen it.' : 'Install the Mac companion to import Apple Contacts and Messages. You can read synced history and manage consent from any browser. A public signed download will be available after the pilot.'}</p>
      <p className="text-sm text-muted-foreground">Only one-to-one conversations that uniquely match your CRM contacts are imported. Groups and unknown contacts are excluded. Only messages downloaded by Apple Messages are available; attachments remain in Apple Messages.</p>
      {native && <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void choose()}>Choose Apple Contacts</button><button className={button} disabled={busy} onClick={() => void macNative('settings').catch(error => setNotice(error.message))}>Open Full Disk Access</button></div>}
    </section>
    <section className="space-y-4 rounded-xl border p-5"><h2 className="font-semibold">Your permissions</h2>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={state?.preferences.sync_enabled ?? false} disabled={busy || !state} onChange={event => void preference(event.target.checked, state?.preferences.ai_messages_enabled ?? false)} /><span><span className="font-medium">Sync messages for my CRM contacts</span><span className="mt-1 block text-sm text-muted-foreground">Includes existing and newly added contacts you own in this workspace. Turning this off stops new imports and keeps saved history.</span></span></label>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={state?.preferences.ai_messages_enabled ?? false} disabled={busy || !state} onChange={event => void preference(state?.preferences.sync_enabled ?? false, event.target.checked)} /><span><span className="font-medium">Allow AI to use my synced messages</span><span className="mt-1 block text-sm text-muted-foreground">Relevant excerpts from your synced conversations may be sent to OpenAI when you ask questions or request drafts. Applies across your contacts in this workspace. Turning this off excludes messages from future requests.</span></span></label>
      <button className={button} disabled={busy || !state?.preferences.sync_enabled} onClick={() => void recheck()}>Recheck history</button>
    </section>
    <div id="openai"><OpenAIConnection /></div>
    {state?.devices.map(device => <p className="text-sm text-muted-foreground" key={device.device_id}>Mac {device.device_id.slice(0,8)} · {device.status.replaceAll('_',' ')} · last seen {new Date(device.last_seen_at).toLocaleString()}</p>)}
    {notice && <p className="rounded-lg bg-muted p-3 text-sm" role="status">{notice}</p>}
    {currentWorkspaceId && people.map(person => <ContactReview key={person.externalId} person={person} userId={userId} workspaceId={currentWorkspaceId} deviceId={native?.deviceId ?? ''} onDone={() => setPeople(previous => previous.filter(row => row.externalId !== person.externalId))} />)}
  </div>;
}
function ContactReview({ person, userId, workspaceId, deviceId, onDone }: { person: NativePerson; userId: string; workspaceId: string; deviceId: string; onDone: () => void }) {
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
    <p className="text-xs text-muted-foreground">Primary details fill empty fields only. Alternate phones and emails are retained for matching. Existing populated fields are preserved.</p>
    <div className="flex gap-2"><button className={button} disabled={busy || !matches || !name.trim() || (!!matches.length && !target)} onClick={() => void save()}>{matches?.length ? 'Fill missing details' : 'Save new contact'}</button><button className={button} disabled={busy} onClick={onDone}>Skip</button></div>
    {notice && <p className="text-sm" role="status">{notice}</p>}
  </section>;
}
