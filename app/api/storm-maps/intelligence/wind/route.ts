import { recentWindDays, qualifyingWindRegions } from '@/lib/storm-maps/intelligence/storm-browser';
import { NextRequest, NextResponse } from 'next/server';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { dateWindow } from '@/lib/storm-maps/intelligence/model';
import { WIND_PRODUCT, windCountry } from '@/lib/storm-maps/intelligence/wind-archive-format';
import { windArchiveHealth } from '@/lib/storm-maps/intelligence/wind-archive-history';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const context = await stormContext(request); if ('response' in context) return context.response;
  const params = request.nextUrl.searchParams, country = params.get('country');
  if (!windCountry(country)) return NextResponse.json({ error: 'Choose Canada, United States or Australia.' }, { status: 400 });
  let range;
  try { range = dateWindow(params.get('from') ?? '', params.get('to') ?? '', 31); }
  catch { return NextResponse.json({ error: 'Choose a date range of up to 31 days.' }, { status: 400 }); }
  try {
    const [{ data, error }, first, health] = await Promise.all([
      context.admin.from('storm_archive_assets').select('source_time,metadata,captured_at').eq('provider', 'xweather').eq('product', WIND_PRODUCT).eq('metadata->>country', country).gte('source_time', range.start).lt('source_time', range.end).order('source_time', { ascending: false }).order('captured_at', {ascending:false}).limit(1000),
      context.admin.from('storm_archive_assets').select('source_time').eq('provider', 'xweather').eq('product', WIND_PRODUCT).eq('metadata->>country', country).order('source_time').limit(1).maybeSingle(),
      windArchiveHealth(),
    ]);
    if (error || first.error) throw Error('Wind archive unavailable.');
    const minimum=Number(params.get('minimum')??'0');
    if(![0,40,60,93.341952,120,160].includes(minimum))return NextResponse.json({error:'Invalid wind threshold.'},{status:400});
    const indexed=(data??[]).filter(row=>row.metadata?.windMaskVersion===2).map(row=>{
      if(country!=='US'||!Array.isArray(row.metadata?.windRegions))return row;
      const windRegions=row.metadata.windRegions.filter((region:{name?:string})=>region?.name!=='Alaska');
      const maximumGustKPH=Math.max(0,...windRegions.map((region:{maximumKPH?:number})=>typeof region?.maximumKPH==='number'&&Number.isFinite(region.maximumKPH)?region.maximumKPH:0));
      return {...row,metadata:{...row.metadata,windRegions,maximumGustKPH}};
    });
    const matching=indexed.filter(row=>typeof row.metadata?.maximumGustKPH==='number'&&row.metadata.maximumGustKPH>=minimum);
    const unindexed=(data??[]).filter(row=>row.metadata?.windMaskVersion!==2||typeof row.metadata?.maximumGustKPH!=='number');
    return NextResponse.json({ regionsByTime:Object.fromEntries([...indexed].reverse().map(row=>[new Date(row.source_time).toISOString(),qualifyingWindRegions(row.metadata?.windRegions,minimum)])), days: recentWindDays(indexed,minimum), matchingHours: matching.length, indexingPending: unindexed.length>0, times: [...new Set((minimum ? [...matching].sort((a,b)=>b.source_time.localeCompare(a.source_time)) : indexed).map(row => new Date(row.source_time).toISOString()))], archiveStartsAt: first.data?.source_time ?? null, health,
      coverage: 'Saved hourly Xweather gridded wind-gust estimates for the selected region. Values are regional estimates, not station measurements at every property or proof of damage.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return stormError(error); }
}
