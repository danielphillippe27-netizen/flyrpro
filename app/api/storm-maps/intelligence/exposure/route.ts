import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { stormGeometrySchema } from '@/lib/storm-maps/intelligence/geometry';
const schema=z.object({eventKey:z.string().min(1).max(160),boundary:stormGeometrySchema.optional()}).strict();
export async function POST(request:NextRequest){
 const c=await stormContext(request);if('response'in c)return c.response;
 const text=await request.text();if(text.length>100000)return NextResponse.json({error:'Boundary too large.'},{status:413});
 let raw;try{raw=JSON.parse(text);}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:'Choose a storm and valid boundary.'},{status:400});
 const {data:flags}=await c.admin.from('storm_intelligence_rollout').select('exposure_enabled').eq('workspace_id',c.workspaceId).maybeSingle();
 if(!flags?.exposure_enabled)return NextResponse.json({available:false,counts:null,reason:'Exposure calculations require validated historical geometry and verified address coverage.'});
 const {data,error}=await c.admin.rpc('storm_address_exposure',{p_event_key:parsed.data.eventKey,p_boundary:parsed.data.boundary??null});
 if(error)return NextResponse.json({error:'Exposure calculation unavailable.'},{status:503});
 return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
}
