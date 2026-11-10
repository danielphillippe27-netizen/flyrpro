'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/lib/workspace-context';
import { appointmentError, appointmentRpc, type AppointmentOptions } from '@/lib/field-sales/appointments';
import { minorUnits, money } from '@/lib/field-sales/client';

const select = 'w-full rounded-md border bg-background p-2 text-sm';
const label = 'block space-y-1 text-sm';
const human = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());

type Earning = {
  id: string; version: number; kind: string; status: string; amount_minor: string;
  basis_minor?: string; currency: string; representative: string; representative_id: string;
  accrued_at: string; paid_at?: string; payment_reference?: string; source_label?: string;
  sale_id?: string; appointment_id?: string; plan_title?: string; plan_version?: number;
  calculation: { rate_bps?: number; reason?: string; applied_share_bps?: number };
};
type Rule = { kind: string; amount: string; split: boolean };
type Earnings = {
  enabled: boolean; actor_id: string; currency: string; can_manage: boolean; can_publish: boolean; count: number;
  unresolved_plan_count?: number;
  summary: Record<string, string | number>;
  entries: Earning[];
  plans?: { id: string; title: string; role: string; effective_on: string; version: number }[];
};

export function EarningsPage() {
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  if (!currentWorkspaceId) return <p className="p-6">Select a workspace.</p>;
  return <EarningsContent key={currentWorkspaceId} workspace={currentWorkspaceId}
    manager={['owner','admin','manager'].includes(membershipsByWorkspaceId[currentWorkspaceId] ?? '')} />;
}

