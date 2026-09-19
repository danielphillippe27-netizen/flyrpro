"use client";
import { useState } from "react";
import Link from "next/link";
import { FunnelDrilldown } from "./FunnelDrilldown";
import { useFieldSales, money } from "@/lib/field-sales/client";

type Summary = { sales: number; pending_sales: number; cancelled_sales: number; sold_value_minor?: string; gross_sold_minor?: string; cancellations_minor?: string; average_ticket_minor?: string; completed_value_minor?: string; collected_revenue_minor?: string };
type Pipeline = { available: boolean; note: string; count?: number; value_minor?: string; missing_values?: number; stalled?: number; stages?: {key:string;label:string;count:number;value_minor?:string;missing_values:number;stalled:number}[]; losses?: {reason:string;count:number;percent:string}[] };
type Report = {
  enabled: boolean; needs_setup?: boolean; currency: string; timezone: string;
  capabilities: Record<string, boolean>; period_start: string; period_end: string; previous_start: string; previous_end: string;
  current_pipeline?: Pipeline;
  summary: Summary; previous: Summary; change_percent: Record<string,string | null>;
  metrics: { available: boolean; doors: number | null; conversations: number | null; leads: number | null; appointments: number | null; appointments_completed: number | null; opportunities: number | null; close_rate: string | null; revenue_per_door_minor: string | null };
  metric_notes: string; as_of: string; total_records: number; has_more: boolean;
  sales: { id: string; rep_name: string; product: string; status: string; sold_on: string; value_minor?: string; campaign_name?: string }[];
  groups: { id: string | null; name: string; sales: number; sold_value_minor?: string; average_ticket_minor?: string }[];
  options: { representatives: { id: string; name: string }[]; campaigns: { id: string; name: string }[]; teams: { id: string; name: string }[]; territories: { id: string; name: string }[]; products: string[] };
  financial_definitions: Record<string,string>;
};
const input="rounded-xl border bg-background px-3 py-2 text-sm";
export function ProSalesReport({embedded=false}:{embedded?:boolean}) {
  const {data,error,loading,refresh,workspaceId}=useFieldSales({},true);
  if(error) return <div className="p-6"><p role="alert">{error}</p><button onClick={refresh}>Retry</button></div>;
  if(!data) return <p className="p-6">{loading?"Loading performance…":"Select a workspace."}</p>;
  if(!data.enabled) return <p className="p-6">Sales is not enabled for this workspace.</p>;
  return <ProSalesReportContent key={`${workspaceId}:${data.user_id}`} embedded={embedded} initialScope={embedded && data.capabilities?.team_details ? "team" : "self"}/>;
}
function ProSalesReportContent({embedded,initialScope}:{embedded:boolean;initialScope:string}) {
  const [stage,setStage]=useState<string|null>(null);
  const [filter,setFilter]=useState<Record<string,string | number>>({period:"month",scope:initialScope,dimension:"campaign",limit:50,offset:0});
  const [startDraft,setStartDraft]=useState("");
  const [endDraft,setEndDraft]=useState("");
  const {data:d,error,loading,refresh}=useFieldSales<Report>({},false,"field_sales_report",filter);
  const set=(key:string,value:string)=>setFilter(f=>({...f,[key]:value,offset:0}));
  if(error) return <div className="p-6"><p role="alert">{error}</p><button onClick={refresh}>Retry</button></div>;
  if(!d) return <p className="p-6">{loading?"Loading performance…":"Select a workspace."}</p>;
  if(!d.enabled || d.needs_setup) return <div className="p-6"><Link href="/sales">Set up Sales to view performance →</Link></div>;
  const cards: [string,string,string][]=[
    ["Net sold",money(d.summary.sold_value_minor,d.currency),"sold_value_minor"],
    ["Sales",String(d.summary.sales),"sales"],
    ["Average ticket",d.summary.average_ticket_minor===undefined && d.summary.sold_value_minor!==undefined?"—":money(d.summary.average_ticket_minor,d.currency),"average_ticket_minor"],
    ["Close rate",d.metrics.close_rate==null?"Unavailable":`${d.metrics.close_rate}%`,"close_rate"],
    ["Open pipeline",d.current_pipeline?.available?money(d.current_pipeline.value_minor,d.currency):"Unavailable","pipeline"],
    ["Completed",money(d.summary.completed_value_minor,d.currency),"completed_value_minor"],
    ["Collected",money(d.summary.collected_revenue_minor,d.currency),"collected_revenue_minor"],
  ];
  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    {!embedded && <Link href="/sales" className="text-sm text-muted-foreground">← Sales</Link>}
    <Link href="/sales/leaderboards" className="ml-4 text-sm underline">Team leaderboards →</Link>
    <header><h1 className="text-3xl font-semibold tracking-tight">Sales performance</h1><p className="mt-1 text-sm text-muted-foreground">{d.period_start} – {d.period_end} · {d.timezone} · {d.currency}</p></header>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Period<select className={input} value={filter.period} onChange={e=>{ if(e.target.value==="custom") { setStartDraft(d.period_start);setEndDraft(d.period_end);setFilter(f=>({...f,period:"custom",start:d.period_start,end:d.period_end,offset:0})); } else set("period",e.target.value); }}>{[["today","Today"],["yesterday","Yesterday"],["week","This week"],["previous_week","Last week"],["month","This month"],["previous_month","Last month"],["quarter","This quarter"],["year","This year"],["all","All time"],["custom","Custom"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {filter.period==="custom" && <><label className="grid gap-1 text-sm">From<input className={input} type="date" value={startDraft} onChange={e=>setStartDraft(e.target.value)}/></label><label className="grid gap-1 text-sm">Through<input className={input} type="date" value={endDraft} onChange={e=>setEndDraft(e.target.value)}/></label><button className={input} disabled={!startDraft || !endDraft || startDraft>endDraft} onClick={()=>setFilter(f=>({...f,start:startDraft,end:endDraft,offset:0}))}>Apply dates</button></>}
      {d.capabilities.team_details && <label className="grid gap-1 text-sm">View<select className={input} value={filter.scope} onChange={e=>set("scope",e.target.value)}><option value="self">My performance</option><option value="team">Workspace performance</option></select></label>}
      {filter.scope==="team" && <OptionFilter title="Representative" name="rep" options={d.options.representatives} filter={filter} set={set}/>}
      <OptionFilter title="Campaign" name="campaign" options={d.options.campaigns} filter={filter} set={set}/>
      <OptionFilter title="Territory" name="territory" options={d.options.territories} filter={filter} set={set}/>
      <OptionFilter title="Source" name="source" options={["door_knock","qr","manual","referral","inbound","crm","other"].map(x=>({id:x,name:x.replaceAll("_"," ")}))} filter={filter} set={set}/>
      <OptionFilter title="Team at sale" name="team" options={d.options.teams} filter={filter} set={set}/>
      <OptionFilter title="Product / service" name="product" options={d.options.products.map(p=>({id:p,name:p}))} filter={filter} set={set}/>
      <OptionFilter title="Status" name="status" options={["pending","verified","cancelled","rejected","refunded","charged_back"].map(p=>({id:p,name:p.replaceAll("_"," ")}))} filter={filter} set={set}/>
    </div>
    {d.capabilities.export && <button className={input} onClick={()=>exportPage(d)}>Export displayed sales</button>}
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Sales metrics">{cards.slice(0,5).map(([label,value,key])=><article key={key} className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>{d.change_percent[key]!=null && <p className="mt-2 text-xs text-muted-foreground">{Number(d.change_percent[key])>0?"+":""}{d.change_percent[key]}% vs previous period</p>}</article>)}</section>
    <section className="grid gap-3 sm:grid-cols-2" aria-label="Completed and collected">{cards.slice(5).map(([label,value,key])=><article key={key} className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>{d.change_percent[key]!=null && <p className="mt-2 text-xs text-muted-foreground">{d.change_percent[key]}% vs previous period</p>}</article>)}</section>
    {d.current_pipeline && <PipelineSummary data={d.current_pipeline} currency={d.currency}/>}
    <div className="flex gap-4 text-sm"><button className="underline" onClick={()=>setStage("sales")}>Inspect verified sales</button><button className="underline" onClick={()=>setStage("completed")}>Inspect completed jobs</button><button className="underline" onClick={()=>setStage("collected")}>Inspect payments</button></div>
    <p className="text-sm text-muted-foreground">Comparison: {d.previous_start} – {d.previous_end}. Sold uses contract date; completed uses completion date; collected uses payment date.</p>
    <section className="rounded-2xl border p-5"><div className="flex flex-wrap gap-x-8 gap-y-3 text-sm"><p>Gross sold <strong>{money(d.summary.gross_sold_minor,d.currency)}</strong></p><p>Cancellations <strong>{money(d.summary.cancellations_minor,d.currency)}</strong></p><p>Pending <strong>{d.summary.pending_sales}</strong></p><p>Close rate <strong>{d.metrics.close_rate==null?"Unavailable":`${d.metrics.close_rate}%`}</strong></p></div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Field activity</h2>{d.metrics.available ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["Doors",d.metrics.doors,"doors"],["Conversations",d.metrics.conversations,"conversations"],["Leads",d.metrics.leads,"leads"],["Appointments",d.metrics.appointments,"appointments"],["Completed appointments",d.metrics.appointments_completed,"appointments_completed"],["Opportunities",d.metrics.opportunities,"opportunities"]].map(([label,value,kind])=><button type="button" onClick={()=>setStage(String(kind))} key={String(label)} className="rounded-xl bg-muted/50 p-4 text-left hover:bg-muted" aria-label={`Inspect ${label}`}><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></button>)}</div>:null}<p className="max-w-4xl text-sm text-muted-foreground">{d.metric_notes}</p></section>
    {stage && <FunnelDrilldown key={`${stage}:${JSON.stringify(filter)}`} filter={filter} stage={stage} onClose={()=>setStage(null)}/>}
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Revenue breakdown</h2><label className="flex items-center gap-2 text-sm">Group by<select className={input} value={filter.dimension} onChange={e=>set("dimension",e.target.value)}>{["campaign","territory","team","product","source"].map(x=><option key={x}>{x}</option>)}</select></label></div><div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{["Group","Sales","Net sold","Average ticket"].map(x=><th className="p-4" key={x}>{x}</th>)}</tr></thead><tbody>{d.groups.map((g,i)=><tr className="border-t" key={g.id??`unassigned-${i}`}><td className="p-4">{g.name}</td><td className="p-4">{g.sales}</td><td className="p-4">{money(g.sold_value_minor,d.currency)}</td><td className="p-4">{g.sales?money(g.average_ticket_minor,d.currency):"—"}</td></tr>)}</tbody></table></div></section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Sales · {d.total_records}</h2>{!d.sales.length && <p className="text-sm text-muted-foreground">No sales match these filters.</p>}<div className="divide-y rounded-2xl border">{d.sales.map(s=><Link key={s.id} href={`/sales/${s.id}`} className="flex justify-between gap-4 p-4 hover:bg-muted/40"><div><p className="font-medium">{s.rep_name} · {s.product||"Sale"}</p><p className="text-sm text-muted-foreground">{s.sold_on} · {s.status} · {s.campaign_name||"Unassigned campaign"}</p></div><p className="font-medium tabular-nums">{money(s.value_minor,d.currency)}</p></Link>)}</div><div className="flex gap-3"><button className={input} disabled={Number(filter.offset)===0} onClick={()=>setFilter(f=>({...f,offset:Math.max(0,Number(f.offset)-50)}))}>Previous</button><button className={input} disabled={!d.has_more} onClick={()=>setFilter(f=>({...f,offset:Number(f.offset)+50}))}>Next</button></div></section>
    <details className="text-sm"><summary className="cursor-pointer font-medium">How these numbers are calculated</summary><dl className="mt-3 space-y-3">{Object.entries(d.financial_definitions).map(([key,value])=><div key={key}><dt className="font-medium capitalize">{key}</dt><dd className="text-muted-foreground">{value}</dd></div>)}</dl></details>
  </main>;
}
function OptionFilter({title,name,options,filter,set}:{title:string;name:string;options:{id:string;name:string}[];filter:Record<string,string|number>;set:(key:string,value:string)=>void}) {
  return <label className="grid gap-1 text-sm">{title}<select className={input} value={filter[name]??""} onChange={e=>set(name,e.target.value)}><option value="">All</option>{options.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
}

function exportPage(d: Report) {
  const escape = (raw: string) => '"' + (/^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw).replaceAll('"', '""') + '"';
  const rows = [["Sale ID","Sold date","Status","Representative","Campaign","Product","Attributed value (minor units)","Currency"], ...d.sales.map(s=>[s.id,s.sold_on,s.status,s.rep_name,s.campaign_name??"",s.product,s.value_minor??"",d.currency])];
  const url = URL.createObjectURL(new Blob([rows.map(row=>row.map(escape).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href=url; link.download=`sales-page-${d.period_start}-${d.period_end}.csv`; link.click(); URL.revokeObjectURL(url);
}

function PipelineSummary({data:p,currency}:{data:Pipeline;currency:string}) {
  return <section className="space-y-3 rounded-2xl border p-5" aria-label="Current pipeline">
    <h2 className="text-lg font-semibold">Current pipeline</h2>
    <p className="text-sm text-muted-foreground">{p.note}</p>
    {p.available && <>
      <p className="text-sm">{p.count} open opportunities · {p.stalled} unchanged for 72 hours · {p.missing_values} without a value</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{p.stages?.map(s=><article className="rounded-xl bg-muted/50 p-3" key={s.key}><h3 className="font-medium">{s.label}</h3><p>{s.count} opportunities · {money(s.value_minor,currency)}</p>{s.stalled>0 && <p className="text-sm text-muted-foreground">{s.stalled} unchanged for 72 hours</p>}</article>)}</div>
      {!!p.losses?.length && <div><h3 className="font-medium">Current loss reasons</h3><ul className="mt-2 space-y-1 text-sm">{p.losses.map(l=><li key={l.reason}>{l.reason.replaceAll("_"," ")} · {l.count} ({l.percent}%)</li>)}</ul></div>}
    </>}
    <Link className="text-sm underline" href="/sales/opportunities">Open pipeline &amp; follow-ups →</Link>
  </section>;
}
