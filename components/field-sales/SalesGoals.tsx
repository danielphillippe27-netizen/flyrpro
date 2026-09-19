"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { minorUnits, money, salesChanged, useFieldSales } from "@/lib/field-sales/client";

const labels: Record<string, string> = { doors: "Doors", conversations: "Conversations", leads: "Leads", appointments: "Appointments", sales: "Sales", sold_value: "Sold value", collected_revenue: "Collected revenue", commission: "Commission", close_rate: "Close rate", appointments_converted: "Appointments converted" };
type Goal = { id: string; version: number; title: string; scope: string; scope_id: string | null; metric: string; unit: string; target: string; actual?: string | null; remaining?: string; progress_percent?: string; starts_on: string; ends_on: string; pace: string; required_daily?: string; required_weekly?: string; projected?: string; projection_note?: string; archived: boolean };
type Option = { id: string; name: string };
type Snapshot = { enabled: boolean; needs_setup?: boolean; currency: string; timezone: string; user_id: string; goals: Goal[]; has_more: boolean; definitions: string; goal_permissions: Record<string, boolean>; goal_options: { representatives: Option[]; teams: Option[]; campaigns: Option[] }; goal_periods: { key: string; start: string; end: string }[] };
const input = "rounded-xl border bg-background px-3 py-2";
const isMoney = (metric: string) => ["sold_value", "collected_revenue", "commission"].includes(metric);

