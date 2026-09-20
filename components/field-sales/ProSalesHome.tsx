"use client";
import Link from "next/link";
import { money, useFieldSales } from "@/lib/field-sales/client";

type Summary = { sales: number; sold_value_minor?: string; completed_value_minor?: string; collected_revenue_minor?: string };
type Goal = { id: string; title: string; unit: string; target: string; actual?: string | null; progress_percent?: string; remaining?: string; required_daily?: string; pace: string };
type Rank = { rep_name: string; rank: number; value: string };
type Home = { enabled: boolean; needs_setup?: boolean; scope: string; currency: string; week_start: string; through: string; weekly: Summary; monthly: Summary; daily: Summary; activity: { doors: number; conversations: number; leads: number; appointments: number; close_rate: string | null }; active_goals: Goal[]; pending_review: number; latest_sale?: { id: string; rep_name: string; sold_on: string; value_minor?: string }; ranking: { metric: string | null; unit: string | null; self?: Rank; top?: Rank }; notes: string };
const rankingNames: Record<string, string> = { sales: "sales", sold_value: "sold value", collected_revenue: "collected revenue", doors: "doors", conversations: "conversations", appointments: "appointments", leads: "leads", close_rate: "close rate", setters: "setter sales", closers: "closer sales" };
export function ProSalesHome() {
  const { data: d, error, refresh } = useFieldSales<Home>({}, false, "field_sales_home");
  if (error) return <button onClick={refresh}>Sales unavailable · Retry</button>;
  if (!d) return <p>Loading performance…</p>;
  if (!d.enabled) return null;
  if (d.needs_setup) return <Link href="/sales">Set up Sales to view performance →</Link>;
  const manager = d.scope === "workspace";
  const goalValue = (g: Goal, n?: string | null) => n == null ? "—" : g.unit === "money" ? money(n, d.currency) : n + (g.unit === "percent" ? "%" : "");
  return <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
    <header className="flex justify-between gap-4"><div><h2 className="text-xl font-semibold">{manager ? "Team performance" : "This week"}</h2><p className="text-sm text-muted-foreground">{d.week_start} – {d.through}</p></div><Link className="text-sm underline" href="/sales/reports">Full report →</Link></header>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Metric label="Sold this week" value={d.weekly.sold_value_minor === undefined ? "Private" : money(d.weekly.sold_value_minor, d.currency)} />
      <Metric label="Sales this week" value={String(d.weekly.sales)} />
      <Metric label="Sales today" value={String(d.daily.sales)} />
      <Metric label="Close rate" value={d.activity.close_rate === null ? "—" : `${d.activity.close_rate}%`} />
    </div>
    {manager && <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Metric label="Sales this month" value={String(d.monthly.sales)} /><Metric label="Sold this month" value={money(d.monthly.sold_value_minor, d.currency)} /><Metric label="Completed this month" value={money(d.monthly.completed_value_minor, d.currency)} /><Metric label="Collected this month" value={money(d.monthly.collected_revenue_minor, d.currency)} /></div>}
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{([['Doors', d.activity.doors], ['Conversations', d.activity.conversations], ['Leads', d.activity.leads], ['Appointments', d.activity.appointments]] as const).map(([label, count]) => <p key={label}><strong className="tabular-nums">{count}</strong> {label}</p>)}</div>
    {d.active_goals.map(g => <Link href="/sales/goals" key={g.id} className="block space-y-2 rounded-xl bg-muted/40 p-4"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{g.title}</span><span className="tabular-nums">{goalValue(g, g.actual)} / {goalValue(g, g.target)}</span></div>{g.progress_percent !== undefined && <progress aria-label={`${g.title} progress`} className="h-2 w-full" max={100} value={Math.max(0, Math.min(100, Number(g.progress_percent)))} />}<p className="text-sm text-muted-foreground">{g.progress_percent !== undefined ? `${g.progress_percent}% · ${goalValue(g, g.remaining)} remaining` : "Waiting for enough evidence"}{g.required_daily !== undefined ? ` · ${goalValue(g, g.required_daily)}/day required` : ""}</p></Link>)}
    {!d.active_goals.length && <Link className="text-sm underline" href="/sales/goals">Set a {manager ? "workspace" : "personal"} goal →</Link>}
    <div className="flex flex-wrap gap-4 text-sm">
      {d.ranking.self && <Link href="/sales/leaderboards">Your rank: {d.ranking.self.rank} · {rankingNames[d.ranking.metric ?? ""] ?? d.ranking.metric}</Link>}
      {manager && d.ranking.top && Number(d.ranking.top.value) > 0 && <Link href="/sales/leaderboards">Top this week: {d.ranking.top.rep_name} · Rank {d.ranking.top.rank}</Link>}
      {d.pending_review > 0 && <Link href="/sales">{d.pending_review} pending {manager ? "review" : "verification"} →</Link>}
    </div>
    {d.latest_sale && <Link href={`/sales/${d.latest_sale.id}`} className="block text-sm text-muted-foreground">Latest verified sale: {d.latest_sale.rep_name} · {d.latest_sale.sold_on}{d.latest_sale.value_minor !== undefined ? ` · ${money(d.latest_sale.value_minor, d.currency)}` : ""} →</Link>}
    <Link href="/campaigns" className="block rounded-xl bg-primary px-4 py-3 text-center font-medium text-primary-foreground">Start / open campaign</Link>
    <p className="text-xs text-muted-foreground">{d.notes}</p>
  </section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>; }
