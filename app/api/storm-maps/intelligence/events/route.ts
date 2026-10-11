import { NextRequest, NextResponse } from 'next/server';
import { stormContext, stormError, consumeArchiveRequest } from '@/lib/storm-maps/intelligence/access';
import { boundsSchema, dateWindow, hazardSchema } from '@/lib/storm-maps/intelligence/model';
import { loadCyclones, loadReportEvents } from '@/lib/storm-maps/intelligence/provider';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:NextRequest){
  const context=await stormContext(request);if('response'in context)return context.response;
  const q=request.nextUrl.searchParams;
  const bbox=boundsSchema.safeParse((q.get('bbox')||'').split(',').map(Number));
  const hazard=hazardSchema.safeParse(q.get('hazard'));
  if(!bbox.success||!hazard.success)return NextResponse.json({error:'Choose a valid region and hazard'},{status:400});
  let range;try{range=dateWindow(q.get('from')||'',q.get('to')||'');}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
  const id=q.get('sourceId')||undefined;
  if(id&&!/^\d{4}-(AL|EP|CP|WP|IO|SH)-\d{2}$/.test(id))return NextResponse.json({error:'Invalid cyclone ID'},{status:400});
  try{
    const b=bbox.data;
    if(hazard.data==='hurricane')await consumeArchiveRequest(context);
    const events=hazard.data==='hurricane'?await loadCyclones(range.start,range.end,[(b[0]+b[2])/2,(b[1]+b[3])/2],id,q.get('active')==='true'):await loadReportEvents(b,range.start,range.end,hazard.data);
    return NextResponse.json({events,coverage:hazard.data==='hurricane'?'Cyclone tracks and advisory intensity. A track is not a damage footprint.':'U.S. reported observations grouped by UTC day and state within this map view. These are report points, not complete storm footprints. No reports does not establish no exposure.',footprintsAvailable:false},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return stormError(e);}
}
