import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { archivedWindZone } from '@/lib/storm-maps/intelligence/wind-zone';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request:NextRequest){
  const auth=await stormContext(request);if('response'in auth)return auth.response;
  const q=request.nextUrl.searchParams;
  const parsed=z.object({country:z.enum(['CA','US','AU','NZ']),time:z.string(),lon:z.coerce.number().min(-180).max(180),lat:z.coerce.number().min(-85).max(85),minimum:z.coerce.number().optional(),band:z.enum(['0','1'])}).safeParse(Object.fromEntries(q));
  if(!q.has('lon')||!q.has('lat')||!parsed.success)return NextResponse.json({error:'Choose a valid saved wind location.'},{status:400});
  try {const p=parsed.data;return NextResponse.json(await archivedWindZone(p.country,p.time,p.lon,p.lat,p.minimum,p.band==='1'),{headers:{'Cache-Control':'private, no-store'}});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not select the gust area.'},{status:422});}
}
