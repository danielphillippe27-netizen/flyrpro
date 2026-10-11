import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
export async function GET(request:NextRequest){
  const c=await stormContext(request);if('response'in c)return c.response;
  const key=request.nextUrl.searchParams.get('eventKey');
  if(!key||key.length>160)return NextResponse.json({error:'Select a storm'},{status:400});
  let query=c.admin.from('campaigns').select('id,name,storm_context,created_at').eq('workspace_id',c.workspaceId).contains('storm_context',{event:{key}}).order('created_at',{ascending:false}).limit(50);
  // Match the campaign API visibility boundary: ordinary members see owned
  // campaigns here. Do not reveal other reps' campaign details via storm search.
  if(c.role!=='owner'&&c.role!=='admin')query=query.eq('owner_id',c.user.id);
  const {data:campaigns,error}=await query;
  if(error)return NextResponse.json({error:'Campaign activity is unavailable'},{status:503});
  const ids=(campaigns||[]).map(x=>x.id);
  const counts=ids.length ? await c.admin.rpc('storm_campaign_stop_counts',{p_campaign_ids:ids}) : {data:[],error:null};
  const results=(counts.data||[]) as Array<{id:string;total:number;visited:number}>;
  return NextResponse.json({campaigns:(campaigns||[]).map(item=>({...item,total:null,visited:null,...results.find(x=>x.id===item.id)})),scope:c.role==='member'?'Your owned campaigns':'Workspace campaigns'},{headers:{'Cache-Control':'private, no-store'}});
}
