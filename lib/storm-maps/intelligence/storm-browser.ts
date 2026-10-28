import { canonicalWindTime, type WindCountry } from './wind-archive-format';
export const DEFAULT_WIND_STORM_MINIMUM = 93.341952;
export type WindStormDay = { date: string; peakTime: string; latestTime: string; maximumKPH: number; hours: number; regions:string[] };
type WindHour = { source_time: string; captured_at?: string; metadata: { maximumGustKPH?: unknown; windRegions?:unknown } };
export function qualifyingWindRegions(value:unknown,minimum=DEFAULT_WIND_STORM_MINIMUM):string[]{
 if(!Array.isArray(value))return [];
 return [...new Set(value.filter((region):region is {name:string;maximumKPH:number}=>!!region&&typeof region.name==='string'&&region.name.length<=100&&typeof region.maximumKPH==='number'&&Number.isFinite(region.maximumKPH)&&region.maximumKPH>=minimum&&region.maximumKPH<=360).map(region=>region.name))].sort();
}
/** A daily map summary, not a claim that each hour/day is a distinct storm. */
export function recentWindDays(rows: WindHour[], minimum = DEFAULT_WIND_STORM_MINIMUM): WindStormDay[] {
  const seen = new Set<string>(), days = new Map<string, WindStormDay>();
  const ordered = [...rows].sort((a,b)=>b.source_time.localeCompare(a.source_time)||(b.captured_at??'').localeCompare(a.captured_at??''));
  for (const row of ordered) {
    let time: string; try { time=canonicalWindTime(row.source_time); } catch { continue; }
    if(seen.has(time))continue;seen.add(time);
    const gust=row.metadata?.maximumGustKPH;
    if(typeof gust!=='number'||!Number.isFinite(gust)||gust<minimum||gust>360)continue;
    const date=time.slice(0,10), prior=days.get(date),regions=qualifyingWindRegions(row.metadata.windRegions,minimum);
    if(!prior)days.set(date,{date,peakTime:time,latestTime:time,maximumKPH:gust,hours:1,regions});
    else {prior.regions=[...new Set([...prior.regions,...regions])].sort();prior.hours++;if(time>prior.latestTime)prior.latestTime=time;if(gust>prior.maximumKPH||(gust===prior.maximumKPH&&time>prior.peakTime)){prior.maximumKPH=gust;prior.peakTime=time;}}
  }
  return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
export function stormBrowserDefaults(query: URLSearchParams): {country:WindCountry;type:'hail'|'wind'} {
  const country=query.get('country');
  return {country:country==='CA'||country==='US'||country==='AU'?country:query.get('region')==='au'?'AU':'CA',type:query.get('type')==='hail'?'hail':query.get('type')==='wind'||query.get('region')==='wind'?'wind':'hail'};
}
export function recentMapDates(now=new Date(), days=7) {
  return Array.from({length:days},(_,offset)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-offset)).toISOString().slice(0,10));
}
