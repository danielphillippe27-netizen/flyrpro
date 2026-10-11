import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stormContext, stormError, consumeArchiveRequest } from '@/lib/storm-maps/intelligence/access';
import { dateWindow } from '@/lib/storm-maps/intelligence/model';
import { xweatherData, type HailArchiveRow } from '@/lib/storm-maps/intelligence/provider';
import { getCachedStormValue, setCachedStormValue } from '@/lib/storm-maps/cache';
export const runtime='nodejs';
export async function GET(request:NextRequest){
  const context=await stormContext(request);if('response'in context)return context.response;
  const q=request.nextUrl.searchParams;
  const coordinates=z.tuple([z.number().min(-180).max(180),z.number().min(-85).max(85)]).safeParse([Number(q.get('lon')),Number(q.get('lat'))]);
  if(!q.has('lon')||!q.has('lat')||!coordinates.success)return NextResponse.json({error:'Select a location'},{status:400});
  let range;try{range=dateWindow(q.get('date')||'',q.get('date')||'',1);}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
  const [lon,lat]=coordinates.data;
  const key=`hail-lookup:${lat.toFixed(4)}:${lon.toFixed(4)}:${range.start}`;
  try{
    const cached=await getCachedStormValue<HailArchiveRow[]>(key);
    if(!cached)await consumeArchiveRequest(context);
    const rows=cached?.value||await xweatherData<HailArchiveRow>(`hail/archive/${lat.toFixed(4)},${lon.toFixed(4)}`,{from:range.start,to:range.end});
    if(!cached)await setCachedStormValue(key,rows,300,300);
    const periods=rows.flatMap(r=>r.periods||[]).filter(p=>Date.parse(p.dateTimeISO)>=Date.parse(range.start)&&Date.parse(p.dateTimeISO)<Date.parse(range.end));
    return NextResponse.json({source:'Xweather Hail Archive',periods,coverage:periods.length?'available':'unavailable',start:range.start,end:range.end,location:{lat,lon},message:'Location estimate for the selected UTC day; not an inspection or regional damage footprint.'},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return stormError(e);}
}
