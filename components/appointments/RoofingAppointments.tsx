'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useRoofingSaleEnabled } from '@/components/field-sales/RoofingSaleEntry';
import { useWorkspace } from '@/lib/workspace-context';
import {
  appointmentDate, appointmentError, appointmentRpc, appointmentsChanged,
  listAppointments, localAppointmentInput, type Appointment, type AppointmentDetail,
  type AppointmentList, type AppointmentOptions,
} from '@/lib/field-sales/appointments';

type BookingContext = {
  contact?: { id: string; name: string };
  contacts?: { id: string; name: string }[];
  campaignId?: string;
  addressId?: string;
  propertyLabel?: string;
  initialDate?: Date;
};

const selectClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm';
const statusLabels: Record<Appointment['status'], string> = {
  scheduled: 'Scheduled', confirmed: 'Confirmed', held: 'Held', no_show: 'No show',
  cancelled: 'Cancelled', legacy_unknown: 'Outcome unknown',
};

export function BookingButton({ context, onSaved }: { context?: BookingContext; onSaved?: () => void }) {
  const { currentWorkspaceId } = useWorkspace();
  const [gate, setGate] = useState<{ workspace: string; canWrite: boolean }>();
  useEffect(() => {
    if (!currentWorkspaceId) return;
    let active = true;
    listAppointments(currentWorkspaceId, { p_end: '2000-01-01T00:00:00Z' })
      .then(value => { if (active) setGate({ workspace: currentWorkspaceId, canWrite: value?.can_write === true }); })
      .catch(() => { if (active) setGate(undefined); });
    return () => { active = false; };
  }, [currentWorkspaceId]);
  if (!currentWorkspaceId || gate?.workspace !== currentWorkspaceId || !gate.canWrite) return null;
  return <BookingTrigger key={currentWorkspaceId} workspace={currentWorkspaceId} context={context} onSaved={onSaved} />;
}

