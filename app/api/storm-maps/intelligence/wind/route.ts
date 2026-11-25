import { recentWindDays, qualifyingWindRegions } from '@/lib/storm-maps/intelligence/storm-browser';
import { NextRequest, NextResponse } from 'next/server';
import { isStormCountry } from '@/lib/storm-maps/storm-countries';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { dateWindow } from '@/lib/storm-maps/intelligence/model';
import { PUBLIC_WIND_PROVIDER, WIND_PRODUCT } from '@/lib/storm-maps/intelligence/wind-archive-format';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const context = await stormContext(request); if ('response' in context) return context.response;
  const params = request.nextUrl.searchParams, country = params.get('country');
  if (!isStormCountry(country)) return NextResponse.json({ error: 'Choose Canada or the United States.' }, { status: 400 });
  let range;
  try { range = dateWindow(params.get('from') ?? '', params.get('to') ?? '', 31); }
  catch { return NextResponse.json({ error: 'Choose a date range of up to 31 days.' }, { status: 400 }); }
  try {
    const includeLegacy = params.get('legacy') === '1';
    const archive = () => context.admin.from('storm_archive_assets').select('provider,source_time,metadata,captured_at')
      .in('provider', includeLegacy ? [PUBLIC_WIND_PROVIDER, 'xweather'] : [PUBLIC_WIND_PROVIDER])
      .eq('product', WIND_PRODUCT).eq('metadata->>country', country);
    const [rangeResult, first, latest, older] = await Promise.all([
      archive().gte('source_time', range.start).lt('source_time', range.end)
        .order('source_time', { ascending: false }).order('provider').order('captured_at', { ascending: false }).limit(1000),
      archive().order('source_time').limit(1).maybeSingle(),
      archive().order('source_time', { ascending: false }).limit(1).maybeSingle(),
      archive().lt('source_time', range.start).order('source_time', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (rangeResult.error || first.error || latest.error || older.error) throw Error('Wind archive unavailable.');
    const unique = new Map<string, NonNullable<typeof rangeResult.data>[number]>();
    for (const row of rangeResult.data ?? []) {
      if (!unique.has(row.source_time)) unique.set(row.source_time, row);
    }
    const data = [...unique.values()];
    const latestSavedAt = latest.data?.source_time ?? null;
    const health = { available: !!latestSavedAt, latestAvailable: latestSavedAt,
      message: latestSavedAt ? 'Saved wind hours are available for selected storm dates.' : 'No wind hours have been imported for this country yet.' };
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
    const boundsByTime = Object.fromEntries(indexed.flatMap(row => {
      const bounds: unknown = row.metadata?.coverageBounds;
      if (row.provider !== PUBLIC_WIND_PROVIDER || !Array.isArray(bounds) || bounds.length !== 4 ||
          !bounds.every(value => typeof value === 'number' && Number.isFinite(value))) return [];
      const [west, south, east, north] = bounds;
      if (west < -180 || east > 180 || west >= east || south < -85 || north > 85 || south >= north) return [];
      return [[new Date(row.source_time).toISOString(), bounds]];
    }));
    return NextResponse.json({ boundsByTime, olderSavedAt: older.data?.source_time ?? null, regionsByTime:Object.fromEntries([...indexed].reverse().map(row=>[new Date(row.source_time).toISOString(),qualifyingWindRegions(row.metadata?.windRegions,minimum)])), days: recentWindDays(indexed,minimum), matchingHours: matching.length, indexingPending: unindexed.length>0, times: [...new Set((minimum ? [...matching].sort((a,b)=>b.source_time.localeCompare(a.source_time)) : indexed).map(row => new Date(row.source_time).toISOString()))], archiveStartsAt: first.data?.source_time ?? null, latestSavedAt, health,
      coverage: 'Saved regional wind-gust estimates from NOAA HRRR. Older campaign evidence may show previously archived Vaisala data.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return stormError(error); }
}
