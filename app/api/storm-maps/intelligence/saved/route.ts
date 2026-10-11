import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { eventReferenceSchema } from '@/lib/storm-maps/intelligence/model';
export async function GET(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  const {data,error}=await c.admin.from('storm_saved_events').select('id,reference,created_at').eq('workspace_id',c.workspaceId).order('created_at',{ascending:false}).limit(200);
  if(error)return NextResponse.json({error:'Saved storms are unavailable. The Storm Intelligence database migration may be pending.'},{status:503});
  return NextResponse.json({events:data},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  const parsed=eventReferenceSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Invalid storm reference'},{status:400});
  const {error}=await c.admin.from('storm_saved_events').upsert({workspace_id:c.workspaceId,created_by:c.user.id,event_key:parsed.data.key,reference:parsed.data},{onConflict:'workspace_id,event_key',ignoreDuplicates:true});
  if(error)return NextResponse.json({error:'Could not save this storm. Please retry.'},{status:503});
  return NextResponse.json({saved:true});
}
export async function DELETE(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  let query=c.admin.from('storm_saved_events').delete().eq('workspace_id',c.workspaceId).eq('id',request.nextUrl.searchParams.get('id')||'');
  if(c.role!=='owner'&&c.role!=='admin')query=query.eq('created_by',c.user.id);
  const {error}=await query;
  return NextResponse.json(error?{error:'Could not remove bookmark'}:{removed:true},{status:error?503:200});
}
