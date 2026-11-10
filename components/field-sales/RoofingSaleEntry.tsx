'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { appointmentError, appointmentRpc } from '@/lib/field-sales/appointments';
import { minorUnits, salesCommand } from '@/lib/field-sales/client';
import type { SaleEntryContext } from './MarkAsSold';

type RoofingEntry = {
  enabled: boolean;
  can_write: boolean;
  currency: string;
  today: string;
  contact_id: string | null;
  opportunity_id: string | null;
  field_appointment_id: string | null;
  actor_id: string;
  can_assign_closer: boolean;
  required_fields: string[];
  contacts: { id: string; name: string; address?: string }[];
  appointments: { id: string; contact_id: string; contact_name: string; start_at: string; setter_name?: string; assignee_name?: string }[];
  opportunities: { id: string; contact_id: string; label: string | null }[];
  representatives: { id: string; name: string }[];
};

export function useRoofingSaleEnabled(workspace: string | null | undefined) {
  const [gate, setGate] = useState<{ workspace: string; enabled: boolean; canWrite: boolean }>();
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    appointmentRpc<RoofingEntry>('field_sales_roofing_entry', { p_workspace: workspace })
      .then(value => { if (active) setGate({ workspace, enabled: value.enabled, canWrite: value.can_write }); })
      .catch(() => { if (active) setGate({ workspace, enabled: false, canWrite: false }); });
    return () => { active = false; };
  }, [workspace]);
  return gate && gate.workspace === workspace ? gate : undefined;
}

export function RoofingSaleEntry({ workspace, initial, close, saved }: {
  workspace: string; initial: SaleEntryContext; close: () => void; saved: (id: string) => void;
}) {
  const [entry, setEntry] = useState<RoofingEntry>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const context = JSON.stringify({
    contact_id: initial.contact_id,
    opportunity_id: initial.opportunity_id,
    field_appointment_id: initial.field_appointment_id,
    campaign_address_id: initial.campaign_address_id,
    search: query,
  });
  useEffect(() => {
    let active = true;
    appointmentRpc<RoofingEntry>('field_sales_roofing_entry', { p_workspace: workspace, p_context: JSON.parse(context) })
      .then(value => { if (active) { setEntry(value); setError(''); } })
      .catch(failure => { if (active) setError(appointmentError(failure)); });
    return () => { active = false; };
  }, [workspace, context]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Record sale</DialogTitle></DialogHeader>
      {!entry && !error ? <p>Loading sale details…</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {entry && !entry.can_write ? <p>Sale entry is unavailable for this workspace.</p> : null}
      {entry?.can_write ? <>
        {!entry.contact_id ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setQuery(search); }}>
          <Input aria-label="Find a customer" placeholder="Find a customer" value={search}
            onChange={event => setSearch(event.target.value)} />
          <Button variant="outline">Search</Button>
        </form> : null}
        <RoofingSaleForm workspace={workspace} entry={entry} busy={busy} setBusy={setBusy}
          direct={initial.sale_source === 'door'} saved={saved} />
      </> : null}
    </DialogContent>
  </Dialog>;
}

const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

