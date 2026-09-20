"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { minorUnits, money, salesCommand, salesChanged } from "@/lib/field-sales/client";

type SaleRecord = {
  id: string; version: number; currency: string; status: string; sold_on: string;
  rep_name_snapshot: string; campaign_name_snapshot?: string; team_name_snapshot?: string;
  product: string; notes: string; value_minor?: string; completed_value_minor?: string;
  collected_revenue_minor?: string; net_sold_value_minor?: string; expected_completion_on?: string;
  fulfillment_status: string; attribution_method: string; attribution_confidence: string;
  property_snapshot: { address?: string }; cancellation_reason?: string;
  can_verify: boolean; can_edit: boolean; can_attribute: boolean; can_complete: boolean; can_collect: boolean; can_cancel: boolean;
  credits: { user_id: string; rep_name: string; role: string; basis_points: number; credited_value_minor?: string; team_name?: string }[];
  payments: { id: string; kind: string; amount_minor: string; occurred_at: string; note: string }[];
  events: { id: string; action: string; actor: string; created_at: string; reason?: string }[];
  timeline: { id: string; kind: string; at: string; note?: string }[];
};

const field = "w-full rounded-xl border bg-background px-3 py-2.5";
const label = "grid gap-1.5 text-sm font-medium";
const dateText = (date: string) => date.slice(0, 10);