export function BookingTrigger({ workspace, context, onSaved }: { workspace: string; context?: BookingContext; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Book appointment</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Book appointment</DialogTitle></DialogHeader>
        {open ? <BookingForm workspace={workspace} context={context} onSaved={() => {
          setOpen(false);
          onSaved?.();
        }} /> : null}
      </DialogContent>
    </Dialog>
  </>;
}

function BookingForm({ workspace, context, onSaved }: { workspace: string; context?: BookingContext; onSaved: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AppointmentOptions>();
  const [contactId, setContactId] = useState(context?.contact?.id ?? '');
  const [assignee, setAssignee] = useState('');
  const [newContact, setNewContact] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const contactDraftId = useRef<string | null>(null);
  const [date, setDate] = useState(() => localAppointmentInput(context?.initialDate ?? new Date(Date.now() + 3_600_000)));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef<{ id: string; fingerprint: string; requestId: string } | null>(null);

  useEffect(() => {
    let active = true;
    appointmentRpc<AppointmentOptions>('field_appointment_options', { p_workspace: workspace, p_search: query })
      .then(value => { if (active) setOptions(value); })
      .catch(error => { if (active) setError(appointmentError(error)); });
    return () => { active = false; };
  }, [workspace, query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (newContact) contactDraftId.current ??= crypto.randomUUID();
      const data = {
        contact_id: newContact ? contactDraftId.current : contactId,
        new_contact_name: newContact ? newName : undefined,
        new_contact_phone: newContact ? newPhone : undefined,
        assignee_id: assignee || undefined,
        campaign_id: context?.campaignId,
        campaign_address_id: context?.addressId,
        start_at: appointmentDate(date),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        notes,
      };
      const fingerprint = JSON.stringify(data);
      if (!draft.current || draft.current.fingerprint !== fingerprint) {
        draft.current = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), fingerprint };
      }
      await appointmentRpc('field_appointment_command', {
        p_workspace: workspace, p_action: 'book',
        p_data: { ...data, id: draft.current.id, request_id: draft.current.requestId },
      });
      window.dispatchEvent(new Event(appointmentsChanged));
      onSaved();
    } catch (error) {
      setError(appointmentError(error));
    } finally {
      setBusy(false);
    }
  }

  return <form className="space-y-4" onSubmit={submit}>
    {context?.addressId && !context.contact ? <label className="flex gap-2 text-sm">
      <input type="checkbox" checked={newContact} onChange={event => setNewContact(event.target.checked)} /> Create a contact
    </label> : null}
    {newContact ? <>
      <label className="block space-y-1 text-sm">Name<Input value={newName} required maxLength={150}
        onChange={event => setNewName(event.target.value)} /></label>
      <label className="block space-y-1 text-sm">Phone (optional)<Input value={newPhone} type="tel" maxLength={100}
        onChange={event => setNewPhone(event.target.value)} /></label>
    </> : context?.contact ? <p className="font-medium">{context.contact.name}</p> : <>
      {!context?.contacts ? <label className="block space-y-1 text-sm">Find a contact
        <div className="flex gap-2">
          <Input value={search} onChange={event => setSearch(event.target.value)} />
          <Button type="button" variant="outline" onClick={() => { setContactId(''); setQuery(search); }}>Search</Button>
        </div>
      </label> : null}
      <label className="block space-y-1 text-sm">Contact
        <select aria-label="Contact" className={selectClass} required value={contactId} onChange={event => setContactId(event.target.value)}>
          <option value="">Choose a contact</option>
          {(context?.contacts ?? options?.contacts)?.map(contact => <option key={contact.id} value={contact.id}>
            {contact.name}{'address' in contact && contact.address ? ` · ${contact.address}` : ''}
          </option>)}
        </select>
      </label>
    </>}
    {context?.propertyLabel ? <p className="text-sm text-muted-foreground">{context.propertyLabel}</p> : null}
    <label className="block space-y-1 text-sm">Date and time
      <Input type="datetime-local" required value={date} onChange={event => setDate(event.target.value)} />
    </label>
    {(options?.representatives.length ?? 0) > 1 ? <label className="block space-y-1 text-sm">Assign closer
      <select className={selectClass} value={assignee} onChange={event => setAssignee(event.target.value)}>
        <option value="">Assign to me</option>
        {options?.representatives.filter(rep => rep.id !== options.actor_id).map(rep =>
          <option key={rep.id} value={rep.id}>{rep.name}</option>)}
      </select>
    </label> : null}
    <details>
      <summary className="cursor-pointer text-sm">Additional details</summary>
      <label className="mt-2 block space-y-1 text-sm">Notes
        <Input value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} />
      </label>
    </details>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button type="submit" disabled={busy || (newContact ? !newName.trim() : !contactId)}>{busy ? 'Saving…' : 'Save appointment'}</Button>
  </form>;
}

type AppointmentAlert = { id: string; appointment_id: string; kind: string; start_at: string; contact_name: string };

