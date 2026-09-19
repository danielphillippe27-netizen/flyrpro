"use client";
import { useState } from "react";
import Link from "next/link";
import { money, useFieldSales } from "@/lib/field-sales/client";

type Drilldown = { enabled: boolean; currency: string; timezone: string; total_records: number; has_more: boolean; rows: {id:string;contact_id?:string;sale_id?:string;label:string;occurred_at:string;converted?:boolean;value_minor?:string}[] };
export function FunnelDrilldown({filter,stage,onClose}:{filter:Record<string,string|number>;stage:string;onClose:()=>void}) {
  const [offset,setOffset]=useState(0);
  const {data,error,loading}=useFieldSales<Drilldown>({},false,"field_sales_drilldown",{...filter,limit:50,offset},stage);
  return <section className="rounded-2xl border bg-background p-5 space-y-4" aria-label={`${stage.replaceAll("_"," ")} records`}>
    <header className="flex justify-between gap-3"><h2 className="text-lg font-semibold capitalize">{stage.replaceAll("_"," ")} · {data?.total_records??"…"}</h2><button onClick={onClose} className="text-sm underline">Close records</button></header>
    {error ? <p role="alert">{error}</p> : loading || !data ? <p>Loading records…</p> : <>
      {!data.rows.length && <p className="text-sm text-muted-foreground">No records in this period.</p>}
      <ul className="divide-y">{data.rows.map(row=><li className="py-3" key={row.id}><div className="flex justify-between gap-3"><div>{row.sale_id ? <Link href={`/sales/${row.sale_id}`} className="font-medium underline">{row.label}</Link> : row.contact_id ? <Link href={`/leads/${row.contact_id}`} className="font-medium underline">{row.label}</Link> : <p className="font-medium">{row.label}</p>}<p className="text-xs text-muted-foreground">{new Date(row.occurred_at).toLocaleString(undefined,{timeZone:data.timezone})} · {data.timezone}</p>{row.converted ? <p className="text-xs text-muted-foreground">Linked verified sale</p> : null}</div>{row.value_minor!==undefined && <p className="tabular-nums">{money(row.value_minor,data.currency)}</p>}</div></li>)}</ul>
      <div className="flex gap-4"><button disabled={offset===0} onClick={()=>setOffset(x=>Math.max(0,x-50))}>Previous</button><button disabled={!data.has_more} onClick={()=>setOffset(x=>x+50)}>Next</button></div>
    </>}
  </section>;
}