export function SaleRecordPanel({ saleId }: { saleId: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const [record, setRecord] = useState<SaleRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [scope, setScope] = useState("");
  useEffect(() => {
    const client = createClient();
    let active = true;
    let generation = 0;
    setRecord(null); setError(""); setScope(""); setLoading(true);
    async function load() {
      const ticket = ++generation;
      if (!currentWorkspaceId) { setLoading(false); return; }
      try {
        const { data: auth } = await client.auth.getSession();
        if (!auth.session) throw new Error("Sign in to view this sale.");
        const { data, error: failure } = await client.rpc("field_sales_record", { p_workspace: currentWorkspaceId, p_sale: saleId });
        if (!active || ticket !== generation) return;
        if (failure) throw failure;
        setRecord(data); setScope(currentWorkspaceId); setError("");
      } catch (failure) {
        if (active && ticket === generation) { setRecord(null); setError((failure as Error).message); }
      } finally { if (active && ticket === generation) setLoading(false); }
    }
    void load();
    const { data: subscription } = client.auth.onAuthStateChange(() => {
      ++generation; setRecord(null); setScope("");
      queueMicrotask(() => { if (active) void load(); });
    });
    const refresh = () => { if (active) void load(); };
    window.addEventListener(salesChanged, refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; subscription.subscription.unsubscribe(); window.removeEventListener(salesChanged, refresh); window.removeEventListener("focus", refresh); };
  }, [currentWorkspaceId, saleId, revision]);
  const s = scope === currentWorkspaceId ? record : null;
  if (loading) return <p className="p-6">Loading sale…</p>;
  if (error || !s || !currentWorkspaceId) return <div className="p-6 space-y-3"><p role="alert">{error || "Select a workspace."}</p><button onClick={() => setRevision(x => x + 1)}>Retry</button></div>;
  return (
    <main className="mx-auto max-w-5xl space-y-7 p-4 sm:p-8">
      <Link href="/sales" className="text-sm text-muted-foreground hover:underline">← Sales</Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight">{s.property_snapshot.address || s.product || "Sale details"}</h1><span className="rounded-full bg-muted px-3 py-1 text-sm capitalize">{s.status.replaceAll("_", " ")}</span></div>
        <p className="text-muted-foreground">{s.rep_name_snapshot} · {s.campaign_name_snapshot || "No campaign"} · {s.sold_on}</p>
        {s.cancellation_reason && <p className="text-sm">Reason: {s.cancellation_reason}</p>}
      </header>
      <section aria-label="Revenue" className="grid gap-3 sm:grid-cols-3">
        {[ ["Signed contract", s.value_minor], ["Completed value", s.completed_value_minor], ["Collected revenue", s.collected_revenue_minor] ].map(([title, value]) => <div key={title} className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{money(value, s.currency)}</p></div>)}
      </section>
      <p className="text-sm text-muted-foreground">Net eligible sold value: {money(s.net_sold_value_minor, s.currency)}. Collected revenue reflects recorded payments and refunds. Cancelling a contract does not record a cash refund.</p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <section className="space-y-4 rounded-2xl border p-5"><h2 className="font-semibold">Attribution</h2>
          <p className="text-sm text-muted-foreground">{s.attribution_method.replaceAll("_", " ")} · {s.attribution_confidence} evidence</p>
          {s.credits.map(c => <div key={c.user_id} className="flex justify-between gap-3 border-t pt-3"><div><p>{c.rep_name}</p><p className="text-sm capitalize text-muted-foreground">{c.role.replaceAll("_", " ")}{c.team_name ? ` · ${c.team_name}` : ""}</p></div><div className="text-right"><p>{c.basis_points / 100}% credit</p>{c.credited_value_minor !== undefined && <p className="text-sm">{money(c.credited_value_minor, s.currency)}</p>}</div></div>)}
          <p className="text-xs text-muted-foreground">Credit shares divide one contract. Company sold value counts it once.</p>
        </section>
        <section className="space-y-4 rounded-2xl border p-5"><h2 className="font-semibold">Job details</h2><dl className="grid grid-cols-2 gap-3 text-sm"><dt>Product / service</dt><dd>{s.product || "Not specified"}</dd><dt>Fulfillment</dt><dd className="capitalize">{s.fulfillment_status.replaceAll("_", " ")}</dd><dt>Expected completion</dt><dd>{s.expected_completion_on || "Not scheduled"}</dd></dl>{s.notes && <p className="whitespace-pre-wrap text-sm">{s.notes}</p>}</section>
      </div>
      <SaleActionForm key={`${currentWorkspaceId}:${s.id}:${s.version}`} workspace={currentWorkspaceId} sale={s} />
      <section className="space-y-3"><h2 className="text-lg font-semibold">Property timeline</h2><ol className="space-y-3 border-l pl-5">{s.timeline.map((entry, i) => <li key={`${entry.kind}:${entry.id}:${i}`}><p className="capitalize">{entry.kind.replaceAll("_", " ")} <span className="text-sm text-muted-foreground">· {dateText(entry.at)}</span></p>{entry.note && <p className="text-sm text-muted-foreground">{entry.note}</p>}</li>)}</ol></section>
      {s.payments.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">Payment ledger</h2>{s.payments.map(p => <div key={p.id} className="flex justify-between rounded-xl border p-4"><div><p className="capitalize">{p.kind}</p><p className="text-sm text-muted-foreground">{dateText(p.occurred_at)}{p.note ? ` · ${p.note}` : ""}</p></div><p className="font-medium tabular-nums">{money(p.amount_minor, s.currency)}</p></div>)}</section>}
      <details className="rounded-2xl border p-5"><summary className="cursor-pointer font-semibold">Audit history</summary><ol className="mt-4 space-y-4">{s.events.map(e => <li key={e.id} className="text-sm"><p>{e.actor} · {e.action.replaceAll("_", " ")} · {dateText(e.created_at)}</p>{e.reason && <p className="text-muted-foreground">{e.reason}</p>}</li>)}</ol></details>
    </main>
  );
}

function SaleActionForm({ workspace, sale }: { workspace: string; sale: SaleRecord }) {
  const actions = [
    ...(sale.can_verify ? [["verify", "Verify sale"], ["reject", "Reject submission"]] : []),
    ...(sale.can_complete ? [["complete", "Record completion"]] : []),
    ...(sale.can_collect ? [...(sale.status === "verified" ? [["collect", "Record payment"]] : []), ["refund_payment", "Record payment refund"], ["chargeback_payment", "Record payment chargeback"]] : []),
    ...(sale.can_cancel ? [["cancel", "Cancel sale"]] : []),
  ];
  const [action, setAction] = useState(actions[0]?.[0] || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  if (!actions.length) return null;
  const payment = ["collect", "refund_payment", "chargeback_payment"].includes(action);
  return <form className="space-y-4 rounded-2xl border p-5" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const payload = { id: sale.id, version: sale.version, reason, ...(payment ? { amount_minor: minorUnits(amount, sale.currency), occurred_at: new Date(date).toISOString(), note: reason } : {}), ...(action === "complete" ? { completed_on: date } : {}) };
      const fingerprint = JSON.stringify({ action, payload });
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      await salesCommand(workspace, action, { ...payload, request_id: request.current.id });
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }}>
    <h2 className="font-semibold">Update sale</h2>
    <div className="grid gap-4 sm:grid-cols-2"><label className={label}>Action<select className={field} value={action} onChange={e => { setAction(e.target.value); setDate(""); setError(""); }}>{actions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      {payment && <label className={label}>Amount ({sale.currency})<input className={field} inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /></label>}
      {(payment || action === "complete") && <label className={label}>{payment ? "Payment time (your device timezone)" : "Completion date"}<input className={field} type={payment ? "datetime-local" : "date"} required value={date} onChange={e => setDate(e.target.value)} /></label>}
      <label className={label}>{["cancel", "reject"].includes(action) ? "Reason" : "Note (optional)"}<input className={field} required={["cancel", "reject"].includes(action)} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button disabled={busy} className="rounded-xl bg-primary px-5 py-2.5 text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : actions.find(([value]) => value === action)?.[1]}</button>
  </form>;
}
