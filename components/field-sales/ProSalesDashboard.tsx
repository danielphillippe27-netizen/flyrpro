"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MarkAsSold, type SaleEntryContext } from "./MarkAsSold";
import { ProSalesCommissionHome } from "./ProSalesCommissionHome";
import { ProSalesHome } from "./ProSalesHome";
import { ProSalesLeaderboard } from "./ProSalesLeaderboard";
import { ProSalesReport } from "./ProSalesReport";
export function ProSalesDashboard({ workspace, settings }: { workspace: string; settings?: ReactNode }) {
  const search = useSearchParams();
  const [entryContext, setEntryContext] = useState<SaleEntryContext>(() => {
    const appointment = search.get("appointment");
    const lead = search.get("lead");
    return appointment ? { appointment_id: appointment, ...(lead ? { contact_id: lead } : {}) } : {};
  });
  const [recording, setRecording] = useState(() => Object.keys(entryContext).length > 0);
  const [saved, setSaved] = useState<string | null>(null);
  const [section, setSection] = useState<"overview" | "performance" | "leaderboards">("overview");
  return <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">Sales</h1><button className="rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground" onClick={() => { setEntryContext({}); setRecording(true); }}>Convert appointment</button></header>
    <nav aria-label="Sales views" className="flex flex-wrap gap-2 rounded-xl bg-muted/50 p-1 text-sm">
      {([['overview','Overview'],['performance','Performance'],['leaderboards','Leaderboards']] as const).map(([value,label]) => <button key={value} className={`rounded-lg px-4 py-2 ${section===value?'bg-background font-medium shadow-sm':''}`} aria-pressed={section===value} onClick={()=>setSection(value)}>{label}</button>)}
      <Link className="rounded-lg px-4 py-2" href="/sales/opportunities">Pipeline & follow-ups</Link><Link className="rounded-lg px-4 py-2" href="/sales/goals">Goals & pace</Link>
    </nav>
    {saved && <p role="status" className="rounded-xl border p-3">Sale saved. <Link className="underline" href={`/sales/${saved}`}>Open sale →</Link></p>}
    {section === "overview" && <div className="grid items-start gap-4 lg:grid-cols-2"><ProSalesHome/><ProSalesCommissionHome/></div>}
    {section === "performance" && <ProSalesReport embedded />}
    {section === "leaderboards" && <ProSalesLeaderboard embedded />}
    {settings && <details><summary className="cursor-pointer text-sm">Sales settings</summary>{settings}</details>}
    {recording && <MarkAsSold workspace={workspace} initial={entryContext} close={() => { setEntryContext({}); setRecording(false); }} saved={id => { setSaved(id); setEntryContext({}); setRecording(false); }} />}
  </div>;
}
