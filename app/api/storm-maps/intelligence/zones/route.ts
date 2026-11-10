import { NextRequest,NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { MRMS_HAIL_ZONE_METHOD } from '@/lib/storm-maps/intelligence/geometry';
export async function GET(request:NextRequest){
 const c=await stormContext(request);if('response'in c)return c.response;
 const key=request.nextUrl.searchParams.get('eventKey');if(!key||key.length>160)return NextResponse.json({error:'Choose a storm.'},{status:400});
 const {data:flags}=await c.admin.from('storm_intelligence_rollout').select('geometry_enabled,exposure_enabled').eq('workspace_id',c.workspaceId).maybeSingle();
 // Published public NOAA zones are available to Storm Maps workspaces. Other
 // sources still require the workspace's historical geometry rollout flag.
 const query=c.admin.from('storm_severity_zones').select('id,event_key,minimum_mm,geometry,source_resolution_m,estimation_method,source_updated_at').eq('event_key',key).eq('validated',true).eq('license_verified',true);
 if(!flags?.geometry_enabled)query.eq('estimation_method',MRMS_HAIL_ZONE_METHOD);
 const {data,error}=await query.order('minimum_mm');
 if(error)return NextResponse.json({error:'Historical geometry unavailable.'},{status:503});
 return NextResponse.json({zones:data,available:!!data?.length,exposureAvailable:!!flags?.exposure_enabled,reason:data?.length?null:'No validated severity geometry is available for this storm.'},{headers:{'Cache-Control':'private, no-store'}});
}
