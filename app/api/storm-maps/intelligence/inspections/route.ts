import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
const input=z.object({event_key:z.string().min(1).max(160),longitude:z.number().min(-180).max(180),latitude:z.number().min(-85).max(85),property_label:z.string().max(200),outcome:z.enum(['pending','damage_observed','no_damage_observed','follow_up','do_not_knock']),notes:z.string().max(4000)}).strict();
export async function GET(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  const key=request.nextUrl.searchParams.get('eventKey');
  if(!key||key.length>160)return NextResponse.json({error:'Select a storm'},{status:400});
  const {data,error}=await c.admin.from('storm_property_inspections').select('id,event_key,longitude,latitude,property_label,outcome,notes,observed_at').eq('workspace_id',c.workspaceId).eq('event_key',key).order('observed_at',{ascending:false}).limit(500);
  return NextResponse.json(error?{error:'Inspection history is unavailable'}:{inspections:data},{status:error?503:200,headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  const body=input.safeParse(await request.json().catch(()=>null));
  if(!body.success)return NextResponse.json({error:'Enter a valid location and inspection outcome'},{status:400});
  const {error}=await c.admin.from('storm_property_inspections').insert({...body.data,workspace_id:c.workspaceId,created_by:c.user.id});
  return NextResponse.json(error?{error:'Could not save inspection'}:{saved:true},{status:error?503:200});
}
