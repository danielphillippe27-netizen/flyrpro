import Link from 'next/link';
import { campaignStormSchema, type StormCampaignContext } from '@/lib/storm-maps/intelligence/model';
export function StormCampaignSummary({context}:{context:StormCampaignContext}){
  const parsed=campaignStormSchema.safeParse(context);if(!parsed.success)return null;
  const data=parsed.data;
  const query=new URLSearchParams({storm:data.event.key,stormFrom:data.event.start.slice(0,10),stormTo:data.event.end.slice(0,10)});
  return <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">Storm campaign</p><h3 className="mt-1 font-semibold">{data.event.title}</h3><p className="mt-1 text-xs text-muted-foreground">{data.event.start.slice(0,10)} · {data.event.source.toUpperCase()} · User-drawn inspection area{data.minimumHailMM?` · Report filter ${data.minimumHailMM.toFixed(1)} mm+`:''}</p><p className="mt-2 text-xs text-muted-foreground">Selection saved {new Date(data.selectedAt).toLocaleString()}. Weather exposure does not confirm damage to individual properties.</p><Link className="mt-2 inline-block text-sm text-cyan-700 underline dark:text-cyan-300" href={`/campaigns/create?${query}`}>Reopen storm evidence</Link></section>;
}