function AppointmentAlerts({ workspace, onOpen }: { workspace: string; onOpen: (id: string) => void }) {
  const [alerts, setAlerts] = useState<AppointmentAlert[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void appointmentRpc<{ alerts: AppointmentAlert[] }>('field_appointment_alerts', { p_workspace: workspace })
        .then(result => { if (active) setAlerts(result.alerts); })
        .catch(() => { if (active) setAlerts([]); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(appointmentsChanged, refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(appointmentsChanged, refresh);
    };
  }, [workspace]);
  if (alerts.length === 0) return null;
  return <section className="space-y-1 rounded-lg border p-3" aria-label="Appointment alerts">
    <h3 className="text-sm font-semibold">Appointment alerts</h3>
    {alerts.map(alert => <Button key={alert.id} variant="ghost" onClick={() => onOpen(alert.appointment_id)}>
      {alert.kind === 'assignment' ? 'Assigned' : alert.kind === 'reschedule' ? 'Rescheduled' : 'Coming up'}
      {' · '}{alert.contact_name}{' · '}{new Date(alert.start_at).toLocaleString()}
    </Button>)}
  </section>;
}

export function RoofingAppointments({ workspace, legacy }: { workspace: string; legacy: React.ReactNode }) {
  const [data, setData] = useState<AppointmentList | null>();
  const [team, setTeam] = useState(false);
  const [error, setError] = useState('');
  const initialBooking = useSearchParams().get("booking");
  const [selected, setSelected] = useState<string | undefined>(initialBooking ?? undefined);
  const [older, setOlder] = useState(false);
  const [nextPage, setNextPage] = useState<Appointment[]>([]);
  const reload = useCallback(async () => {
    const value = await listAppointments(workspace, { p_team: team });
    setData(value);
    setNextPage([]);
  }, [workspace, team]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void listAppointments(workspace, { p_team: team }).then(value => {
        if (active) {
          setData(value);
          setNextPage([]);
          setError('');
        }
      }).catch(error => { if (active) setError(appointmentError(error)); });
    };
    refresh();
    window.addEventListener(appointmentsChanged, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener(appointmentsChanged, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [workspace, team]);

  if (error && !data) return <p role="alert" className="text-destructive">{error}</p>;
  if (data === undefined) return <p role="status">Loading appointments…</p>;
  if (!data?.enabled && !data?.appointments.length) return legacy;
  const items = [...data.appointments, ...nextPage];
  const last = items.at(-1);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-lg font-semibold">{team ? 'Team appointments' : 'My appointments'}</h2>
      {data.can_assign ? <Button variant="outline" onClick={() => setTeam(value => !value)}>
        {team ? 'My appointments' : 'View team'}
      </Button> : null}
      {data.can_write ? <BookingTrigger workspace={workspace} /> : null}
    </div>
    <AppointmentAlerts workspace={workspace} onOpen={setSelected} />
    {!items.length ? <p className="text-muted-foreground">No appointments found.</p> : null}
    <ul className="divide-y rounded-lg border">
      {items.map(item => <li key={item.id}>
        <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted"
          onClick={() => setSelected(item.id)}>
          <span>
            <span className="block font-medium">{item.contact_name}</span>
            <span className="text-sm text-muted-foreground">
              {new Date(item.start_at).toLocaleString()} · {item.property_label ?? item.appointment_type}
            </span>
          </span>
          <span className="text-sm">{statusLabels[item.status]}</span>
        </button>
      </li>)}
    </ul>
    {last && items.length % 100 === 0 ? <Button variant="outline" onClick={async () => {
      try {
        const more = await listAppointments(workspace, {
          p_team: team, p_after_start: last.start_at, p_after_id: last.id,
        });
        if (more) setNextPage(current => [...current, ...more.appointments]);
      } catch (error) { setError(appointmentError(error)); }
    }}>Load more</Button> : null}
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Button variant="ghost" onClick={() => setOlder(value => !value)}>{older ? 'Hide' : 'Show'} legacy activity</Button>
    {older ? legacy : null}
    {selected ? <AppointmentDialog workspace={workspace} id={selected} canWrite={data.can_write}
      onClose={() => setSelected(undefined)} onUpdated={reload} /> : null}
  </div>;
}

export function AppointmentDialog({ workspace, id, canWrite, onClose, onUpdated }: {
  workspace: string; id: string; canWrite: boolean; onClose: () => void; onUpdated: () => Promise<void>;
}) {
  const [item, setItem] = useState<AppointmentDetail>();
  const [options, setOptions] = useState<AppointmentOptions>();
  const [mode, setMode] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const params = { p_workspace: workspace, p_id: id };
  const saleGate = useRoofingSaleEnabled(workspace);

  useEffect(() => {
    let active = true;
    appointmentRpc<AppointmentDetail>('field_appointment_detail', { p_workspace: workspace, p_id: id })
      .then(value => { if (active) setItem(value); })
      .catch(error => { if (active) setError(appointmentError(error)); });
    return () => { active = false; };
  }, [workspace, id]);

  async function change(action: string) {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      const fields = {
        id, version: item.version,
        reason: action === 'cancel' ? value : action.startsWith('correct_') ? reason : undefined,
        setter_id: action === 'correct_setter' ? value : undefined,
        status: action === 'correct_outcome' ? value : undefined,
        assignee_id: action === 'assign' ? value : undefined,
        start_at: action === 'reschedule' ? appointmentDate(value) : undefined,
        timezone: action === 'reschedule' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
      };
      const fingerprint = JSON.stringify([action, fields]);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      const result = await appointmentRpc<{ conflict?: boolean }>('field_appointment_command', {
        p_workspace: workspace, p_action: action, p_data: { ...fields, request_id: request.current.id },
      });
      setItem(await appointmentRpc<AppointmentDetail>('field_appointment_detail', params));
      setMode('');
      if (result.conflict) setError('This appointment changed. Review the latest details and try again.');
      else await onUpdated();
    } catch (error) { setError(appointmentError(error)); }
    finally { setBusy(false); }
  }

  const openAppointment = item && canWrite && item.can_update && ['scheduled', 'confirmed'].includes(item.status);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{item?.contact_name ?? 'Appointment'}</DialogTitle></DialogHeader>
      {item ? <>
        <p>{statusLabels[item.status]} · {new Date(item.start_at).toLocaleString()}</p>
        <p className="text-sm text-muted-foreground">{item.property_label ?? item.appointment_type}</p>
        {item.setter_name ? <p className="text-sm">Booked by {item.setter_name}</p> : null}
        {item.assignee_name ? <p className="text-sm">Assigned to {item.assignee_name}</p> : null}
        {item.status === 'held' && saleGate?.canWrite ? <Button asChild>
          <Link href={`/sales?booking=${item.id}`}>Record sale</Link>
        </Button> : null}
        {item.notes ? <p className="whitespace-pre-wrap text-sm">{item.notes}</p> : null}
        {openAppointment ? <div className="flex flex-wrap gap-2">
          {item.status === 'scheduled' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void change('confirm')}>Confirm</Button> : null}
          <Button size="sm" variant="outline" disabled={busy || Date.parse(item.start_at) > Date.now()} onClick={() => void change('held')}>Mark held</Button>
          <Button size="sm" variant="outline" disabled={busy || Date.parse(item.start_at) > Date.now()} onClick={() => void change('no_show')}>No show</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => {
            setMode('reschedule'); setValue(localAppointmentInput(new Date(item.start_at)));
          }}>Reschedule</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setMode('cancel'); setValue(''); }}>Cancel appointment</Button>
          {item.can_assign ? <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
            try {
              setOptions(await appointmentRpc<AppointmentOptions>('field_appointment_options', { p_workspace: workspace }));
              setValue(item.assignee_id ?? '');
              setMode('assign');
            } catch (error) { setError(appointmentError(error)); }
          }}>Reassign</Button> : null}
        </div> : null}
        {canWrite && item.can_assign ? <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
            try {
              setOptions(await appointmentRpc<AppointmentOptions>('field_appointment_options', { p_workspace: workspace }));
              setValue(item.setter_id ?? '');
              setReason('');
              setMode('correct_setter');
            } catch (failure) { setError(appointmentError(failure)); }
          }}>Correct setter</Button>
          {!['scheduled','confirmed'].includes(item.status) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            setValue(''); setReason(''); setMode('correct_outcome');
          }}>Correct outcome</Button> : null}
        </div> : null}
        {mode ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void change(mode); }}>
          <label className="block space-y-1 text-sm">
            {mode === 'assign' || mode === 'correct_setter' ? 'Representative' : mode === 'cancel' ? 'Cancellation reason' : mode === 'correct_outcome' ? 'Outcome' : 'New date and time'}
            {mode === 'correct_outcome' ? <select className={selectClass} required value={value} onChange={event => setValue(event.target.value)}>
              <option value="">Choose outcome</option>
              {(['held','no_show','cancelled'] as const).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select> : mode === 'assign' || mode === 'correct_setter' ? <select aria-label="Representative" required className={selectClass} value={value}
              onChange={event => setValue(event.target.value)}>
              <option value="">Choose representative</option>
              {options?.representatives.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
            </select> : <Input required maxLength={1000} type={mode === 'reschedule' ? 'datetime-local' : 'text'}
              value={value} onChange={event => setValue(event.target.value)} />}
          </label>
          {mode.startsWith('correct_') ? <label className="block space-y-1 text-sm">Correction reason
            <Input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
          </label> : null}
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
        </form> : null}
        <details>
          <summary className="cursor-pointer text-sm">Appointment history</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {item.history.map(event => <li key={`${event.occurred_at}:${event.action}`}>
              {event.action.replaceAll('_', ' ')} · {new Date(event.occurred_at).toLocaleString()}
              {event.actor_name ? ` · ${event.actor_name}` : ''}
              {event.action === 'assign' && event.assignee_name ? ` · Assigned to ${event.assignee_name}` : ''}
              {event.action === 'correct_setter' && event.setter_name ? ` · Setter ${event.setter_name}` : ''}
              {event.reason ? ` · ${event.reason}` : ''}
            </li>)}
          </ul>
        </details>
      </> : <p role="status">Loading appointment…</p>}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