function EarningsContent({ workspace, manager }: { workspace: string; manager: boolean }) {
  const [team, setTeam] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('');
  const [dateMode, setDateMode] = useState('accrued');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Earnings>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState("");
  useEffect(() => { setSale(new URLSearchParams(window.location.search).get("sale") ?? ""); }, []);
  const filters = JSON.stringify({ team, date_mode: dateMode, start_on: start || undefined,
    end_on: end || undefined, status: status || undefined, sale_id: sale || undefined });
  const params = useCallback((page: number) => ({
    p_workspace: workspace, p_filter: { ...JSON.parse(filters), offset: page },
  }), [filters, workspace]);
  const load = useCallback(async () => {
    try {
      setData(await appointmentRpc<Earnings>('field_earnings_list', params(offset)));
      setError('');
    } catch (error) { setError(appointmentError(error)); }
  }, [offset, params]);
  useEffect(() => {
    let active = true;
    appointmentRpc<Earnings>('field_earnings_list', params(offset))
      .then(value => { if (active) { setData(value); setError(''); } })
      .catch(error => { if (active) { setData(undefined); setError(appointmentError(error)); } });
    return () => { active = false; };
  }, [offset, params]);

  async function exportStatement() {
    setBusy(true);
    try {
      const rows: Earning[] = [];
      let page = 0;
      let batch: Earnings;
      do {
        batch = await appointmentRpc<Earnings>('field_earnings_list', params(page));
        rows.push(...batch.entries);
        page += batch.entries.length;
      } while (batch.entries.length === 100 && page < batch.count);
      const quote = (value: unknown) => {
        const text = String(value ?? '');
        return '"' + (/^[=+@\-\t\r]/.test(text) && !/^-?\d+$/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
      };
      const csv = [
        ['Earning ID','Representative','Kind','Status','Currency','Minor units','Accrued','Paid','Payment reference','Sale','Appointment','Plan','Plan version'],
        ...rows.map(entry => [entry.id, entry.representative, entry.kind, entry.status, entry.currency,
          entry.amount_minor, entry.accrued_at, entry.paid_at, entry.payment_reference, entry.sale_id,
          entry.appointment_id, entry.plan_title, entry.plan_version]),
      ].map(row => row.map(quote).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'wolfgrid-earnings.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(appointmentError(failure)); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl space-y-5 p-5">
    <Link href="/sales" className="text-sm underline">Back to Sales</Link>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{team ? 'Team earnings' : 'My Earnings'}</h1>
      {manager ? <Button variant="outline" onClick={() => { setTeam(value => !value); setOffset(0); }}>
        {team ? 'My Earnings' : 'Manage team earnings'}
      </Button> : null}
    </header>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    {!data && !error ? <p>Loading earnings…</p> : null}
    {data?.enabled === false ? <p>Earnings are unavailable for this workspace.</p> : null}
    {data?.enabled ? <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Earnings filters">
        <label className={label}>From<Input type="date" value={start} onChange={e => { setStart(e.target.value); setOffset(0); }} /></label>
        <label className={label}>To<Input type="date" min={start || undefined} value={end} onChange={e => { setEnd(e.target.value); setOffset(0); }} /></label>
        <label className={label}>Date basis<select className={select} value={dateMode} onChange={e => { setDateMode(e.target.value); setOffset(0); }}>
          <option value="accrued">Accrued date</option><option value="paid">Paid date</option>
        </select></label>
        <label className={label}>Status<select className={select} value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">All statuses</option>{['pending','approved','paid','rejected'].map(value => <option key={value} value={value}>{human(value)}</option>)}
        </select></label>
        {team ? <label className={label}>Sale ID (optional)<Input value={sale} onChange={e => { setSale(e.target.value); setOffset(0); }} /></label> : null}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Earnings totals">
        {Object.entries({ total_minor: 'Total earnings', pending_minor: 'Pending', approved_minor: 'Approved unpaid',
          paid_minor: 'Paid', adjustments_minor: 'Adjustments and reversals' }).map(([key, text]) =>
          <div key={key} className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">{text}</p>
            <p className="text-2xl font-semibold tabular-nums">{money(String(data.summary[key]), data.currency)}</p></div>)}
      </section>
      <p className="text-sm text-muted-foreground">{data.summary.sales} credited sales · {data.summary.appointments} credited appointments</p>
      {team ? <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy} onClick={() => void exportStatement()}>Export statement</Button>
        {!!data.unresolved_plan_count ? <p className="text-sm text-muted-foreground">{data.unresolved_plan_count} missing plan assignments need review.</p> : null}
      </div> : null}
      {data.can_publish ? <PlanEditor workspace={workspace} currency={data.currency} onSaved={load} /> : null}
      {data.can_manage ? <ManualEarning workspace={workspace} currency={data.currency} onSaved={load} /> : null}
      {team && data.plans?.length ? <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Published plan versions</summary>
        <ul className="mt-2 space-y-1 text-sm">{data.plans.map(plan => <li key={plan.id}>
          {plan.title} · {human(plan.role)} · Version {plan.version} · Effective {plan.effective_on}
        </li>)}</ul>
      </details> : null}
      {!data.entries.length ? <p className="text-muted-foreground">No earnings in this view.</p> : null}
      <ul className="space-y-2">
        {data.entries.map(entry => <li key={entry.id} className="rounded-lg border p-3">
          <details><summary className="cursor-pointer">
            <span className="font-semibold">{money(entry.amount_minor, entry.currency)}</span>
            {' · '}{human(entry.kind)}{' · '}{human(entry.status)}
            {team ? ` · ${entry.representative}` : ''}{entry.source_label ? ` · ${entry.source_label}` : ''}
          </summary>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Accrued</dt><dd>{new Date(entry.accrued_at).toLocaleString()}</dd>
            {entry.paid_at ? <><dt>Paid</dt><dd>{new Date(entry.paid_at).toLocaleString()} · {entry.payment_reference}</dd></> : null}
            {entry.plan_title ? <><dt>Plan</dt><dd>{entry.plan_title} · v{entry.plan_version}</dd></> : null}
            {entry.basis_minor ? <><dt>Calculation basis</dt><dd>{money(entry.basis_minor, entry.currency)}
              {entry.calculation.rate_bps ? ` at ${entry.calculation.rate_bps / 100}%` : ''}</dd></> : null}
            {entry.calculation.reason ? <><dt>Reason</dt><dd>{entry.calculation.reason}</dd></> : null}
            {entry.sale_id ? <><dt>Sale</dt><dd><Link className="underline" href={`/sales/${entry.sale_id}`}>View sale</Link></dd></> : null}
            {entry.appointment_id ? <><dt>Appointment</dt><dd><Link className="underline" href={`/appointments?booking=${entry.appointment_id}`}>View appointment</Link></dd></> : null}
          </dl>
          {data.can_manage && data.actor_id !== entry.representative_id && ['pending','approved'].includes(entry.status) ?
            <ReviewEarning key={entry.version} workspace={workspace} entry={entry} onSaved={load} /> : null}
        </details></li>)}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous</Button>
        <Button variant="outline" disabled={offset + 100 >= data.count} onClick={() => setOffset(value => value + 100)}>Next</Button>
      </div>
    </> : null}
  </main>;
}

function useEarningMutation(workspace: string, onSaved: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  async function run(action: string, data: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const fingerprint = JSON.stringify([action, data]);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      await appointmentRpc('field_earnings_command', { p_workspace: workspace, p_action: action,
        p_data: { ...data, request_id: request.current.id } });
      request.current = null;
      await onSaved();
      return true;
    } catch (failure) { setError(appointmentError(failure)); }
    finally { setBusy(false); }
  }
  return { run, busy, error };
}

function ReviewEarning({ workspace, entry, onSaved }: { workspace: string; entry: Earning; onSaved: () => Promise<void> }) {
  const [action, setAction] = useState(entry.status === 'pending' ? 'approve' : 'settle');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  const [paidNow, setPaidNow] = useState(true);
  const mutation = useEarningMutation(workspace, onSaved);
  return <form className="mt-3 space-y-2" onSubmit={event => {
    event.preventDefault();
    void mutation.run(action, { id: entry.id, version: entry.version, reason,
      paid_now: action === 'settle' ? paidNow : undefined,
      paid_at: !paidNow && paidAt ? new Date(paidAt).toISOString() : undefined, payment_reference: reference });
  }}>
    {entry.status === 'pending' && entry.kind !== 'reversal' ? <label className={label}>Review decision
      <select className={select} value={action} onChange={e => setAction(e.target.value)}>
        <option value="approve">Approve</option><option value="reject">Reject</option>
      </select></label> : null}
    {action === 'reject' ? <label className={label}>Reason<Input required value={reason} onChange={e => setReason(e.target.value)} /></label> : null}
    {action === 'settle' ? <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paidNow}
        onChange={e => setPaidNow(e.target.checked)} />Use the current payment time</label>
      {!paidNow ? <label className={label}>Paid date and time<Input type="datetime-local" step={1} required
        value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label> : null}
      <label className={label}>External payment reference<Input required maxLength={250} value={reference} onChange={e => setReference(e.target.value)} /></label>
    </> : null}
    {mutation.error ? <p role="alert" className="text-destructive">{mutation.error}</p> : null}
    <Button disabled={mutation.busy}>{action === 'settle' ? 'Mark paid' : human(action)}</Button>
  </form>;
}

function useRepresentatives(workspace: string) {
  const [reps, setReps] = useState<AppointmentOptions['representatives']>([]);
  useEffect(() => {
    let active = true;
    appointmentRpc<AppointmentOptions>('field_appointment_options', { p_workspace: workspace })
      .then(value => { if (active) setReps(value.representatives); })
      .catch(() => { if (active) setReps([]); });
    return () => { active = false; };
  }, [workspace]);
  return reps;
}

function PlanEditor({ workspace, currency, onSaved }: { workspace: string; currency: string; onSaved: () => Promise<void> }) {
  const mutation = useEarningMutation(workspace, onSaved);
  const reps = useRepresentatives(workspace);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('setter');
  const [rep, setRep] = useState('');
  const [date, setDate] = useState('');
  const [rules, setRules] = useState<Rule[]>([{ kind: 'held_fee', amount: '', split: false }]);
  const [validation, setValidation] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setValidation('');
      const values = rules.map(rule => {
        if (rule.kind.endsWith('_percent')) {
          const rate = Number(rule.amount);
          if (!/^\d+(\.\d{1,2})?$/.test(rule.amount) || rate <= 0 || rate > 100) throw new Error('Enter a rate between 0.01% and 100%.');
          const [whole, fraction = ''] = rule.amount.split('.');
          const basisPoints = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0')));
          return { kind: rule.kind, rate_bps: basisPoints, split: rule.split ? 'sale_credit' : 'none' };
        }
        return { kind: rule.kind, amount_minor: minorUnits(rule.amount, currency), split: rule.split ? 'sale_credit' : 'none' };
      });
      if (await mutation.run('publish_plan', { title, role, representative_id: rep || undefined, effective_on: date,
        rules: values, allow_multiple_rules: values.length > 1 })) setTitle('');
    } catch (error) { setValidation(appointmentError(error)); }
  }
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Publish commission plan version</summary>
    <form className="mt-3 space-y-3" onSubmit={submit}>
      <label className={label}>Plan title<Input required value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className={label}>Role<select className={select} value={role} onChange={e => {
        setRole(e.target.value); setRules([{ kind: e.target.value === 'setter' ? 'held_fee' : 'cash_percent', amount: '', split: false }]);
      }}>{['setter','closer','full_cycle','contributor'].map(value => <option key={value} value={value}>{human(value)}</option>)}</select></label>
      <label className={label}>Representative<select className={select} value={rep} onChange={e => setRep(e.target.value)}>
        <option value="">Workspace role default</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
      </select></label>
      <label className={label}>Effective date<Input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
      {rules.map((rule, index) => {
        const set = (patch: Partial<Rule>) => setRules(current => current.map((value, i) => i === index ? { ...value, ...patch } : value));
        return <fieldset key={index} className="space-y-2 rounded-md border p-2">
          <legend className="text-sm">Rule {index + 1}</legend>
          <label className={label}>Calculation<select className={select} value={rule.kind} onChange={e => set({ kind: e.target.value, split: false })}>
            {role === 'setter' ? <option value="held_fee">Fixed held appointment fee</option> : null}
            <option value="sale_fee">Fixed verified sale fee</option>
            <option value="contract_percent">Percentage of contract</option>
            <option value="cash_percent">Percentage of collected cash</option>
          </select></label>
          <label className={label}>{rule.kind.endsWith('_percent') ? 'Rate (%)' : `Amount (${currency})`}
            <Input required inputMode="decimal" value={rule.amount} onChange={e => set({ amount: e.target.value })} /></label>
          {rule.kind !== 'held_fee' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox"
            checked={rule.split} onChange={e => set({ split: e.target.checked })} />Apply the rep’s sale credit share</label> : null}
          {index > 0 ? <Button type="button" variant="ghost" onClick={() => setRules(current => current.filter((_, i) => i !== index))}>Remove rule</Button> : null}
        </fieldset>;
      })}
      <Button type="button" variant="outline" disabled={rules.length >= 10}
        onClick={() => setRules(current => [...current, { kind: 'sale_fee', amount: '', split: false }])}>Add another rule</Button>
      {validation || mutation.error ? <p role="alert" className="text-destructive">{validation || mutation.error}</p> : null}
      <Button disabled={mutation.busy}>Publish version</Button>
    </form>
  </details>;
}