async function command(workspace: string, action: string, data: Record<string, unknown>) {
  const result = await createClient().rpc("field_sales_target_command", { p_workspace: workspace, p_action: action, p_data: data });
  if (result.error) throw result.error;
  window.dispatchEvent(new Event(salesChanged));
}
export function SalesGoals() {
  const scope = useFieldSales({}, true);
  if (scope.error) return <p role="alert">{scope.error}</p>;
  if (!scope.data) return <p>Loading goals…</p>;
  return <GoalsContent key={`${scope.workspaceId}:${scope.data.user_id}`} workspace={scope.workspaceId!} />;
}
function GoalsContent({ workspace }: { workspace: string }) {
  const [offset, setOffset] = useState(0);
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<Goal | "new" | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: d, error, refresh } = useFieldSales<Snapshot>({}, false, "field_sales_target_list", { offset, limit: 50, archived: String(archived) });
  const value = (g: Goal, amount?: string | null) => amount == null ? "—" : g.unit === "money" ? money(amount, d?.currency) : amount + (g.unit === "percent" ? "%" : "");
  if (error) return <p role="alert">{error} <button onClick={refresh}>Retry</button></p>;
  if (!d) return <p>Loading goals…</p>;
  if (!d.enabled || d.needs_setup) return <Link href="/sales">Set up Sales to create goals →</Link>;
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <Link href="/sales" className="text-sm text-muted-foreground">← Sales</Link>
    <header className="flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">Goals & pace</h1><p className="text-sm text-muted-foreground">Calendar periods use {d.timezone}.</p></div><button className={input} onClick={() => setEditor("new")}>Create goal</button></header>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setOffset(0); }} />Show archived goals</label>
    {actionError && <p role="alert">{actionError}</p>}
    <div className="grid gap-4 md:grid-cols-2">{d.goals.map(g => <section key={g.id} className="space-y-3 rounded-2xl border p-5">
      <div><h2 className="font-semibold">{g.title}</h2><p className="text-sm text-muted-foreground">{g.scope} · {labels[g.metric]} · {g.starts_on} – {g.ends_on}</p></div>
      <p className="text-2xl font-semibold tabular-nums">{value(g, g.actual)} <span className="text-sm font-normal text-muted-foreground">/ {value(g, g.target)}</span></p>
      {g.progress_percent !== undefined && <><progress className="h-2 w-full" max={100} value={Math.max(0, Math.min(100, Number(g.progress_percent)))} aria-label={`${g.title} progress`} /><p className="text-sm">{g.progress_percent}% · {value(g, g.remaining)} remaining</p></>}
      <p className="text-sm capitalize">{g.pace.replaceAll("_", " ")}</p>
      {g.required_daily !== undefined && <p className="text-sm">Required: {value(g, g.required_daily)}/day · {value(g, g.required_weekly)} over the next seven days or remaining period</p>}
      {g.projected !== undefined && <p className="text-sm">Projected at current pace: {value(g, g.projected)}</p>}
      {g.projection_note && <p className="text-xs text-muted-foreground">{g.projection_note}</p>}
      <div className="flex gap-4 text-sm"><button disabled={busy} onClick={() => setEditor(g)}>Edit</button><button disabled={busy} onClick={async () => { setBusy(true); setActionError(""); try { await command(workspace, g.archived ? "restore" : "archive", { id: g.id, version: g.version }); } catch (e) { setActionError((e as Error).message); } finally { setBusy(false); } }}>{g.archived ? "Restore" : "Archive"}</button></div>
    </section>)}</div>
    {!d.goals.length && <p>No {archived ? "archived" : "visible"} goals yet.</p>}
    <div className="flex gap-4"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button disabled={!d.has_more} onClick={() => setOffset(offset + 50)}>Next</button></div>
    <p className="text-xs text-muted-foreground">{d.definitions}</p>
    {editor && <GoalEditor key={editor === "new" ? "new" : editor.id} workspace={workspace} data={d} goal={editor === "new" ? undefined : editor} close={() => setEditor(null)} />}
  </main>;
}
function GoalEditor({ workspace, data: d, goal, close }: { workspace: string; data: Snapshot; goal?: Goal; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [scope, setScope] = useState(goal?.scope ?? "rep");
  const [scopeId, setScopeId] = useState(goal?.scope_id ?? d.user_id);
  const [metric, setMetric] = useState(goal?.metric ?? "sales");
  const [title, setTitle] = useState(goal?.title ?? "");
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: d.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const initialAmount = goal ? (goal.unit === "money" ? (() => { const n = BigInt(goal.target); const scale = BigInt(10) ** BigInt(digits); return `${n / scale}${digits ? `.${String(n % scale).padStart(digits, "0")}` : ""}`; })() : goal.target) : "";
  const [amount, setAmount] = useState(initialAmount);
  const [start, setStart] = useState(goal?.starts_on ?? d.goal_periods[1].start);
  const [end, setEnd] = useState(goal?.ends_on ?? d.goal_periods[1].end);
  const [request] = useState(() => crypto.randomUUID());
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const options = scope === "team" ? d.goal_options.teams : scope === "campaign" ? d.goal_options.campaigns : d.goal_options.representatives;
  const moneyAllowed = scope === "rep" && scopeId === d.user_id ? d.goal_permissions.own_revenue : d.goal_permissions.team_revenue;
  const metrics = Object.keys(labels).filter(m => m === "commission" ? d.goal_permissions.commission : !isMoney(m) || moneyAllowed);
  return <dialog ref={dialog} aria-label={goal ? "Edit goal" : "Create goal"} className="m-auto max-h-[90vh] w-full max-w-xl overflow-y-auto bg-transparent p-4 backdrop:bg-black/40" onCancel={e => { e.preventDefault(); if (!busy) close(); }}><form className="mx-auto my-8 max-w-lg space-y-4 rounded-2xl bg-background p-6 shadow-xl" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const target = isMoney(metric) ? minorUnits(amount, d.currency) : amount;
      await command(workspace, goal ? "update" : "create", { ...(goal ? { id: goal.id, version: goal.version } : { request_id: request, scope, scope_id: scope === "workspace" ? null : scopeId, metric }), title, target, starts_on: start, ends_on: end }); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <h2 className="text-xl font-semibold">{goal ? "Edit goal" : "Create goal"}</h2>
    <label className="grid gap-1">Title<input className={input} required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
    {!goal && <><label className="grid gap-1">Scope<select className={input} value={scope} onChange={e => { const v = e.target.value; setScope(v); setScopeId(v === "rep" ? d.user_id : v === "team" ? d.goal_options.teams[0]?.id ?? "" : v === "campaign" ? d.goal_options.campaigns[0]?.id ?? "" : ""); setMetric("sales"); }}><option value="rep">Individual rep</option>{d.goal_permissions.manage_team && <><option value="team">Team</option><option value="workspace">Workspace</option><option value="campaign">Campaign</option></>}</select></label>
      {scope !== "workspace" && <label className="grid gap-1">{scope}<select className={input} required value={scopeId} onChange={e => { setScopeId(e.target.value); setMetric("sales"); }}><option value="" disabled>Select {scope}</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      <label className="grid gap-1">Metric<select className={input} value={metric} onChange={e => { setMetric(e.target.value); setAmount(""); }}>{metrics.map(m => <option key={m} value={m}>{labels[m]}</option>)}</select></label></>}
    <label className="grid gap-1">Target {isMoney(metric) ? `(${d.currency})` : metric === "close_rate" ? "(%)" : ""}<input className={input} required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
    <div className="flex gap-3">{d.goal_periods.map(p => <button type="button" key={p.key} className="text-sm capitalize" onClick={() => { setStart(p.start); setEnd(p.end); }}>This {p.key}</button>)}</div>
    <label className="grid gap-1">From<input className={input} required type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label className="grid gap-1">Through<input className={input} required type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-4"><button type="button" disabled={busy} onClick={close}>Cancel</button><button disabled={busy || start > end} className="rounded-xl bg-primary px-4 py-2 text-primary-foreground">{busy ? "Saving…" : "Save goal"}</button></div>
  </form></dialog>;
}
