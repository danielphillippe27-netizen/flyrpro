import { NextRequest,NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
export async function GET(request:NextRequest){
 const c=await stormContext(request);if('response'in c)return c.response;
 const key=request.nextUrl.searchParams.get('eventKey');if(!key||key.length>160)return NextResponse.json({error:'Choose a storm.'},{status:400});
 const {data:flags}=await c.admin.from('storm_intelligence_rollout').select('geometry_enabled,exposure_enabled').eq('workspace_id',c.workspaceId).maybeSingle();
 if(!flags?.geometry_enabled)return NextResponse.json({zones:[],available:false,exposureAvailable:false,reason:'Historical severity geometry has not been verified for this workspace.'});
 const {data,error}=await c.admin.from('storm_severity_zones').select('id,event_key,minimum_mm,geometry,source_resolution_m,estimation_method,source_updated_at').eq('event_key',key).eq('validated',true).eq('license_verified',true);
 if(error)return NextResponse.json({error:'Historical geometry unavailable.'},{status:503});
 return NextResponse.json({zones:data,available:!!data?.length,exposureAvailable:!!flags.exposure_enabled,reason:data?.length?null:'No validated severity geometry is available for this storm.'},{headers:{'Cache-Control':'private, no-store'}});
}