function ManualEarning({ workspace, currency, onSaved }: { workspace: string; currency: string; onSaved: () => Promise<void> }) {
  const mutation = useEarningMutation(workspace, onSaved);
  const reps = useRepresentatives(workspace);
  const [kind, setKind] = useState('adjustment');
  const [source, setSource] = useState('sale_id');
  const [id, setId] = useState('');
  const [rep, setRep] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Add bonus or adjustment</summary>
    <form className="mt-3 space-y-3" onSubmit={async event => {
      event.preventDefault();
      try {
        setValidation('');
        const negative = amount.trim().startsWith('-');
        const value = minorUnits(amount.trim().replace(/^-/, ''), currency);
        if (await mutation.run(kind, { [source]: id, representative_id: rep || undefined,
          amount_minor: negative ? '-' + value : value, reason })) { setAmount(''); setReason(''); }
      } catch (failure) { setValidation(appointmentError(failure)); }
    }}>
      <label className={label}>Type<select className={select} value={kind} onChange={e => setKind(e.target.value)}>
        <option value="adjustment">Adjustment</option><option value="bonus">Bonus</option>
      </select></label>
      <label className={label}>Linked record<select className={select} value={source} onChange={e => { setSource(e.target.value); setId(''); }}>
        <option value="sale_id">Sale</option><option value="appointment_id">Appointment</option>
        <option value="original_earning_id">Original earning</option>
      </select></label>
      <label className={label}>Record ID<Input required value={id} onChange={e => setId(e.target.value)} /></label>
      {source !== 'original_earning_id' ? <label className={label}>Representative<select className={select} required value={rep} onChange={e => setRep(e.target.value)}>
        <option value="">Choose representative</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
      </select></label> : null}
      <label className={label}>Amount ({currency})<Input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className={label}>Reason<Input required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {validation || mutation.error ? <p role="alert" className="text-destructive">{validation || mutation.error}</p> : null}
      <Button disabled={mutation.busy}>Add pending entry</Button>
    </form>
  </details>;
}
