"use client";

import Link from "next/link";
import { money, useFieldSales } from "@/lib/field-sales/client";

type CommissionHome = {
  enabled: boolean;
  needs_setup?: boolean;
  commission_visible?: boolean;
  currency?: string;
  week_start?: string;
  through?: string;
  weekly_sales?: number;
  weekly_commission_minor?: string;
  daily_commission_minor?: string;
  weekly_target_minor?: string;
  weekly_missing?: number;
  daily_missing?: number;
  note?: string;
};

export function ProSalesCommissionHome() {
  const { data, error, refresh } = useFieldSales<CommissionHome>(
    {},
    false,
    "field_sales_commission_home",
  );
  if (error) return <button className="text-sm text-muted-foreground" onClick={refresh}>Commission unavailable · Retry</button>;
  if (!data) return <p>Loading commission…</p>;
  if (!data.enabled) return null;
  if (data.needs_setup) return <Link href="/sales">Set up Sales to view commission →</Link>;

  const visible = data.commission_visible === true;
  const actual = Number(data.weekly_commission_minor ?? 0);
  const target = Number(data.weekly_target_minor ?? 0);
  const progress = target > 0 ? Math.min(100, Math.max(0, (actual / target) * 100)) : 0;
  const amount = (value?: string, missing?: number) => {
    if (!visible || (value === "0" && (missing ?? 0) > 0)) return "—";
    return money(value, data.currency);
  };

  return <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
    <header className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Commission</h2><p className="text-sm text-muted-foreground">{data.week_start} – {data.through}</p></div><Link className="text-sm underline" href="/sales/goals">Commission goals →</Link></header>
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
      <Metric label="Gross commission this week" value={amount(data.weekly_commission_minor, data.weekly_missing)} />
      <Metric label="Earned today" value={amount(data.daily_commission_minor, data.daily_missing)} />
      <Metric label="Verified sales this week" value={String(data.weekly_sales ?? 0)} />
    </div>
    {visible && data.weekly_target_minor !== undefined && <div className="space-y-2"><div className="flex justify-between text-sm"><span>Weekly commission goal</span><span className="tabular-nums">{money(data.weekly_target_minor, data.currency)}</span></div><progress aria-label="Weekly commission goal progress" className="h-2 w-full" max={100} value={progress} /></div>}
    {!visible && <p className="text-sm text-muted-foreground">Commission visibility is controlled by your workspace manager.</p>}
    {visible && (data.weekly_missing ?? 0) > 0 && <p className="text-sm text-muted-foreground">Commission is missing on {data.weekly_missing} verified {data.weekly_missing === 1 ? "sale" : "sales"}. Shown amounts include only recorded commission.</p>}
    {data.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}