function RoofingSaleForm({ workspace, entry, busy, setBusy, direct, saved }: {
  workspace: string; entry: RoofingEntry; busy: boolean; setBusy: (value: boolean) => void;
  direct: boolean; saved: (id: string) => void;
}) {
  const [mode, setMode] = useState(direct ? 'door' : 'appointment');
  const [booking, setBooking] = useState(entry.field_appointment_id ?? '');
  const [contact, setContact] = useState(entry.contact_id ?? '');
  const [deal, setDeal] = useState(entry.opportunity_id ?? '');
  const [closer, setCloser] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(entry.today);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const selected = mode === 'appointment' ? entry.appointments.find(item => item.id === booking) : undefined;
  const selectedContact = mode === 'appointment' ? selected?.contact_id : contact;
  const matching = entry.opportunities.filter(item => item.contact_id === selectedContact);
  const availableDeal = matching.some(item => item.id === deal) ? deal : '';
  const names: Record<string, string> = { product: 'Service', job_identifier: 'Job reference', proof_reference: 'Proof reference' };
  const detailField = (key: string, required: boolean) => <label key={key} className="block space-y-1 text-sm">{names[key]}
    <Input required={required} maxLength={key === 'product' ? 150 : 1000} value={details[key] ?? ''}
      onChange={event => setDetails(current => ({ ...current, [key]: event.target.value }))} />
  </label>;
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    if (!selectedContact || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = {
        ...details,
        sale_source: mode, contact_id: selectedContact, sold_on: date, value_minor: minorUnits(amount, entry.currency),
        field_appointment_id: selected?.id, opportunity_id: availableDeal || undefined, closer_id: closer || undefined,
      };
      const fingerprint = JSON.stringify(data);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const result = await salesCommand(workspace, 'submit', { ...data, request_id: request.current.id });
      saved(result.id);
    } catch (failure) { setError(appointmentError(failure)); }
    finally { setBusy(false); }
  }}>
    {!entry.field_appointment_id ? <label className="block space-y-1 text-sm">Sale source
      <select className={field} value={mode} onChange={event => setMode(event.target.value)}>
        <option value="appointment">Held appointment</option><option value="door">Sold at the door</option>
      </select>
    </label> : null}
    {mode === 'appointment' ? <label className="block space-y-1 text-sm">Held appointment
      <select className={field} required value={booking} onChange={event => { setBooking(event.target.value); setDeal(''); }}>
        <option value="">Choose appointment</option>
        {entry.appointments.map(item => <option key={item.id} value={item.id}>
          {item.contact_name} · {new Date(item.start_at).toLocaleString()}
        </option>)}
      </select>
    </label> : <label className="block space-y-1 text-sm">Contact
      <select className={field} required value={contact} onChange={event => { setContact(event.target.value); setDeal(''); }}>
        <option value="">Choose contact</option>
        {entry.contacts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.address ?? ''}</option>)}
      </select>
    </label>}
    {selected?.setter_name ? <p className="text-sm">Booked by {selected.setter_name}{selected.assignee_name ? ` · Assigned to ${selected.assignee_name}` : ''}</p> : null}
    {matching.length ? <label className="block space-y-1 text-sm">Opportunity
      <select className={field} value={availableDeal} onChange={event => setDeal(event.target.value)}>
        <option value="">New opportunity</option>
        {matching.map(item => <option key={item.id} value={item.id}>{item.label ?? 'Existing opportunity'}</option>)}
      </select>
    </label> : null}
    <label className="block space-y-1 text-sm font-semibold">Contract amount ({entry.currency})
      <Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
    </label>
    {entry.required_fields.map(key => detailField(key, true))}
    <details>
      <summary className="cursor-pointer text-sm">Additional details</summary>
      <div className="mt-2 space-y-2">
        <label className="block space-y-1 text-sm">Sold date
          <Input type="date" required max={entry.today} value={date} onChange={event => setDate(event.target.value)} />
        </label>
        {entry.can_assign_closer ? <label className="block space-y-1 text-sm">Actual closer
          <select className={field} value={closer} onChange={event => setCloser(event.target.value)}>
            <option value="">Me</option>
            {entry.representatives.filter(rep => rep.id !== entry.actor_id).map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
          </select>
        </label> : null}
        {Object.keys(names).filter(key => !entry.required_fields.includes(key)).map(key => detailField(key, false))}
        <label className="block space-y-1 text-sm">Notes
          <Input value={details.notes ?? ''} maxLength={4000}
            onChange={event => setDetails(current => ({ ...current, notes: event.target.value }))} />
        </label>
      </div>
    </details>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Button disabled={!selectedContact || busy}>{busy ? 'Saving…' : 'Save sale'}</Button>
  </form>;
}
