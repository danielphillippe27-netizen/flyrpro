"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { minorUnits, salesCommand, useFieldSales } from "@/lib/field-sales/client";
export type SaleEntryContext = Record<string, string>;
type Entry = { capabilities?: Record<string, boolean>; enabled: boolean; needs_setup?: boolean; currency: string; today: string; verification_required: boolean; can_override_duplicate: boolean; has_more_appointments: boolean; appointment_options: { id: string; contact_id: string; name: string; address?: string; scheduled_at: string; note?: string }[]; selected?: { id: string; name: string; address?: string; rep_id: string; appointment_id: string; appointment_at: string; appointment_note?: string }; duplicates: { id: string; product: string; status: string; sold_on: string }[] };
const input = "w-full rounded-xl border bg-background px-3 py-2";
export function MarkAsSold({ workspace, initial = {}, close, saved }: { workspace: string; initial?: SaleEntryContext; close: () => void; saved: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState(initial);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: d, error, refresh } = useFieldSales<Entry>({}, false, "field_sales_entry", context);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label="Convert appointment to sale" className="m-auto max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-background p-6 backdrop:bg-black/40" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <header className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Convert appointment to sale</h2><button disabled={busy} onClick={close} aria-label="Close sale form">Close</button></header>
    {error && <p role="alert">{error} <button onClick={refresh}>Retry</button><button onClick={() => setContext({})}>Choose another appointment</button></p>}
    {!d && !error && <p>Loading sale details…</p>}
    {d && (d.needs_setup || !d.enabled) && <Link href="/sales">Set up Sales first</Link>}
    {d?.enabled && !d.needs_setup && (d.selected ? <SaleForm key={d.selected.appointment_id} workspace={workspace} data={d} busy={busy} setBusy={setBusy} saved={saved} change={() => setContext({})} /> : <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose a past appointment. Sales cannot be created directly from a lead.</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setContext({ search }); }}><label className="flex-1">Find an appointment<input className={input} value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, address or appointment note" /></label><button className="self-end rounded-xl border px-3 py-2">Search</button></form>
      <ul className="divide-y">{d.appointment_options.map(a => <li key={a.id}><button className="w-full py-3 text-left" onClick={() => setContext({ appointment_id: a.id, contact_id: a.contact_id })}><span className="font-medium">{a.name}</span><span className="block text-sm text-muted-foreground">{new Date(a.scheduled_at).toLocaleString()}{a.address ? ` · ${a.address}` : ""}</span>{a.note && <span className="block text-sm">{a.note}</span>}</button></li>)}</ul>
      {d.has_more_appointments && <p className="text-sm">Refine your search to find more appointments.</p>}{!d.appointment_options.length && <p>No eligible past appointments are waiting to be converted.</p>}
    </div>)}
  </dialog>;
}
function SaleForm({ workspace, data: d, busy, setBusy, saved, change }: { workspace: string; data: Entry; busy: boolean; setBusy: (b: boolean) => void; saved: (id: string) => void; change: () => void }) {
  const lead = d.selected!;
  const [amount, setAmount] = useState(""); const [product, setProduct] = useState(""); const [soldOn, setSoldOn] = useState(d.today); const [completion, setCompletion] = useState(""); const [notes, setNotes] = useState("");
  const [commission, setCommission] = useState("");
  const [job, setJob] = useState(""); const [override, setOverride] = useState("");
  const [request] = useState(() => crypto.randomUUID()); const [error, setError] = useState("");
  return <form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = await salesCommand(workspace, "submit", { request_id: request, contact_id: lead.id, appointment_id: lead.appointment_id, value_minor: minorUnits(amount, d.currency), ...(d.capabilities?.commission && commission.trim() ? { commission_minor: minorUnits(commission, d.currency) } : {}), product, sold_on: soldOn, expected_completion_on: completion || undefined, notes, ...(d.duplicates.length ? { job_identifier: job, duplicate_override_reason: override } : {}) });
      saved(result.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <div><p className="font-medium">{lead.name}</p>{lead.address && <p className="text-sm text-muted-foreground">{lead.address}</p>}<p className="text-sm text-muted-foreground">Appointment · {new Date(lead.appointment_at).toLocaleString()}</p>{lead.appointment_note && <p className="text-sm">{lead.appointment_note}</p>}<button type="button" disabled={busy} className="text-xs underline" onClick={change}>Choose another appointment</button></div>
    <label className="grid gap-2 font-medium">Contract value ({d.currency})<input className={`${input} text-2xl`} required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
    {d.duplicates.length > 0 && <section className="space-y-2 rounded-xl border border-amber-500 p-3"><p>An existing sale may already be associated with this customer.</p>{d.duplicates.map(s => <Link key={s.id} className="block text-sm underline" href={`/sales/${s.id}`}>{s.product || "Sale"} · {s.sold_on} · {s.status}</Link>)}{d.can_override_duplicate ? <><label className="grid gap-1 text-sm">Separate job identifier<input className={input} required value={job} onChange={e => setJob(e.target.value)} /></label><label className="grid gap-1 text-sm">Why is this a separate job?<input className={input} required value={override} onChange={e => setOverride(e.target.value)} /></label></> : <p className="text-sm">A manager can confirm a legitimate separate job.</p>}</section>}
    <details><summary className="cursor-pointer text-sm">Sale details</summary><div className="mt-3 space-y-3">
      {d.capabilities?.commission && <label className="grid gap-1 text-sm">Expected gross commission ({d.currency})<input className={input} inputMode="decimal" value={commission} onChange={e => setCommission(e.target.value)} placeholder="Optional" /><span className="text-xs text-muted-foreground">Counts toward the rep’s commission after verification. This is not a payment record.</span></label>}
      <label className="grid gap-1 text-sm">Product / service<input className={input} value={product} onChange={e => setProduct(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Sold date<input className={input} type="date" required max={d.today} value={soldOn} onChange={e => setSoldOn(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Expected completion<input className={input} type="date" min={soldOn} value={completion} onChange={e => setCompletion(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Notes<textarea className={input} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    </div></details>
    <p className="text-xs text-muted-foreground">{d.verification_required ? "The sale will await verification before it counts toward official totals." : "The sale will count toward official totals immediately."}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50" disabled={busy || (d.duplicates.length > 0 && !d.can_override_duplicate)}>{busy ? "Saving…" : "Confirm sale"}</button>
  </form>;
}
