"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money, salesChanged, useFieldSales } from "@/lib/field-sales/client";

export const rankingLabels: Record<string,string> = {sales:"Sales",sold_value:"Sold value",collected_revenue:"Collected revenue",appointments:"Appointments",leads:"Leads",doors:"Doors",conversations:"Conversations",close_rate:"Close rate",setters:"Setters",closers:"Closers",average_ticket:"Average credited value",lead_conversion:"Lead conversion",sales_per_100_doors:"Sales per 100 doors",revenue_per_100_doors:"Revenue per 100 doors",sales_cycle:"Fastest sales cycle"};
type Ranking = {enabled:boolean;needs_setup?:boolean;currency:string;metric:string;unit:string;categories:string[];message?:string;definition:string;period_start:string;period_end:string;minimum_opportunities:number;below_threshold_or_unavailable:number;has_more:boolean;role:string;
  settings?:{leaderboard_categories:string[];minimum_close_opportunities:number;featured_ranking:string};
  rows:{rep_id:string;rep_name:string;rank:number;value:string;metrics:Record<string,string>}[];
  options?:{products:string[];campaigns:{id:string;name:string}[];teams:{id:string;name:string}[];territories:{id:string;name:string}[]};};
const input="rounded-xl border bg-background px-3 py-2 text-sm";
export function ProSalesLeaderboard({embedded=false}:{embedded?:boolean}) {
  const scope=useFieldSales({},true);
  if(scope.error) return <p role="alert">{scope.error}</p>;
  if(!scope.data) return <p>Loading leaderboards…</p>;
  if(!scope.data.enabled) return <p>Sales is not enabled for this workspace.</p>;
  return <LeaderboardContent key={`${scope.workspaceId}:${scope.data.user_id}`} workspace={scope.workspaceId!} embedded={embedded}/>;
}
function LeaderboardContent({workspace,embedded}:{workspace:string;embedded:boolean}) {
  const [metric,setMetric]=useState("");
  const [filter,setFilter]=useState<Record<string,string|number>>({period:"month",offset:0,limit:100});
  const [start,setStart]=useState("");const [end,setEnd]=useState("");
  const {data:d,error,loading,refresh}=useFieldSales<Ranking>({},false,"field_sales_leaderboard",filter,metric||undefined);
  const set=(key:string,value:string)=>{if(key==="product"||key==="source")setMetric("");setFilter(f=>({...f,[key]:value,offset:0}));};
  if(error) return <div><p role="alert">{error}</p><button onClick={()=>{setMetric("");setFilter({period:"month",offset:0,limit:100});refresh();}}>Reset filters</button></div>;
  if(!d) return <p>{loading?"Loading leaderboards…":"Select a workspace."}</p>;
  if(d.needs_setup) return <Link href="/sales">Set up Sales →</Link>;
  return <section className={embedded?"space-y-4 rounded-2xl border p-5":"mx-auto max-w-6xl space-y-5 p-4 sm:p-8"}>
    {!embedded && <Link href="/sales" className="text-sm text-muted-foreground">← Sales</Link>}
    <header><h1 className="text-2xl font-semibold tracking-tight">Team leaderboards</h1><p className="text-sm text-muted-foreground">{d.period_start} – {d.period_end}</p></header>
    {d.message ? <p>{d.message}</p> : <>
      <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm">Category<select className={input} value={d.metric} onChange={e=>{setMetric(e.target.value);set("offset","0");}}>{d.categories.map(c=><option key={c} value={c}>{rankingLabels[c]??c}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Period<select className={input} value={filter.period} onChange={e=>{const v=e.target.value;if(v==="custom"){setStart(d.period_start);setEnd(d.period_end);setFilter(f=>({...f,period:v,start:d.period_start,end:d.period_end,offset:0}));}else set("period",v);}}>{[["today","Today"],["yesterday","Yesterday"],["week","This week"],["previous_week","Last week"],["month","This month"],["previous_month","Last month"],["quarter","This quarter"],["year","This year"],["all","All time"],["custom","Custom"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        {filter.period==="custom" && <><label className="grid gap-1 text-sm">From<input className={input} type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="grid gap-1 text-sm">Through<input className={input} type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><button className={input} disabled={!start||!end||start>end} onClick={()=>setFilter(f=>({...f,start,end,offset:0}))}>Apply dates</button></>}
        {([["campaign","Campaign",d.options?.campaigns],["territory","Territory",d.options?.territories],["team","Team at sale",d.options?.teams]] as const).map(([key,title,options])=><label className="grid gap-1 text-sm" key={key}>{title}<select className={input} value={filter[key]??""} onChange={e=>set(key,e.target.value)}><option value="">All</option>{options?.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}
        <label className="grid gap-1 text-sm">Product / service<select className={input} value={filter.product??""} onChange={e=>set("product",e.target.value)}><option value="">All</option>{d.options?.products.map(p=><option key={p}>{p}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Source<select className={input} value={filter.source??""} onChange={e=>set("source",e.target.value)}><option value="">All</option>{["door_knock","qr","manual","referral","inbound","crm","other"].map(p=><option key={p} value={p}>{p.replaceAll("_"," ")}</option>)}</select></label>
      </div>
      {d.below_threshold_or_unavailable>0 && <p className="text-sm text-muted-foreground">{d.below_threshold_or_unavailable} representatives have insufficient evidence for this category. Minimum for conversion and sales-cycle rankings: {d.minimum_opportunities}.</p>}
      <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr><th className="p-4">Rank</th><th className="p-4">Representative</th><th className="p-4">{rankingLabels[d.metric]}</th><th className="p-4">Sales</th><th className="p-4">Sales trend</th></tr></thead><tbody>{d.rows.map(row=><tr className="border-t" key={row.rep_id}><td className="p-4 tabular-nums">{row.rank}</td><td className="p-4 font-medium">{row.rep_name}</td><td className="p-4 tabular-nums">{d.unit==="money"?money(row.value,d.currency):row.value+(d.unit==="percent"?"%":d.unit==="days"?" days":"")}</td><td className="p-4">{row.metrics.sales??"—"}</td><td className="p-4">{row.metrics.sales_change_percent===undefined?"—":`${Number(row.metrics.sales_change_percent)>0?"+":""}${row.metrics.sales_change_percent}%`}</td></tr>)}</tbody></table></div>
      {!d.rows.length && <p>No representatives have enough evidence for this ranking yet.</p>}
      <div className="flex gap-4"><button disabled={Number(filter.offset)===0} onClick={()=>setFilter(f=>({...f,offset:Math.max(0,Number(f.offset)-100)}))}>Previous</button><button disabled={!d.has_more} onClick={()=>setFilter(f=>({...f,offset:Number(f.offset)+100}))}>Next</button></div>
      <p className="text-xs text-muted-foreground">{d.definition}</p>
    </>}
    {d.settings && <RankingSettings key={JSON.stringify(d.settings)} workspace={workspace} settings={d.settings} onSaved={()=>setMetric("")}/>}
  </section>;
}
function RankingSettings({workspace,settings,onSaved}:{workspace:string;settings:NonNullable<Ranking["settings"]>;onSaved:()=>void}) {
  const [categories,setCategories]=useState(settings.leaderboard_categories);const [minimum,setMinimum]=useState(String(settings.minimum_close_opportunities));const [featured,setFeatured]=useState(settings.featured_ranking);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  return <details><summary className="cursor-pointer text-sm font-medium">Manage leaderboards</summary><form className="mt-4 space-y-4" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{const {error}=await createClient().rpc("field_sales_ranking_settings",{p_workspace:workspace,p_categories:categories,p_minimum:Number(minimum),p_featured:featured});if(error)throw error;onSaved();window.dispatchEvent(new Event(salesChanged));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <fieldset className="grid gap-2 sm:grid-cols-3"><legend className="mb-2 text-sm">Visible categories</legend>{Object.entries(rankingLabels).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={categories.includes(key)} onChange={e=>setCategories(c=>e.target.checked?[...c,key]:c.filter(x=>x!==key))}/>{label}</label>)}</fieldset>
    <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm">Minimum opportunities<input className={input} type="number" min={1} max={1000} required value={minimum} onChange={e=>setMinimum(e.target.value)}/></label><label className="grid gap-1 text-sm">Featured ranking<select className={input} value={featured} onChange={e=>setFeatured(e.target.value)}>{["sales","sold_value","collected_revenue"].map(x=><option key={x} value={x}>{rankingLabels[x]}</option>)}</select></label></div>
    {error && <p role="alert">{error}</p>}<button className="rounded-xl bg-primary px-4 py-2 text-primary-foreground" disabled={busy}>{busy?"Saving…":"Save leaderboard settings"}</button>
  </form></details>;
}
